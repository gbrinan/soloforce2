# Progress Log

> **각 단계를 완료하거나 문제가 발생하면 업데이트하세요.**

## Session 2026-09-05

### Phase 1: Requirements & Discovery 🔄

**작업 내역**:

1. worktree 생성: `git worktree add ../soloforce2-mcp-agent claude/soloforce2-mcp-agent-rxxkvf` (본 checkout은 main 유지)
2. 읽기 전용 감사: `mcp-registry.ts`, `worker-pty.ts`, `terminal-ws.ts`, `routes.ts`(install), `safefs-server.ts`(ask), `worker-questions.ts`, `key-vault.ts`, `agent-registry.ts`, `config/agents/*`, `loops/*`, `prompts/genie.md`, `docs/org-redesign/spec.md`
3. PlayMCP 조사: 공식 발표·기술 블로그 + 세션 커넥터 실측 도구 목록. 툴박스 페이지 직접 접근은 egress 차단(findings Issue 1)
4. 사이클 문서 6종 작성 (README/spec/plan/tasks/findings/progress)
6. 카카오톡 범위·카톡봇 조사 → findings §카카오톡·§카톡봇·§채널 구조, spec §카카오톡 계층 설계(L1/L2/L3)·채널 관점 개선안 5건 추가
5. 선행 결함 발견: spawn 코드가 참조하는 승인 훅 2개가 리포에 없음 → findings Issue 2, spec 선행 조건 P0, plan Step 0 추가

**생성/수정 파일**:

- `docs/toolbox-concierge/README.md` (새로 생성)
- `docs/toolbox-concierge/spec.md` (새로 생성)
- `docs/toolbox-concierge/plan.md` (새로 생성)
- `docs/toolbox-concierge/tasks.md` (새로 생성)
- `docs/toolbox-concierge/findings.md` (새로 생성)
- `docs/toolbox-concierge/progress.md` (새로 생성)

### Phase 2: Planning & Structure ✅

plan.md 확정. 사용자 승인("진행하자") 후 픽스처를 `resolveFromRegistry` 주입 방식으로 확정.

### Phase 3: Implementation ✅ (2026-09-05, 같은 세션)

**작업 내역**:

1. Step 0 — gbrinan/soloforce 클론(shallow + 400커밋)에서 훅 검색 → 부재 확인 → 3개 훅 재작성 + route-golden 존재 검사
2. Step 1~2 — 레지스트리 타입·시크릿 치환·toolModes·순수 코어 분리, 3개 spawn 경로 배선
3. Step 3~4 — install 라우트·manage_mcp 확장, 키 볼트·.env.example
4. Step 5~6 — 스킬·가이드·라우팅·hermes 1줄, daily-concierge 직원·루프

**생성/수정 파일**:

- `scripts/mcp-approval-hook.mjs`, `scripts/stop-response-hook.mjs`, `scripts/agent-event-hook.mjs` (새로 생성)
- `scripts/mcp-http-registry-test.ts` (새로 생성), `scripts/route-golden-test.cjs`, `config/route-golden.json`, `package.json` (수정)
- `src/server/mcp-registry.ts`, `src/server/worker-pty.ts`, `src/server/terminal-ws.ts`, `src/agent.ts`, `src/server/routes.ts`, `src/mcp/safefs-server.ts`, `src/server/key-vault.ts`, `.env.example` (수정)
- `config/skill-templates/toolbox-concierge.md`, `config/agents/daily-concierge/meta.json`, `config/agents/daily-concierge/role-directive.md`, `loops/daily-concierge-brief.yaml` (새로 생성)
- `config/guides/mcp.md`, `prompts/genie.md`, `config/agents/hermes/role-directive.md`, `README-USER.md` (수정)

### Phase 4: Testing 🔄

정적·단위 검증 완료. 라이브 수동 테스트 5건과 `npm test` 전체는 라이브 머신에서.

## Test Results

| Test | Input | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| tsc --noEmit | 전체 | 0 errors | 0 errors | ✅ |
| mcp-http-registry-test T1~T4 + 훅 존재 | 픽스처 레지스트리 | 23 PASS | 23 PASS | ✅ |
| route-golden-test | 라우트 5·자산 1·훅 3 | 9 PASS | 9 PASS | ✅ |
| 훅 스모크(읽기 도구) | toolModes allow 매칭 | allow JSON, exit 0 | 동일 | ✅ |
| 훅 스모크(발송 도구, 서버 없음) | approval 흐름 | deny, exit 2 | 동일 | ✅ |
| Stop 훅(서버 없음) | 빈 입력 | exit 0 | exit 0 | ✅ |
| 루프 YAML 파싱 | daily-concierge-brief.yaml | OK | OK | ✅ |
| approval-genie-test | — | PASS | node-pty 네이티브 미빌드로 기준선도 실패(세션 환경) | ⏸️ |
| 수동 5건 (plan.md) | 라이브 | — | 미실행 | ⏸️ |

## Error Log

| Timestamp | Error | Attempt | Resolution |
| --- | --- | --- | --- |
| 2026-09-05 | playmcp.kakao.com EGRESS_BLOCKED | 1 | 검색 결과·세션 커넥터 실측으로 대체, Open Question 기록 |
| 2026-09-05 | tsc: node 타입 없음 (worktree에 node_modules 없음) | 1 | `npm ci --ignore-scripts` 후 재실행 |
| 2026-09-05 | approval-genie-test: pty.node 미빌드 | 1 | 세션 환경 한계(ignore-scripts). 변경과 무관, 기준선 동일 실패. 라이브에서 재검증 |

## 5-Question Reboot Check

| Question | Answer |
| --- | --- |
| 1. 현재 어느 단계인가? | Phase 4 (정적 검증 완료, 라이브 검증 대기) |
| 2. 다음에 할 일은? | 라이브: PlayMCP url·토큰 확인 → manage_mcp install/assign → 수동 5건 → 루프 enabled → 1주 후 approval 승격 |
| 3. 목표는? | PlayMCP 툴박스 연결 + 인터뷰 스킬 + daily-concierge 직원 |
| 4. 지금까지 배운 것? | findings.md — 훅 부재 fail-open, -p 경로에도 훅 없었음, 도구 단위 allow는 훅 결정으로 |
| 5. 완료한 작업은? | Step 0~6 전부, 정적 테스트 통과 |
