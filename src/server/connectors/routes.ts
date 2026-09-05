// 커넥터 HTTP 표면 — 연결 상태 조회 / OAuth 개시·콜백 / 해제 / MCP 자식용 토큰 브로커.
//
// 토큰 브로커(/access-token)를 두는 이유: refresh token은 호스트 프로세스에만 둔다.
// MCP 자식(src/mcp/connectors-server.ts)은 수명이 짧은 액세스 토큰만 받아 쓴다.
// safefs가 MCP_APPROVAL_URL 등으로 호스트에 되묻는 것과 같은 구조다.

import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { HISTORY_DIR } from "../../config.js";
import { atomicWriteFileSync } from "../utils/atomic-write.js";
import { CONNECTOR_PROVIDERS, getProviderDef, type ConnectorProviderDef } from "./catalog.js";
import { ConnectorTokenStore, type TokenGrant } from "./token-store.js";

const TRANSACTION_TTL_MS = 10 * 60 * 1000;
const BROKER_TOKEN_FILE = join(HISTORY_DIR, "connectors", ".broker-token");

type Transaction = { readonly provider: string; readonly codeVerifier: string; readonly expiresAt: number };
const transactions = new Map<string, Transaction>();

let store: ConnectorTokenStore | null = null;
function tokenStore(): ConnectorTokenStore {
  store ??= new ConnectorTokenStore({ historyDir: HISTORY_DIR });
  return store;
}

/**
 * MCP 자식과 호스트가 공유하는 브로커 토큰. 파일(0600)로 전달한다 —
 * 자식 env에 실으면 `claude mcp` 진단 출력이나 프로세스 목록에 새어나온다.
 */
export function connectorBrokerToken(): string {
  if (existsSync(BROKER_TOKEN_FILE)) return readFileSync(BROKER_TOKEN_FILE, "utf8").trim();
  mkdirSync(join(HISTORY_DIR, "connectors"), { recursive: true });
  const token = randomBytes(32).toString("hex");
  atomicWriteFileSync(BROKER_TOKEN_FILE, `${token}\n`);
  chmodSync(BROKER_TOKEN_FILE, 0o600);
  return token;
}

/** MCP 자식에게 넘길 브로커 토큰 파일 경로. 없으면 만들어 두고 경로를 돌려준다. */
export function connectorTokenFile(): string {
  connectorBrokerToken();
  return BROKER_TOKEN_FILE;
}

/** 하나라도 쓸 수 있는 커넥터가 있나 — spawn이 connectors 서버를 실을지 판단한다. */
export function hasUsableConnector(): boolean {
  return tokenStore().status().some((s) => s.state === "connected");
}

export function createConnectorRoutes(): Hono {
  const app = new Hono();

  app.get("/", (c) => c.json({ connectors: tokenStore().status() }));

  app.post("/:provider/oauth/start", (c) => {
    const provider = getProviderDef(c.req.param("provider"));
    if (!provider) return c.json({ error: "unknown_provider" }, 404);
    if (!tokenStore().isOAuthConfigured(provider)) {
      return c.json({ error: "provider_not_configured", need: [provider.clientIdEnv, provider.clientSecretEnv] }, 503);
    }
    const state = randomBytes(32).toString("hex");
    const codeVerifier = randomBytes(48).toString("base64url");
    pruneTransactions();
    transactions.set(state, { provider: provider.id, codeVerifier, expiresAt: Date.now() + TRANSACTION_TTL_MS });
    return c.json({ authorizationUrl: buildAuthorizationUrl(provider, callbackUrl(c.req.url, provider), state, codeVerifier) });
  });

  app.get("/:provider/oauth/callback", async (c) => {
    const provider = getProviderDef(c.req.param("provider"));
    if (!provider) return c.html(resultPage("알 수 없는 provider입니다."), 404);
    const state = c.req.query("state") ?? "";
    const code = c.req.query("code") ?? "";
    const transaction = transactions.get(state);
    transactions.delete(state);
    if (!transaction || transaction.provider !== provider.id || transaction.expiresAt <= Date.now()) {
      return c.html(resultPage("연결 요청이 만료됐습니다. 설정에서 다시 시도하세요."), 400);
    }
    if (!code) return c.html(resultPage(`연결이 취소됐습니다. (${c.req.query("error") ?? "code 없음"})`), 400);
    try {
      const exchanged = await exchangeCode(provider, code, callbackUrl(c.req.url, provider), transaction.codeVerifier);
      tokenStore().saveGrant({
        providerId: provider.id,
        grant: exchanged.grant,
        accountLabel: exchanged.accountLabel,
      });
      return c.html(resultPage(`${provider.label} 연결이 완료됐습니다${exchanged.accountLabel ? ` (${exchanged.accountLabel})` : ""}. 이 창을 닫으세요.`));
    } catch (error) {
      return c.html(resultPage(`연결 실패: ${error instanceof Error ? error.message : String(error)}`), 502);
    }
  });

  app.post("/:provider/revoke", (c) => {
    const provider = getProviderDef(c.req.param("provider"));
    if (!provider) return c.json({ error: "unknown_provider" }, 404);
    tokenStore().revoke(provider.id);
    return c.json({ ok: true, connectors: tokenStore().status() });
  });

  // ── MCP 자식용 토큰 브로커 ──────────────────────────────────────────────
  app.post("/:provider/access-token", async (c) => {
    const presented = c.req.header("x-connector-broker") ?? "";
    const expected = connectorBrokerToken();
    if (!constantTimeEqual(presented, expected)) return c.json({ error: "unauthorized" }, 401);
    const providerId = c.req.param("provider");
    try {
      return c.json({ accessToken: await tokenStore().getAccessToken(providerId) });
    } catch (error) {
      const auth = error as { reason?: string; remedy?: string };
      return c.json({ error: auth.reason ?? "token_unavailable", remedy: auth.remedy ?? String(error) }, 403);
    }
  });

  return app;
}

// ── OAuth 조립 ────────────────────────────────────────────────────────────

function buildAuthorizationUrl(provider: ConnectorProviderDef, redirectUri: string, state: string, codeVerifier: string): string {
  const url = new URL(provider.authorizationEndpoint);
  url.searchParams.set("client_id", process.env[provider.clientIdEnv] ?? "");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  if (provider.scopes.length > 0) url.searchParams.set("scope", provider.scopes.join(" "));
  if (provider.id === "google") {
    // 이 둘이 없으면 refresh token이 오지 않는다 — 그러면 첫 만료가 곧 막다른 골목이 된다.
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("code_challenge", createHash("sha256").update(codeVerifier).digest("base64url"));
    url.searchParams.set("code_challenge_method", "S256");
  } else {
    url.searchParams.set("owner", "user");
  }
  return url.toString();
}

async function exchangeCode(
  provider: ConnectorProviderDef,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<{ grant: TokenGrant; accountLabel: string | null }> {
  const clientId = process.env[provider.clientIdEnv] ?? "";
  const clientSecret = process.env[provider.clientSecretEnv] ?? "";

  if (provider.id === "notion") {
    // 노션 토큰 교환은 HTTP Basic + JSON 본문 (구글의 form-urlencoded와 다르다).
    const response = await fetch(provider.tokenEndpoint, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Notion 토큰 교환 실패 (HTTP ${response.status}): ${text.slice(0, 200)}`);
    const parsed = z.object({
      access_token: z.string().min(1),
      refresh_token: z.string().min(1).optional(),
      expires_in: z.number().int().positive().optional(),
      workspace_name: z.string().nullable().optional(),
    }).passthrough().parse(JSON.parse(text) as unknown);
    return {
      grant: {
        accessToken: parsed.access_token,
        refreshToken: parsed.refresh_token ?? null,
        expiresInSec: parsed.expires_in ?? null,
        grantedScopes: [],
      },
      accountLabel: parsed.workspace_name ?? null,
    };
  }

  const response = await fetch(provider.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Google 토큰 교환 실패 (HTTP ${response.status}): ${text.slice(0, 200)}`);
  const parsed = z.object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: z.number().int().positive().optional(),
    scope: z.string().optional(),
  }).passthrough().parse(JSON.parse(text) as unknown);
  if (!parsed.refresh_token) {
    // 갱신 수단 없는 연결은 몇 시간 뒤 반드시 만료된다 — 지금 거절하는 편이 정직하다.
    throw new Error("refresh token이 발급되지 않았습니다 — 구글 계정의 기존 앱 권한을 해제한 뒤 다시 연결하세요");
  }
  return {
    grant: {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token,
      expiresInSec: parsed.expires_in ?? null,
      grantedScopes: (parsed.scope ?? "").split(" ").filter(Boolean),
    },
    accountLabel: await fetchGoogleEmail(parsed.access_token),
  };
}

async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const parsed = z.object({ email: z.string().optional() }).passthrough().parse(await response.json() as unknown);
    return parsed.email ?? null;
  } catch {
    return null;   // 계정 이름은 표시용일 뿐 — 못 얻어도 연결은 성립한다.
  }
}

/** 콜백 URL — 명시 env가 있으면 그것, 없으면 실제 요청 오리진에서 유도. */
function callbackUrl(requestUrl: string, provider: ConnectorProviderDef): string {
  const explicit = process.env.CONNECTOR_CALLBACK_BASE_URL ?? process.env.PUBLIC_BASE_URL;
  const base = explicit ? new URL(explicit).origin : new URL(requestUrl).origin;
  return `${base}${provider.callbackPath}`;
}

function pruneTransactions(): void {
  const now = Date.now();
  for (const [state, transaction] of transactions) {
    if (transaction.expiresAt <= now) transactions.delete(state);
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function resultPage(message: string): string {
  const safe = message.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  return `<!doctype html><meta charset="utf-8"><title>커넥터 연결</title>` +
    `<body style="font-family:system-ui;padding:3rem;text-align:center"><p>${safe}</p>` +
    `<script>setTimeout(()=>window.close(),2500)</script></body>`;
}

export { CONNECTOR_PROVIDERS };
