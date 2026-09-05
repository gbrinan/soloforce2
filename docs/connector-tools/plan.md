# Implementation Plan: 커넥터 툴 (Drive · Gmail · Notion)

## Summary

provider(인증 단위) 다중 토큰 계층을 새로 만들고, 그 위에 `connectors` MCP 서버를 얹어
에이전트에게 14개 도구를 연다. 노출 여부는 **실제 연결 상태 × 서비스 정책**이 가른다.

## Requirements

1. Drive·Gmail·Calendar·Notion을 에이전트가 실제로 호출할 수 있어야 한다
2. 액세스 토큰 만료는 자동 갱신되고, 갱신 거부는 재연결 경로로 드러나야 한다
3. 설정 화면의 auto/approval 정책이 지니·워커 PTY의 spawn 인자에 반영돼야 한다
4. 연결되지 않은 서비스는 "연결됨"으로 표시되지 않아야 한다

## Critical Files

### New Files

| 파일 | 역할 |
|---|---|
| `src/server/connectors/catalog.ts` | provider·service·도구 이름·스코프 정본 |
| `src/server/connectors/vault.ts` | AES-256-GCM 토큰 금고 (키 자동 생성 포함) |
| `src/server/connectors/token-store.ts` | 연결 기록 + 액세스 토큰 갱신 (만료 3분류) |
| `src/server/connectors/gates.ts` | 정책 → spawn 게이트 순수 변환 |
| `src/server/connectors/routes.ts` | 상태/OAuth/해제/토큰 브로커 |
| `src/mcp/connectors-server.ts` | stdio MCP 서버 — 도구 14종 |
| `src/client/components/Settings/ConnectorPanel.tsx` | 연결 UI |
| `scripts/connector-token-test.ts` | 계약 테스트 T1–T6 |

### Modified Files

| 파일 | 변경 |
|---|---|
| `src/server/service-policies.ts` | 정본을 카탈로그로 이관, `connected` 실시간 덮어쓰기, 접두사 규칙 교정, 게이트 노출 |
| `config/service-policies.json` | 죽은 `mcpServerId`·도구 이름 교체, `connected` 거짓말 제거 |
| `src/server/terminal-ws.ts` · `src/server/worker-pty.ts` | `connectors` 서버 탑재 + 허용/승인 게이트 |
| `src/server/create-server-app.ts` | `/api/connectors` 마운트 |
| `.env.example` · `README.md` · `README-USER.md` · `CLAUDE.md` | 설정·사용·메커니즘 |

## Approach

### 1. 토큰 계층 (수리의 본체)

`getAccessToken(provider)`가 유일한 진입점이다. 만료를 셋으로 가른다:

- 액세스 토큰 만료 → refresh token으로 조용히 갱신 (`REFRESH_SKEW_MS = 120s` 선제)
- 일시적 5xx/네트워크 → 1회 재시도, 상태는 `connected` 유지
- `invalid_grant`/401 → `needs_reauth` 전이 + `remedy` 문장에 재연결 경로

구글은 갱신 응답에 `refresh_token`을 다시 주지 않으므로 기존 값을 보존한다(T5).

### 2. 노출 게이트

`computeConnectorGates(policies)` 순수 함수가 셋을 낸다:
`services`(MCP 자식이 등록할 서비스) / `allowedTools`(승인 없이) / `approvalTools`(승인 훅).
`connected=false` 또는 `enabled=false`면 세 목록 어디에도 들어가지 않는다 — 도구가 아예 없다.

### 3. 비밀 격리

refresh token은 호스트 프로세스에만 산다. MCP 자식은 브로커에 매 호출 되물어 액세스
토큰만 받는다. 브로커 인증 토큰은 env가 아니라 0600 파일로 넘긴다(프로세스 목록 유출 방지).

## Testing Strategy

`scripts/connector-token-test.ts` (npm test에 편입, `npm run test:connectors`로 단독 실행):

| 테스트 | 고정하는 계약 |
|---|---|
| T1 | 만료 토큰 자동 갱신 |
| T2 | 유효 토큰은 갱신하지 않음 |
| T3 | 거부 → `needs_reauth` + 재연결 경로, 재시도 없음 |
| T4 | 일시적 실패 1회 재시도, 상태 유지 |
| T5 | 갱신 응답에 refresh_token이 없어도 보존 |
| T6 | 정책 → 게이트 번역, 미연결·비활성은 미노출, 접두사 규칙 |

수동 검증: 커넥터 라우트 6종 응답, MCP 서버 `tools/list` 14종 + 서비스 게이팅.
