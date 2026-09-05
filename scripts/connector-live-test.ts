// 커넥터 라이브 E2E — 실제 공급자 엔드포인트를 상대로 검증한다.
//
// npm test에는 넣지 않는다: 네트워크와 (일부는) 실 자격증명이 필요하므로 오프라인 CI에서
// 깨지면 안 된다. 실행: npm run test:connectors:live
//
// 단계별로 필요한 것이 다르다 — 없으면 그 단계만 SKIP하고 무엇이 없어 건너뛰는지 밝힌다.
//   L1  네트워크만                        (실 구글 토큰 엔드포인트의 오류 분류)
//   L2  네트워크만                        (실 Drive API의 401 형태)
//   L3  GOOGLE_OAUTH_CLIENT_ID/SECRET     (폐기된 refresh token → 재동의 분기)
//   L4  + GOOGLE_OAUTH_REFRESH_TOKEN      (실계정 Drive·Gmail 왕복)

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { ConnectorTokenStore, ConnectorAuthError } from "../src/server/connectors/token-store.js";

const KEY = Buffer.alloc(32, 11).toString("base64");
let temp = "";
let skipped = 0;

function store(env: Record<string, string | undefined>): ConnectorTokenStore {
  temp = mkdtempSync(join(tmpdir(), "connector-live-"));
  return new ConnectorTokenStore({
    historyDir: temp,
    env: { ...env, SOLOFORCE_CONNECTION_ENCRYPTION_KEY: KEY },
  });
}
function cleanup(): void {
  if (temp) rmSync(temp, { recursive: true, force: true });
  temp = "";
}
function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
function skip(name: string, need: string): void {
  skipped += 1;
  console.log(`  ${name} SKIP — ${need} 없음`);
}

/**
 * L1 — 실제 구글이 잘못된 client에 무엇을 주는지, 그리고 우리가 그것을 어떻게 부르는지.
 *
 * 이 테스트가 지키는 것: 설정 오류를 재동의로 안내하지 않는다. 실제 구글은
 * HTTP 401 {"error":"invalid_client"} 를 주는데, 이걸 needs_reauth로 부르면
 * 사용자는 원인이 .env인 줄 모르고 재연결만 무한 반복한다.
 */
async function l1_googleRejectsBadClientAsMisconfigured(): Promise<void> {
  // refreshViaHttp는 process.env에서 client를 읽는다 (실 갱신 경로 그대로 태우기 위함).
  const saved = { id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET };
  process.env.GOOGLE_OAUTH_CLIENT_ID = "definitely-not-a-real-client.apps.googleusercontent.com";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "definitely-not-a-real-secret";
  try {
    const s = store({ GOOGLE_OAUTH_CLIENT_ID: "x", GOOGLE_OAUTH_CLIENT_SECRET: "y" });
    s.saveGrant({
      providerId: "google",
      grant: { accessToken: "stale", refreshToken: "stale-refresh", expiresInSec: 1, grantedScopes: [] },
      accountLabel: null,
    });
    const error = await s.getAccessToken("google").then(() => null, (e: unknown) => e);
    assert.ok(error instanceof ConnectorAuthError, `ConnectorAuthError여야 한다 (받은 것: ${String(error)})`);
    assert.equal(error.reason, "misconfigured",
      "실 구글의 invalid_client(401)는 설정 오류로 분류돼야 한다 — 재동의로는 안 고쳐진다");
    assert.match(error.detail, /invalid_client/, "실제 구글 오류 코드가 사유에 남아야 한다");
    // 재동의를 **권유**하지 않아야 한다. ("재연결해도 고쳐지지 않습니다"는 반대로 말리는 문장이라 통과)
    assert.doesNotMatch(error.remedy, /재연결이 필요합니다/,
      "설정 오류에 재연결을 권하면 사용자가 무한 루프에 빠진다");
    assert.match(error.remedy, /재연결해도 고쳐지지 않습니다/, "재연결이 헛수고임을 명시해야 한다");
    assert.match(error.remedy, /\.env/, "복구 문장이 .env를 가리켜야 한다");
    assert.equal(s.getRecord("google")?.state, "misconfigured");
    cleanup();
    console.log("  L1 실 구글 invalid_client → misconfigured ✓");
  } finally {
    // ※ process.env.X = undefined 는 문자열 "undefined"를 넣는다 — 뒤 단계가 그 값을
    //   진짜 client로 알고 돌아버린다. 없던 키는 반드시 delete로 되돌린다.
    restoreEnv("GOOGLE_OAUTH_CLIENT_ID", saved.id);
    restoreEnv("GOOGLE_OAUTH_CLIENT_SECRET", saved.secret);
  }
}

/** L2 — 실제 Drive API의 401이 사람이 읽을 수 있는 오류로 올라오는지. */
async function l2_driveRejectsBadToken(): Promise<void> {
  const response = await fetch("https://www.googleapis.com/drive/v3/files?pageSize=1", {
    headers: { authorization: "Bearer definitely-invalid" },
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(response.status, 401, "실 Drive API는 잘못된 토큰에 401을 준다");
  const body = await response.text();
  assert.match(body, /invalid authentication credentials/i, "오류 본문이 원인을 말해야 한다");
  console.log("  L2 실 Drive API 401 형태 확인 ✓");
}

/** L3 — 유효한 client + 폐기된 refresh token → 재동의 분기 (실 자격증명 필요). */
async function l3_revokedRefreshTokenNeedsReauth(): Promise<void> {
  if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return skip("L3 폐기 토큰 → needs_reauth", "GOOGLE_OAUTH_CLIENT_ID/SECRET");
  }
  const s = store({
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  });
  s.saveGrant({
    providerId: "google",
    grant: { accessToken: "stale", refreshToken: "1//revoked-token-probe", expiresInSec: 1, grantedScopes: [] },
    accountLabel: null,
  });
  const error = await s.getAccessToken("google").then(() => null, (e: unknown) => e);
  assert.ok(error instanceof ConnectorAuthError);
  assert.equal(error.reason, "needs_reauth",
    "유효한 client + 죽은 refresh token은 재동의로 고쳐진다 — 설정 오류가 아니다");
  assert.match(error.remedy, /재연결/);
  assert.equal(s.getRecord("google")?.state, "needs_reauth");
  cleanup();
  console.log("  L3 실 구글 invalid_grant → needs_reauth ✓");
}

/** L4 — 실계정 왕복: 갱신 → Drive 검색 → Gmail 라벨 (실 refresh token 필요). */
async function l4_realAccountRoundTrip(): Promise<void> {
  if (!process.env.GOOGLE_OAUTH_REFRESH_TOKEN
      || !process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return skip("L4 실계정 Drive·Gmail 왕복", "GOOGLE_OAUTH_REFRESH_TOKEN(+CLIENT_ID/SECRET)");
  }
  const s = store({
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_REFRESH_TOKEN: process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
  });

  // env 정적 토큰이 연결로 승격되고, 첫 호출이 실제 갱신을 태운다.
  const token = await s.getAccessToken("google");
  assert.ok(token.length > 20, "실 액세스 토큰을 받아야 한다");
  assert.equal(s.getRecord("google")?.state, "connected");

  const drive = await fetch(
    "https://www.googleapis.com/drive/v3/files?pageSize=3&q=trashed%20%3D%20false"
      + "&fields=files(id,name,mimeType,modifiedTime)",
    { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) },
  );
  assert.equal(drive.status, 200, `Drive 검색이 200이어야 한다 (받은 것: ${drive.status} ${await drive.text()})`);
  const files = (await drive.json() as { files?: Array<{ id: string; name: string }> }).files ?? [];
  console.log(`     Drive 파일 ${files.length}건: ${files.map((f) => f.name).join(", ") || "(빈 드라이브)"}`);

  const gmail = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
  });
  assert.equal(gmail.status, 200, `Gmail 라벨 조회가 200이어야 한다 (받은 것: ${gmail.status} ${await gmail.text()})`);
  const labels = (await gmail.json() as { labels?: unknown[] }).labels ?? [];
  console.log(`     Gmail 라벨 ${labels.length}개`);

  // 두 번째 호출은 캐시된 토큰을 재사용해야 한다 (같은 토큰 = 갱신 안 함).
  assert.equal(await s.getAccessToken("google"), token, "유효 토큰은 재사용돼야 한다");
  cleanup();
  console.log("  L4 실계정 Drive·Gmail 왕복 ✓");
}

async function main(): Promise<void> {
  console.log("[connector-live-test] 시작 — 실제 공급자 엔드포인트 대상");
  try {
    await l1_googleRejectsBadClientAsMisconfigured();
    await l2_driveRejectsBadToken();
    await l3_revokedRefreshTokenNeedsReauth();
    await l4_realAccountRoundTrip();
  } finally {
    cleanup();
  }
  console.log(`[connector-live-test] 완료 — SKIP ${skipped}건`);
  if (skipped > 0) {
    console.log("  ※ SKIP된 단계는 실 자격증명이 있는 환경에서 다시 돌리세요 (docs/connector-tools/e2e.md)");
  }
}

await main();
