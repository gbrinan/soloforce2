# Tasks: 커넥터 툴 (Drive · Gmail · Notion)

## Goal

Google Drive·Gmail·Calendar·Notion을 마이크루 에이전트의 실제 도구로 만들고,
OAuth 만료를 복구 가능한 상태로 바꾼다.

## Current Phase

✅ Phase 5: 실계정 E2E (L3·L4는 실 자격증명 대기)

## Phases

### Phase 1: Requirements & Discovery ✅

- [x] 기존 `google-readonly-*` 경로 감사 — 목적(ingest)과 요구(도구 표면)가 다름을 확인
- [x] `service-policies` 감사 — `connected` 하드코딩·죽은 `mcpServerId` 접두사 결함 2건 발견
- [x] spawn 경로 감사 — 정책이 지니·워커 PTY에 닿지 않음을 확인
- [x] 필요한 외부 API 확정 (Drive v3 · Gmail v1 · Calendar v3 · Notion 2022-06-28)

### Phase 2: 토큰 계층 ✅

- [x] `catalog.ts` — provider/service/도구/스코프 정본
- [x] `vault.ts` — AES-256-GCM 금고 + 키 자동 생성
- [x] `token-store.ts` — 갱신·만료 3분류·env 정적 토큰 승격
- [x] `gates.ts` — 정책 → spawn 게이트 순수 변환
- [x] 계약 테스트 T1–T6 작성·통과

### Phase 3: 표면 배선 ✅

- [x] `routes.ts` + `/api/connectors` 마운트
- [x] `connectors-server.ts` — 도구 14종
- [x] 지니 PTY(`terminal-ws.ts`) 탑재 + 허용/승인 게이트
- [x] 워커 PTY(`worker-pty.ts`) 탑재 + 허용/승인 게이트
- [x] `service-policies` 정본 이관 + 접두사 교정 + `connected` 실시간화
- [x] 설정 화면 `ConnectorPanel`

### Phase 4: 문서·마감 ✅

- [x] `.env.example` — 필요한 API·스코프·리디렉션 URI
- [x] `README.md` 환경변수 표 / `README-USER.md` 사용자 안내
- [x] `CLAUDE.md` 커넥터 규약 (정본 위치·시스템 서버 근거·비밀 격리)
- [x] `npm test`에 계약 테스트 편입

### Phase 5: 실계정 E2E ✅

- [x] 공급자 엔드포인트 도달성 확인
- [x] **결함 4 수정** — 설정 오류(`misconfigured`)와 재동의(`needs_reauth`) 분리
- [x] 라이브 테스트 L1·L2 통과 (`npm run test:connectors:live`)
- [x] 오프라인 회귀 T7 추가
- [x] 서버 실기동 + MCP 도구 전 구간 왕복 확인
- [ ] L3 폐기 토큰 → `needs_reauth` (실 `GOOGLE_OAUTH_CLIENT_ID/SECRET` 필요)
- [ ] L4 실계정 Drive·Gmail 왕복 (실 `GOOGLE_OAUTH_REFRESH_TOKEN` 필요)
- [ ] Notion 실호출 (`api.notion.com`이 프록시 allowlist 밖 — 로컬에서 확인)

## Out of Scope

- Slack·Asana 커넥터 (정책 표에 미연결로 남김)
- 기존 `google-readonly-*` ingest 경로 대체
