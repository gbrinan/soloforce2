# Progress Log — 커넥터 툴

## Session 2026-09-04

### Phase 1: Requirements & Discovery ✅

**작업 내역**

1. `git push` 인증 재확인 — `git ls-remote` / `push --dry-run` 모두 통과.
   보고된 "OAuth session expired and could not be refreshed"는 이전 세션의 만료된
   자격증명 때문이었고 현재 세션에서는 재현되지 않는다. 리포 코드에는 그 문자열이 없다.
2. 그 실패가 가리키는 **리포 안의 같은 병**을 찾음: 커넥터 토큰 갱신에도 복구 경로가 없다.
3. 읽기 전용 감사 결과 결함 3건 확정 → `findings.md`.

**발견**: 설정 화면이 "연결됨"으로 보여 주던 5개 서비스 뒤에는 아무 연결도, MCP 서버도 없었다.
차단 목록 접두사(`mcp__claude_ai_Google_Drive__`)는 존재한 적 없는 서버를 가리켜 늘 공집합이었다.

### Phase 2: 토큰 계층 ✅

**생성 파일**: `src/server/connectors/{catalog,vault,token-store,gates}.ts`,
`scripts/connector-token-test.ts`

**결정**: 기존 `google-readonly-*`를 고치지 않고 옆에 지었다 — 목적이 다르고 계약 테스트
4종이 그 모양을 고정하고 있다(findings D1).

**검증**: T1–T6 전건 PASS.

### Phase 3: 표면 배선 ✅

**생성 파일**: `src/server/connectors/routes.ts`, `src/mcp/connectors-server.ts`,
`src/client/components/Settings/ConnectorPanel.tsx`

**수정 파일**: `service-policies.ts`, `config/service-policies.json`,
`terminal-ws.ts`, `worker-pty.ts`, `create-server-app.ts`,
`src/client/utils/api.ts`, `ServicePolicyPanel.tsx`

**검증 (수동)**

- `GET /api/connectors` → provider 2종 실제 상태
- `POST /google/oauth/start` 미설정 → 503 + 필요한 env 이름
- `POST /google/oauth/start` 설정 후 → `access_type=offline`·`prompt=consent`·PKCE S256 포함 URL
- `POST /google/access-token` 토큰 없음 → 401 / 토큰 있고 미연결 → 403 + 재연결 안내 문장
- MCP `tools/list` → 도구 14종 등록, `MCP_CONNECTOR_SERVICES`에서 뺀 calendar 도구는 미등록

### Phase 4: 문서·마감 ✅

`.env.example`(필요 API·스코프·리디렉션 URI), `README.md`, `README-USER.md`, `CLAUDE.md` 반영.
`npm test`에 `test:connectors` 편입.

**회귀 확인**: 변경 전/후 `npm test` 출력 비교 — 차이는 랜덤 UUID 뿐.
기존 23건 FAIL은 `history/agents.json`이 없는 새 클론에서 나는 사전 실패로, 변경 전에도 동일하다.

### Phase 5: 실계정 E2E ✅ (일부 SKIP)

**작업 내역**

1. 공급자 엔드포인트 도달성 확인 — 구글 O, `api.notion.com`은 이 컨테이너 프록시 allowlist 밖
2. **결함 4 발견·수정**: 실 구글의 `401 invalid_client`를 재동의로 오진하던 문제.
   `misconfigured` 상태를 새로 두고 재시도·차단·복구문장·UI를 모두 갈랐다
3. 라이브 계약 테스트 `scripts/connector-live-test.ts` (L1–L4) — `npm test`와 분리
   (네트워크·실 자격증명 의존이라 오프라인 CI를 깨면 안 된다)
4. 오프라인 회귀 T7 추가 — 설정 오류 분기를 자격증명 없이도 지킨다
5. 서버 실기동(`PORT=3467`) → `/api/connectors`·`/api/service-policies`·브로커 라이브 확인
6. MCP 서버를 실기동 호스트에 붙여 도구 호출 → 실 구글까지 왕복

**검증 결과**: L1·L2 PASS, L3·L4 SKIP(자격증명 없음). 앱 사슬 전 구간 동작 확인.
상세와 남은 절차: `e2e.md`.

**부수 발견**: 테스트에서 `process.env.X = undefined`가 문자열 `"undefined"`를 넣어
뒤 단계가 그 값을 진짜 client로 알고 도는 함정. `restoreEnv()`로 `delete` 처리.

### Phase 6: 로컬 완주 준비 ✅

L3·L4를 사용자가 자기 머신에서 바로 돌릴 수 있게 두 가지 마찰을 없앴다.

1. **`.env`가 라이브 테스트에 안 실렸다** — `.env` 파싱이 `src/index.ts` 부팅 코드에만
   있어 스크립트는 못 봤다. `src/load-dotenv.ts`로 빼 둘이 공유한다(SSOT).
   이 모듈은 node 내장만 import한다 — `config.ts`가 평가 시점에 `process.env`를 굳히므로
   `.env` 적용 전에 그 그래프가 딸려오면 안 되기 때문이다.
2. **L4가 refresh token을 env로 요구했다** — 그런데 그 값은 금고에 AES-GCM으로 봉인돼
   있어 사람이 꺼낼 수 없다(`e2e.md` 초안이 `connections.json`에서 꺼내라고 잘못 적었다).
   L4가 **설정 화면에서 만든 실제 연결을 그대로 태우도록** 고쳤다 — 사용자가 겪는 경로와
   같아져 검증 가치도 올라갔다.

**회귀 확인**: 부팅 경로를 건드렸으므로 서버 실기동으로 확인(`/api/connectors` 200).
서버·클라이언트 typecheck 통과, 커넥터 계약 테스트 T1–T7 PASS.

※ 이 환경의 `npm test`는 `route-keyword-collision-test`(실 `history/agents.json` 필요)에서
`&&` 체인이 끊겨 커넥터 테스트까지 도달하지 않는다. 변경 전에도 동일한 사전 실패다 —
커넥터 테스트는 `npm run test:connectors`로 단독 검증했다.

## 남은 것 (다음 사이클 후보)

- 실계정 E2E 잔여분 L3·L4 — 실 OAuth client가 있는 환경에서 완주 (`e2e.md` 절차)
- Slack 커넥터 (정책 표에 미연결로 남아 있다)
- Notion 데이터베이스 질의 도구(`query_data_source`) — 현재는 검색·페이지 단위만
