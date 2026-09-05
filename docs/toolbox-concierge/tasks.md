# Tasks: 툴박스 컨시어지

## Goal

PlayMCP 툴박스를 MyCrew에 붙이고, 마이크루가 요구를 인터뷰해 도구를 매핑·할당하며, daily-concierge 직원이 아침 브리핑 → 카톡 발송을 반복 수행한다.

## Current Phase

🔄 Phase 4: Testing (코드·설정 구현 완료, 라이브 수동 테스트 대기)

## Phases

### Phase 1: Requirements & Discovery ✅

- [x] 요구사항 정의
- [x] 기존 코드 분석 (레지스트리·spawn·ask·키 볼트·루프)
- [x] 스펙 문서 작성 (spec.md)
- [x] 스펙 리뷰 및 승인 — 사용자 "진행하자"(2026-09-05). Open Questions는 가정으로 진행: draft_only 시작, 운영팀 소속
- [ ] PlayMCP 게이트웨이 URL·헤더·OTT 만료 확인 (사용자 로컬) — install 시 url 인자로 입력

### Phase 2: Planning & Structure ✅

- [x] 구현 계획 작성 (plan.md)
- [x] 테스트 픽스처 확정 — `resolveFromRegistry` 순수 코어를 노출해 레지스트리 주입
- [x] 훅 매처: 서버당 `mcp__<name>__.*` 1개 유지, 도구별 판정은 훅이 `MYCREW_MCP_TOOL_MODES`로 수행 (`|` 결합 불필요)

### Phase 3: Implementation ✅

- [x] Step 0 승인 훅 복원 — 이전 리포(gbrinan/soloforce)에도 없어 **재작성**: `mcp-approval-hook.mjs`(fail-closed exit 2, toolModes 판정), `stop-response-hook.mjs`, `agent-event-hook.mjs` + route-golden `hookScripts` 존재 검사
- [x] Step 1 `mcp-registry.ts`: `type/url/headers/toolModes`, `interpolateSecrets`, `buildSpawnEntry`, `resolveFromRegistry`(errors 반환)
- [x] Step 2 spawn 배선: `worker-pty.ts`·`terminal-ws.ts`에 `MYCREW_MCP_TOOL_MODES`; `agent.ts`(-p 잡 경로)에 http 엔트리·시크릿 치환·**PreToolUse 훅 + 훅 env 신규 배선**(이전엔 -p 경로에 승인 훅이 아예 없었음)
- [x] Step 3 `POST /api/mcp/install` url/headers/toolModes 수용 + 토큰 실값 400 거부; `manage_mcp` 스키마 확장
- [x] Step 4 키 볼트 `playmcp` 프리셋 + `.env.example` `PLAYMCP_TOKEN`
- [x] Step 5 `config/skill-templates/toolbox-concierge.md`, `config/guides/mcp.md` 3절 추가, `prompts/genie.md` 라우팅 2행, hermes 지시서 "채널" 일반화
- [x] Step 6 `config/agents/daily-concierge/{meta.json,role-directive.md}`, `loops/daily-concierge-brief.yaml`(enabled: false, draft_only)
- [ ] 기존 직원 강화 assign 3건 (spf-comms·trend-scout·lead-keeper) — 라이브에서 `manage_mcp assign` (운영 데이터, 커밋 없음)

### Phase 4: Testing 🔄

- [x] `npx tsc --noEmit` 통과
- [x] `scripts/mcp-http-registry-test.ts` 23/23 PASS, `route-golden-test` 9 PASS, 루프 YAML 파싱 OK
- [x] 훅 스모크: 읽기 도구 → allow JSON exit 0 / 발송 도구 서버 미응답 → deny exit 2 / Stop 훅 항상 exit 0
- [ ] `npm test` 전체 — 이 세션은 `--ignore-scripts` 설치라 node-pty 네이티브 미빌드로 approval-genie-test가 기준선에서도 실패. 라이브 머신에서 재실행
- [ ] 수동 테스트 5건 (plan.md Verification) — 라이브
- [ ] 콜드리드: 스킬 파일·역할 지시서
- [x] README/CLAUDE.md 반영 게이트 — 메커니즘은 `config/guides/mcp.md`, 사용자 대면은 README-USER 키 표 1행

## Notes

- 진행할 때마다 Phase 상태를 업데이트하세요: ⏸️ 대기 → 🔄 진행 중 → ✅ 완료
- 결정 사항은 findings.md의 Technical Decisions에 기록하세요.
- 오류는 findings.md의 Issues Encountered에 기록하세요.
- 변이 전 순서: 읽기 전용 감사(완료) → 계획 보고(이 문서) → 승인 → 실행
