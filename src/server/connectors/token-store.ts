// 커넥터 토큰 계층 — 연결 상태 기록 + 액세스 토큰 자동 갱신.
//
// ★ "OAuth session expired and could not be refreshed" 의 수리 지점이다.
// 기존 google-readonly-provider는 갱신 실패를 전부 한 덩어리(provider_failure)로 뭉개
// 일시적 5xx와 '사용자가 앱 접근을 취소함'(invalid_grant)을 구분하지 못했고, 그래서
// 만료가 복구 경로 없는 막다른 골목이 됐다. 여기서는 셋으로 가른다:
//   액세스 토큰 만료 → 조용히 갱신 (상태 전이 없음)
//   일시적 5xx/네트워크 → 1회 재시도, 실패해도 상태는 connected 유지
//   invalid_grant/401  → needs_reauth 로 전이 + 재연결 경로를 오류에 실어 보낸다

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { atomicWriteFileSync } from "../utils/atomic-write.js";
import { CONNECTOR_PROVIDERS, getProviderDef, type ConnectorProviderDef, type ConnectorProviderId } from "./catalog.js";
import { ConnectorVault, resolveVaultKey, type ConnectorSecret } from "./vault.js";

/** 갱신을 미리 당기는 여유 — 만료 직전 토큰으로 호출해 401을 맞지 않게 한다. */
const REFRESH_SKEW_MS = 120_000;

export const ConnectionStateSchema = z.enum(["connected", "needs_reauth", "misconfigured"]);
export type ConnectionState = z.infer<typeof ConnectionStateSchema>;

export const ConnectionRecordSchema = z.object({
  version: z.literal(1),
  provider: z.string().min(1),
  state: ConnectionStateSchema,
  /** 사람이 알아보는 계정 이름 (구글 이메일 / 노션 워크스페이스). */
  accountLabel: z.string().nullable(),
  grantedScopes: z.array(z.string()),
  connectedAt: z.string(),
  lastRefreshAt: z.string().nullable(),
  /** needs_reauth 로 넘어간 사유 — UI가 그대로 보여준다. */
  lastError: z.string().nullable(),
  /** env 정적 토큰으로 선 연결된 경우 true — 해제해도 env가 남아 있으면 다시 산다. */
  fromEnv: z.boolean(),
}).strict();

export type ConnectionRecord = z.infer<typeof ConnectionRecordSchema>;

const RecordsFileSchema = z.object({
  version: z.literal(1),
  connections: z.record(z.string(), ConnectionRecordSchema),
}).strict();

export type ConnectorAuthReason =
  | "not_configured"   // OAuth client도 env 토큰도 없다
  | "not_connected"    // 설정은 됐지만 아직 연결 안 함
  | "needs_reauth"     // refresh token이 죽었다 — 사람이 다시 동의해야 한다
  | "misconfigured"    // client id/secret이 틀렸다 — 재동의로는 절대 안 고쳐진다
  | "refresh_failed";  // 일시적 실패 — 재시도하면 될 수도 있다

export class ConnectorAuthError extends Error {
  readonly name = "ConnectorAuthError";
  constructor(
    readonly provider: string,
    readonly reason: ConnectorAuthReason,
    readonly detail: string,
  ) {
    super(`[${provider}] ${reason}: ${detail}`);
  }

  /** 사람이 읽고 바로 행동할 수 있는 한 줄 — MCP 도구 오류 본문에 그대로 실린다. */
  get remedy(): string {
    switch (this.reason) {
      case "not_configured":
        return `${this.provider} 커넥터가 설정되지 않았습니다 — .env에 OAuth client 또는 토큰을 넣고 서버를 재시작하세요.`;
      case "not_connected":
      case "needs_reauth":
        return `${this.provider} 재연결이 필요합니다 — 설정 → 연결에서 다시 연결하거나 POST /api/connectors/${this.provider}/oauth/start 를 여세요. (사유: ${this.detail})`;
      case "misconfigured":
        // ★ 재연결을 권하면 안 된다. 실제 구글이 잘못된 client에 401 invalid_client를 주는데
        //   이걸 재동의로 안내하면 사용자가 영원히 재연결만 반복한다 (2026-09-04 라이브 검증).
        return `${this.provider} OAuth 클라이언트 설정이 잘못됐습니다 — 재연결해도 고쳐지지 않습니다. .env의 클라이언트 ID/시크릿을 확인하고 서버를 재시작하세요. (사유: ${this.detail})`;
      case "refresh_failed":
        return `${this.provider} 토큰 갱신이 일시적으로 실패했습니다 — 잠시 후 다시 시도하세요. (${this.detail})`;
    }
  }
}

export interface TokenGrant {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  /** 만료까지 남은 초. null이면 무만료(노션). */
  readonly expiresInSec: number | null;
  readonly grantedScopes: readonly string[];
}

type StoreOptions = {
  readonly historyDir: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => number;
  /** 테스트 주입 지점 — 실제 토큰 엔드포인트 호출. */
  readonly exchangeRefreshToken?: (provider: ConnectorProviderDef, refreshToken: string) => Promise<TokenGrant>;
};

export class ConnectorTokenStore {
  readonly #dir: string;
  readonly #recordsPath: string;
  readonly #vault: ConnectorVault;
  readonly #env: NodeJS.ProcessEnv;
  readonly #now: () => number;
  readonly #exchange: (provider: ConnectorProviderDef, refreshToken: string) => Promise<TokenGrant>;

  constructor(options: StoreOptions) {
    this.#dir = join(options.historyDir, "connectors");
    this.#recordsPath = join(this.#dir, "connections.json");
    mkdirSync(this.#dir, { recursive: true });
    this.#env = options.env ?? process.env;
    this.#now = options.now ?? (() => Date.now());
    this.#vault = new ConnectorVault({
      directory: join(this.#dir, "secrets"),
      key: resolveVaultKey(options.historyDir, this.#env),
    });
    this.#exchange = options.exchangeRefreshToken ?? refreshViaHttp;
  }

  // ── 설정 여부 ─────────────────────────────────────────────────────────────

  /** OAuth client가 갖춰졌나 (연결 버튼을 띄울 수 있나). */
  isOAuthConfigured(provider: ConnectorProviderDef): boolean {
    return Boolean(this.#env[provider.clientIdEnv] && this.#env[provider.clientSecretEnv]);
  }

  /** env 정적 토큰이 있나 (OAuth 없이도 바로 쓸 수 있나). */
  staticToken(provider: ConnectorProviderDef): string | null {
    return this.#env[provider.staticTokenEnv]?.trim() || null;
  }

  // ── 기록 ──────────────────────────────────────────────────────────────────

  listRecords(): Record<string, ConnectionRecord> {
    if (!existsSync(this.#recordsPath)) return {};
    try {
      return RecordsFileSchema.parse(JSON.parse(readFileSync(this.#recordsPath, "utf8")) as unknown).connections;
    } catch {
      return {};
    }
  }

  getRecord(providerId: string): ConnectionRecord | null {
    return this.listRecords()[providerId] ?? null;
  }

  #putRecord(record: ConnectionRecord): void {
    const connections = { ...this.listRecords(), [record.provider]: record };
    atomicWriteFileSync(
      this.#recordsPath,
      `${JSON.stringify(RecordsFileSchema.parse({ version: 1, connections }), null, 2)}\n`,
    );
  }

  /** 상태 목록 — /api/connectors 응답의 실체. 비밀은 절대 싣지 않는다. */
  status(): Array<{
    provider: ConnectorProviderId;
    label: string;
    configured: boolean;
    state: ConnectionState | "not_connected";
    accountLabel: string | null;
    grantedScopes: string[];
    lastError: string | null;
    connectUrl: string | null;
  }> {
    const records = this.listRecords();
    return CONNECTOR_PROVIDERS.map((provider) => {
      this.#adoptStaticToken(provider, records[provider.id] ?? null);
      const record = this.getRecord(provider.id);
      const configured = this.isOAuthConfigured(provider) || this.staticToken(provider) !== null;
      return {
        provider: provider.id,
        label: provider.label,
        configured,
        state: record?.state ?? "not_connected",
        accountLabel: record?.accountLabel ?? null,
        grantedScopes: record?.grantedScopes ?? [],
        lastError: record?.lastError ?? null,
        connectUrl: this.isOAuthConfigured(provider) ? `/api/connectors/${provider.id}/oauth/start` : null,
      };
    });
  }

  /** 연결 성립(OAuth 콜백 또는 env 채택)을 기록한다. */
  saveGrant(input: {
    providerId: ConnectorProviderId;
    grant: TokenGrant;
    accountLabel: string | null;
    fromEnv?: boolean;
  }): ConnectionRecord {
    const now = this.#now();
    this.#vault.write(input.providerId, {
      refreshToken: input.grant.refreshToken,
      accessToken: input.grant.accessToken,
      accessTokenExpiresAt: input.grant.expiresInSec === null ? null : now + input.grant.expiresInSec * 1000,
    });
    const record = ConnectionRecordSchema.parse({
      version: 1,
      provider: input.providerId,
      state: "connected",
      accountLabel: input.accountLabel,
      grantedScopes: [...input.grant.grantedScopes],
      connectedAt: new Date(now).toISOString(),
      lastRefreshAt: null,
      lastError: null,
      fromEnv: input.fromEnv ?? false,
    } satisfies ConnectionRecord);
    this.#putRecord(record);
    return record;
  }

  revoke(providerId: string): void {
    this.#vault.erase(providerId);
    const connections = this.listRecords();
    delete connections[providerId];
    atomicWriteFileSync(
      this.#recordsPath,
      `${JSON.stringify(RecordsFileSchema.parse({ version: 1, connections }), null, 2)}\n`,
    );
  }

  // ── 액세스 토큰 ───────────────────────────────────────────────────────────

  /**
   * 유효한 액세스 토큰을 돌려준다. 만료됐으면 갱신한다.
   * 실패는 전부 ConnectorAuthError로 나오며, reason이 복구 경로를 가른다.
   */
  async getAccessToken(providerId: string): Promise<string> {
    const provider = getProviderDef(providerId);
    if (!provider) throw new ConnectorAuthError(providerId, "not_configured", "알 수 없는 provider");

    this.#adoptStaticToken(provider, this.getRecord(providerId));

    const record = this.getRecord(providerId);
    if (!record) {
      const reason: ConnectorAuthReason = this.isOAuthConfigured(provider) ? "not_connected" : "not_configured";
      throw new ConnectorAuthError(providerId, reason, "연결 기록이 없습니다");
    }
    if (record.state === "needs_reauth") {
      throw new ConnectorAuthError(providerId, "needs_reauth", record.lastError ?? "이전 갱신이 거부됐습니다");
    }
    // misconfigured는 막지 않는다 — .env를 고치고 재시작했으면 이번엔 성공해야 한다.
    // (needs_reauth와 달리 사람의 재동의가 아니라 설정 수정으로 낫는 병이다)

    let secret: ConnectorSecret | null;
    try {
      secret = this.#vault.read(providerId);
    } catch {
      this.#markState(record, "needs_reauth", "저장된 토큰을 복호화할 수 없습니다 (암호화 키 교체?)");
      throw new ConnectorAuthError(providerId, "needs_reauth", "저장된 토큰을 복호화할 수 없습니다");
    }
    if (!secret) {
      this.#markState(record, "needs_reauth", "저장된 토큰이 사라졌습니다");
      throw new ConnectorAuthError(providerId, "needs_reauth", "저장된 토큰이 사라졌습니다");
    }

    const fresh = secret.accessToken !== null
      && (secret.accessTokenExpiresAt === null || secret.accessTokenExpiresAt - this.#now() > REFRESH_SKEW_MS);
    if (fresh) return secret.accessToken as string;

    if (!secret.refreshToken) {
      // 노션 내부 통합 토큰처럼 갱신 수단이 없는데 액세스 토큰도 죽었다 = 통합 폐기.
      this.#markState(record, "needs_reauth", "갱신 토큰이 없고 액세스 토큰이 만료됐습니다");
      throw new ConnectorAuthError(providerId, "needs_reauth", "갱신 토큰이 없습니다");
    }

    return this.#refresh(provider, record, secret.refreshToken);
  }

  async #refresh(provider: ConnectorProviderDef, record: ConnectionRecord, refreshToken: string): Promise<string> {
    let lastDetail = "";
    // 일시적 실패(5xx/네트워크)는 1회 재시도. invalid_grant는 즉시 포기 — 재시도해도 같다.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const grant = await this.#exchange(provider, refreshToken);
        const now = this.#now();
        this.#vault.write(provider.id, {
          // 구글은 갱신 응답에 refresh_token을 다시 주지 않는다 — 기존 것을 지켜야 한다.
          refreshToken: grant.refreshToken ?? refreshToken,
          accessToken: grant.accessToken,
          accessTokenExpiresAt: grant.expiresInSec === null ? null : now + grant.expiresInSec * 1000,
        });
        this.#putRecord(ConnectionRecordSchema.parse({
          ...record,
          state: "connected",
          lastRefreshAt: new Date(now).toISOString(),
          lastError: null,
          grantedScopes: grant.grantedScopes.length > 0 ? [...grant.grantedScopes] : record.grantedScopes,
        } satisfies ConnectionRecord));
        return grant.accessToken;
      } catch (error) {
        lastDetail = error instanceof Error ? error.message : String(error);
        if (error instanceof ProviderMisconfiguredError) {
          // 설정 오류 — 재시도도, 재동의도 소용없다. 사람이 .env를 고쳐야 한다.
          this.#markState(record, "misconfigured", lastDetail);
          throw new ConnectorAuthError(provider.id, "misconfigured", lastDetail);
        }
        if (error instanceof RefreshRejectedError) {
          this.#markState(record, "needs_reauth", lastDetail);
          throw new ConnectorAuthError(provider.id, "needs_reauth", lastDetail);
        }
      }
    }
    // 상태는 connected로 남긴다 — 네트워크가 돌아오면 다음 호출이 성공한다.
    throw new ConnectorAuthError(provider.id, "refresh_failed", lastDetail);
  }

  #markState(record: ConnectionRecord, state: ConnectionState, detail: string): void {
    this.#putRecord(ConnectionRecordSchema.parse({
      ...record,
      state,
      lastError: detail.slice(0, 400),
    } satisfies ConnectionRecord));
  }

  /**
   * env 정적 토큰을 연결로 승격한다 (.env만 채우면 바로 쓰이게 — findings D4).
   * 이미 OAuth로 연결돼 있으면 건드리지 않는다: 사람이 명시적으로 한 연결이 우선이다.
   */
  #adoptStaticToken(provider: ConnectorProviderDef, existing: ConnectionRecord | null): void {
    if (existing && !existing.fromEnv) return;
    const token = this.staticToken(provider);
    if (!token) return;
    if (existing?.fromEnv && existing.state === "connected") return;
    if (provider.id === "notion") {
      // 노션 내부 통합 토큰은 그 자체가 액세스 토큰이고 만료되지 않는다.
      this.saveGrant({
        providerId: provider.id,
        grant: { accessToken: token, refreshToken: null, expiresInSec: null, grantedScopes: [] },
        accountLabel: null,
        fromEnv: true,
      });
      return;
    }
    // 구글은 env 값이 refresh token이다 — 액세스 토큰은 첫 호출에서 갱신으로 얻는다.
    this.#vault.write(provider.id, { refreshToken: token, accessToken: null, accessTokenExpiresAt: null });
    this.#putRecord(ConnectionRecordSchema.parse({
      version: 1,
      provider: provider.id,
      state: "connected",
      accountLabel: existing?.accountLabel ?? null,
      grantedScopes: [...provider.scopes],
      connectedAt: existing?.connectedAt ?? new Date(this.#now()).toISOString(),
      lastRefreshAt: null,
      lastError: null,
      fromEnv: true,
    } satisfies ConnectionRecord));
  }
}

/** 갱신이 '거부'됐다 — 재시도해도 같다. 사람이 다시 동의해야 한다. */
export class RefreshRejectedError extends Error {
  readonly name = "RefreshRejectedError";
}

/** OAuth 클라이언트 설정이 틀렸다 — 재동의로는 절대 안 고쳐진다. .env를 고쳐야 한다. */
export class ProviderMisconfiguredError extends Error {
  readonly name = "ProviderMisconfiguredError";
}

/**
 * 토큰 엔드포인트의 4xx를 '사람이 할 수 있는 일' 기준으로 가른다 (RFC 6749 §5.2).
 *
 * ★ 라이브 검증(2026-09-04): 실제 oauth2.googleapis.com은 잘못된 client id/secret에
 * `HTTP 401 {"error":"invalid_client"}` 를 준다. 이전 코드는 400·401을 전부 재동의로
 * 안내해, 원인이 .env인데 사용자가 재연결만 무한 반복하게 만들었다.
 */
function classifyOAuthError(status: number, body: string): Error {
  let code = "";
  try {
    code = String((JSON.parse(body) as { error?: unknown }).error ?? "");
  } catch { /* 비-JSON 응답 — 아래 기본 분기로 */ }
  const detail = `토큰 엔드포인트 거부 (HTTP ${status}${code ? `, ${code}` : ""}): ${body.slice(0, 200)}`;

  // 설정을 고쳐야 낫는 것들 — 클라이언트 자격증명·grant 설정 문제.
  if (code === "invalid_client" || code === "unauthorized_client"
      || code === "unsupported_grant_type" || code === "invalid_request") {
    return new ProviderMisconfiguredError(detail);
  }
  // invalid_grant(토큰 폐기·만료)·invalid_scope, 그리고 분류 불가한 4xx는 재동의로 보낸다.
  return new RefreshRejectedError(detail);
}

async function refreshViaHttp(provider: ConnectorProviderDef, refreshToken: string): Promise<TokenGrant> {
  const clientId = process.env[provider.clientIdEnv] ?? "";
  const clientSecret = process.env[provider.clientSecretEnv] ?? "";
  if (!clientId || !clientSecret) {
    // env refresh token만 있고 client가 없다 — 설정 오류다. 재동의로는 안 고쳐진다.
    throw new ProviderMisconfiguredError(`${provider.clientIdEnv}/${provider.clientSecretEnv} 가 없어 갱신할 수 없습니다`);
  }
  const response = await fetch(provider.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) {
      throw classifyOAuthError(response.status, text);
    }
    throw new Error(`토큰 엔드포인트 오류 (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }
  const parsed = z.object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: z.number().int().positive().optional(),
    scope: z.string().optional(),
  }).passthrough().parse(JSON.parse(text) as unknown);
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token ?? null,
    expiresInSec: parsed.expires_in ?? null,
    grantedScopes: (parsed.scope ?? "").split(" ").filter(Boolean),
  };
}
