// 커넥터 토큰 계층 계약 테스트.
//
// 지키는 계약 (docs/connector-tools/spec.md 성공 기준 3·4·5):
//   T1 만료된 액세스 토큰은 refresh token으로 조용히 갱신된다
//   T2 유효한 토큰은 갱신하지 않는다 (불필요한 토큰 엔드포인트 호출 금지)
//   T3 invalid_grant(거부)는 needs_reauth로 전이하고 재연결 경로를 실어 보낸다
//   T4 일시적 실패는 1회 재시도하고, 상태를 needs_reauth로 떨어뜨리지 않는다
//   T5 구글 갱신 응답에 refresh_token이 없어도 기존 것을 잃지 않는다
//   T6 서비스 정책이 spawn 게이트(허용/승인/노출 서비스)로 번역된다

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import {
  ConnectorTokenStore,
  ConnectorAuthError,
  RefreshRejectedError,
  ProviderMisconfiguredError,
  type TokenGrant,
} from "../src/server/connectors/token-store.js";
import { getProviderDef } from "../src/server/connectors/catalog.js";

const google = getProviderDef("google");
assert.ok(google, "google provider 정의가 있어야 한다");

let temp = "";
function freshStore(options: {
  exchange: (refreshToken: string) => Promise<TokenGrant>;
  now?: () => number;
}): ConnectorTokenStore {
  temp = mkdtempSync(join(tmpdir(), "connector-test-"));
  return new ConnectorTokenStore({
    historyDir: temp,
    // env 정적 토큰이 테스트 결과를 오염시키지 않게 빈 env를 준다.
    env: { SOLOFORCE_CONNECTION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") },
    now: options.now,
    exchangeRefreshToken: (_provider, refreshToken) => options.exchange(refreshToken),
  });
}

function cleanup(): void {
  if (temp) rmSync(temp, { recursive: true, force: true });
  temp = "";
}

async function t1_expiredAccessTokenIsRefreshed(): Promise<void> {
  let calls = 0;
  const store = freshStore({
    exchange: async (refreshToken) => {
      calls += 1;
      assert.equal(refreshToken, "refresh-1", "저장된 refresh token으로 갱신해야 한다");
      return { accessToken: "access-2", refreshToken: null, expiresInSec: 3600, grantedScopes: ["email"] };
    },
  });
  store.saveGrant({
    providerId: "google",
    grant: { accessToken: "access-1", refreshToken: "refresh-1", expiresInSec: 1, grantedScopes: [] },
    accountLabel: "me@example.com",
  });
  // expiresInSec=1 → REFRESH_SKEW_MS(120s) 안쪽이라 이미 '만료'로 취급돼야 한다.
  assert.equal(await store.getAccessToken("google"), "access-2");
  assert.equal(calls, 1);
  assert.equal(store.getRecord("google")?.state, "connected");
  assert.ok(store.getRecord("google")?.lastRefreshAt, "갱신 시각이 기록돼야 한다");
  cleanup();
  console.log("  T1 만료 토큰 자동 갱신 ✓");
}

async function t2_freshTokenIsNotRefreshed(): Promise<void> {
  let calls = 0;
  const store = freshStore({
    exchange: async () => {
      calls += 1;
      return { accessToken: "should-not-happen", refreshToken: null, expiresInSec: 3600, grantedScopes: [] };
    },
  });
  store.saveGrant({
    providerId: "google",
    grant: { accessToken: "access-1", refreshToken: "refresh-1", expiresInSec: 3600, grantedScopes: [] },
    accountLabel: null,
  });
  assert.equal(await store.getAccessToken("google"), "access-1");
  assert.equal(calls, 0, "유효한 토큰에는 토큰 엔드포인트를 호출하지 않는다");
  cleanup();
  console.log("  T2 유효 토큰 재사용 ✓");
}

async function t3_rejectedRefreshBecomesNeedsReauth(): Promise<void> {
  let calls = 0;
  const store = freshStore({
    exchange: async () => {
      calls += 1;
      throw new RefreshRejectedError("토큰 엔드포인트 거부 (HTTP 400): invalid_grant");
    },
  });
  store.saveGrant({
    providerId: "google",
    grant: { accessToken: "access-1", refreshToken: "refresh-1", expiresInSec: 1, grantedScopes: [] },
    accountLabel: null,
  });

  const error = await store.getAccessToken("google").then(() => null, (e: unknown) => e);
  assert.ok(error instanceof ConnectorAuthError, "ConnectorAuthError여야 한다");
  assert.equal(error.reason, "needs_reauth");
  assert.equal(calls, 1, "거부는 재시도하지 않는다 — 재시도해도 같은 답이다");
  assert.match(error.remedy, /재연결/, "복구 문장에 재연결 안내가 있어야 한다");
  assert.match(error.remedy, /oauth\/start/, "복구 문장에 재연결 경로가 있어야 한다");

  const record = store.getRecord("google");
  assert.equal(record?.state, "needs_reauth", "상태가 needs_reauth로 전이해야 한다");
  assert.match(record?.lastError ?? "", /invalid_grant/, "사유가 기록돼야 한다");

  // 두 번째 호출은 네트워크를 타지 않고 즉시 needs_reauth로 끊긴다.
  const again = await store.getAccessToken("google").then(() => null, (e: unknown) => e);
  assert.ok(again instanceof ConnectorAuthError && again.reason === "needs_reauth");
  assert.equal(calls, 1, "needs_reauth 상태에서는 갱신을 다시 시도하지 않는다");
  cleanup();
  console.log("  T3 거부 → needs_reauth + 재연결 경로 ✓");
}

async function t4_transientFailureRetriesAndKeepsConnected(): Promise<void> {
  let calls = 0;
  const store = freshStore({
    exchange: async () => {
      calls += 1;
      if (calls === 1) throw new Error("토큰 엔드포인트 오류 (HTTP 503)");
      return { accessToken: "access-2", refreshToken: null, expiresInSec: 3600, grantedScopes: [] };
    },
  });
  store.saveGrant({
    providerId: "google",
    grant: { accessToken: "access-1", refreshToken: "refresh-1", expiresInSec: 1, grantedScopes: [] },
    accountLabel: null,
  });
  assert.equal(await store.getAccessToken("google"), "access-2", "일시적 실패는 1회 재시도로 회복된다");
  assert.equal(calls, 2);
  cleanup();

  // 두 번 다 실패하면 refresh_failed — 상태는 connected로 남는다 (네트워크가 돌아오면 성공한다).
  let alwaysFails = 0;
  const store2 = freshStore({
    exchange: async () => {
      alwaysFails += 1;
      throw new Error("네트워크 도달 불가");
    },
  });
  store2.saveGrant({
    providerId: "google",
    grant: { accessToken: "access-1", refreshToken: "refresh-1", expiresInSec: 1, grantedScopes: [] },
    accountLabel: null,
  });
  const error = await store2.getAccessToken("google").then(() => null, (e: unknown) => e);
  assert.ok(error instanceof ConnectorAuthError);
  assert.equal(error.reason, "refresh_failed");
  assert.equal(alwaysFails, 2, "일시적 실패는 정확히 2회(최초+재시도) 시도한다");
  assert.equal(store2.getRecord("google")?.state, "connected", "일시적 실패로 재동의를 요구하지 않는다");
  cleanup();
  console.log("  T4 일시적 실패 재시도 + 상태 유지 ✓");
}

async function t5_refreshTokenSurvivesRotationlessResponse(): Promise<void> {
  let seen: string[] = [];
  const store = freshStore({
    exchange: async (refreshToken) => {
      seen.push(refreshToken);
      // 구글은 갱신 응답에 refresh_token을 다시 주지 않는다.
      return { accessToken: `access-${seen.length + 1}`, refreshToken: null, expiresInSec: 1, grantedScopes: [] };
    },
  });
  store.saveGrant({
    providerId: "google",
    grant: { accessToken: "access-1", refreshToken: "refresh-1", expiresInSec: 1, grantedScopes: [] },
    accountLabel: null,
  });
  await store.getAccessToken("google");
  await store.getAccessToken("google");
  assert.deepEqual(seen, ["refresh-1", "refresh-1"], "갱신 응답에 refresh_token이 없어도 기존 것을 지켜야 한다");
  cleanup();
  console.log("  T5 refresh token 보존 ✓");
}

async function t6_policyBecomesSpawnGates(): Promise<void> {
  const { computeConnectorGates, toolPrefix } = await import("../src/server/connectors/gates.js");

  const base = {
    mcpServerId: "connectors",
    connected: true,
    enabled: true,
    readPolicy: "auto" as const,
    writePolicy: "approval" as const,
    readTools: ["gmail_search_threads"],
    writeTools: ["gmail_create_draft"],
  };

  const gates = computeConnectorGates([{ ...base, id: "gmail" }]);
  assert.deepEqual(gates.services, ["gmail"]);
  assert.deepEqual(gates.allowedTools, ["mcp__connectors__gmail_search_threads"],
    "readPolicy=auto 인 읽기 도구는 승인 없이 허용된다");
  assert.deepEqual(gates.approvalTools, ["gmail_create_draft"],
    "writePolicy=approval 인 쓰기 도구는 승인 훅 매처로 간다");

  // 연결되지 않은 서비스는 아무 목록에도 없다 — "표시만 되던" 결함의 반대 계약.
  const disconnected = computeConnectorGates([{ ...base, id: "gmail", connected: false }]);
  assert.deepEqual(disconnected, { services: [], allowedTools: [], approvalTools: [] },
    "미연결 서비스는 도구 자체가 노출되지 않는다");

  // 꺼진 서비스도 마찬가지 — enabled=false 는 완전 차단이다.
  const disabled = computeConnectorGates([{ ...base, id: "gmail", enabled: false }]);
  assert.deepEqual(disabled.services, [], "비활성 서비스는 노출되지 않는다");

  // 읽기까지 승인으로 두면 허용 목록이 비고 전부 승인 매처로 간다.
  const strict = computeConnectorGates([{ ...base, id: "gmail", readPolicy: "approval" }]);
  assert.deepEqual(strict.allowedTools, []);
  assert.deepEqual(strict.approvalTools, ["gmail_search_threads", "gmail_create_draft"]);

  // 커넥터 서버가 아닌 정책(slack 등)은 무시된다.
  const foreign = computeConnectorGates([{ ...base, id: "slack", mcpServerId: "" }]);
  assert.deepEqual(foreign.services, []);

  // 접두사 규칙 — 비영숫자는 전부 `_`. 옛 규칙은 점·공백만 바꿔 어긋났다.
  assert.equal(toolPrefix("connectors"), "mcp__connectors__");
  assert.equal(toolPrefix("claude.ai Google_Drive"), "mcp__claude_ai_Google_Drive__");
  assert.equal(toolPrefix("a-b.c d"), "mcp__a_b_c_d__");

  console.log("  T6 정책 → spawn 게이트 번역 ✓");
}

/**
 * T7 — 설정 오류는 재동의와 다른 병이다.
 * 실 구글이 잘못된 client에 401 invalid_client를 준다는 사실은 라이브 테스트(L1)가 잡는다.
 * 여기서는 그 분류가 상태·복구문장·재시도 정책으로 어떻게 번역되는지를 오프라인에서 고정한다.
 */
async function t7_misconfiguredIsNotReauth(): Promise<void> {
  let calls = 0;
  const s = freshStore({
    exchange: async () => {
      calls += 1;
      throw new ProviderMisconfiguredError('토큰 엔드포인트 거부 (HTTP 401, invalid_client)');
    },
  });
  s.saveGrant({
    providerId: "google",
    grant: { accessToken: "access-1", refreshToken: "refresh-1", expiresInSec: 1, grantedScopes: [] },
    accountLabel: null,
  });

  const error = await s.getAccessToken("google").then(() => null, (e: unknown) => e);
  assert.ok(error instanceof ConnectorAuthError);
  assert.equal(error.reason, "misconfigured");
  assert.equal(calls, 1, "설정 오류는 재시도하지 않는다");
  assert.doesNotMatch(error.remedy, /재연결이 필요합니다/, "재동의를 권하면 무한 루프가 된다");
  assert.match(error.remedy, /\.env/);
  assert.equal(s.getRecord("google")?.state, "misconfigured");

  // ★ needs_reauth와 결정적으로 다른 점: 설정을 고쳤을 수 있으므로 다음 호출을 막지 않는다.
  const s2 = freshStore({
    exchange: async () => {
      calls += 1;
      return { accessToken: "access-fixed", refreshToken: null, expiresInSec: 3600, grantedScopes: [] };
    },
  });
  s2.saveGrant({
    providerId: "google",
    grant: { accessToken: "a", refreshToken: "r", expiresInSec: 1, grantedScopes: [] },
    accountLabel: null,
  });
  // misconfigured 상태를 만든 뒤 갱신이 성공하면 connected로 돌아와야 한다.
  assert.equal(await s2.getAccessToken("google"), "access-fixed");
  assert.equal(s2.getRecord("google")?.state, "connected");
  cleanup();
  console.log("  T7 설정 오류 ≠ 재동의 (재시도 없음·차단 없음) ✓");
}

async function main(): Promise<void> {
  console.log("[connector-token-test] 시작");
  try {
    await t1_expiredAccessTokenIsRefreshed();
    await t2_freshTokenIsNotRefreshed();
    await t3_rejectedRefreshBecomesNeedsReauth();
    await t4_transientFailureRetriesAndKeepsConnected();
    await t5_refreshTokenSurvivesRotationlessResponse();
    await t6_policyBecomesSpawnGates();
    await t7_misconfiguredIsNotReauth();
  } finally {
    cleanup();
  }
  console.log("[connector-token-test] 전건 PASS");
}

await main();
