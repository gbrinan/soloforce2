# Tasks: 툴박스 컨시어지

## Goal

PlayMCP 툴박스를 MyCrew에 붙이고, 마이크루가 요구를 인터뷰해 도구를 매핑·할당하며, daily-concierge 직원이 아침 브리핑 → 카톡 발송을 반복 수행한다.

## Current Phase

🔄 Phase 1: Requirements & Discovery (스펙 리뷰·승인 대기)

## Phases

### Phase 1: Requirements & Discovery 🔄

- [x] 요구사항 정의
- [x] 기존 코드 분석 (레지스트리·spawn·ask·키 볼트·루프)
- [x] 스펙 문서 작성 (spec.md)
- [ ] 스펙 리뷰 및 승인 — 사용자 결정 3건 (Open Questions)
- [ ] PlayMCP 게이트웨이 URL·헤더·OTT 만료 확인 (사용자 로컬)

### Phase 2: Planning & Structure ⏸️

- [x] 구현 계획 작성 (plan.md)
- [ ] `scripts/mcp-env-passthrough-test.ts` 선례 정독 후 테스트 픽스처 확정
- [ ] `mcp-approval-hook.mjs`가 매처 패턴 결합(`|`)을 그대로 받는지 확인

### Phase 3: Implementation ⏸️

- [ ] Step 1 레지스트리 타입·해석 (`mcp-registry.ts`) + 테스트
- [ ] Step 2 spawn 배선 (`worker-pty.ts`, `terminal-ws.ts`)
- [ ] Step 3 설치 경로 (`routes.ts`, `safefs-server.ts` manage_mcp)
- [ ] Step 4 키 볼트 프리셋 + `.env.example`
- [ ] Step 5 스킬·가이드·라우팅 표
- [ ] Step 6 daily-concierge 직원·루프 (enabled: false)
- [ ] 기존 직원 강화 assign 3건 (spf-comms·trend-scout·lead-keeper) — 운영 데이터라 커밋 없음, 절차만 progress에 기록

### Phase 4: Testing ⏸️

- [ ] `npx tsc --noEmit`
- [ ] `npm test` (새 스크립트 포함)
- [ ] 수동 테스트 5건 (plan.md Verification)
- [ ] 콜드리드: 스킬 파일·역할 지시서를 zero-context 세션이 읽고 절차를 재서술
- [ ] README/CLAUDE.md 반영 게이트 — 메커니즘(HTTP MCP·toolModes)은 `config/guides/mcp.md`, 사용자 대면은 README-USER

## Notes

- 진행할 때마다 Phase 상태를 업데이트하세요: ⏸️ 대기 → 🔄 진행 중 → ✅ 완료
- 결정 사항은 findings.md의 Technical Decisions에 기록하세요.
- 오류는 findings.md의 Issues Encountered에 기록하세요.
- 변이 전 순서: 읽기 전용 감사(완료) → 계획 보고(이 문서) → 승인 → 실행
