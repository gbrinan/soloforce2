# Feature Specification: 커넥터 툴 (Drive · Gmail · Notion)

## Overview

마이크루 에이전트(지니·워커)가 Google Drive, Gmail, Notion을 **실제로** 도구로 호출할 수
있게 한다. 지금 설정 화면의 "연결된 서비스"는 표시만 되고 실체가 없다 — 에이전트가 쓸
MCP 서버도, OAuth 토큰도, 갱신 경로도 없다. 이 기능은 그 셋을 채운다.

동시에 "OAuth session expired and could not be refreshed" 로 대표되는 만료 실패를
**복구 가능한 상태**로 바꾼다: 만료는 조용한 실패가 아니라 `needs_reauth` 상태 + 재연결
링크로 드러나야 한다.

## User Scenarios & Testing (mandatory)

### User Story 1: 구글 계정을 한 번 연결한다

- As: 마이크루 소유자는
- I: 설정에서 Google을 한 번 연결하면
- So: 지니와 워커가 Drive·Gmail·Calendar를 승인 정책대로 쓸 수 있다

#### Acceptance Scenarios

Scenario 1: **최초 연결**
- Given: `GOOGLE_CONNECTOR_CLIENT_ID/SECRET`이 설정돼 있고 연결이 없다
- When: 설정 → 연결에서 "Google 연결"을 누른다
- Then: 구글 동의 화면으로 이동하고, 콜백 후 상태가 `connected`, 계정 이메일이 표시된다

Scenario 2: **액세스 토큰 만료**
- Given: 연결이 `connected`이고 액세스 토큰이 만료됐다
- When: 에이전트가 `drive_search_files`를 호출한다
- Then: refresh token으로 조용히 갱신되고 호출이 성공한다 (사용자 개입 없음)

Scenario 3: **refresh token 폐기 (재현된 결함)**
- Given: 사용자가 구글 계정 설정에서 앱 접근을 취소했다
- When: 에이전트가 도구를 호출한다
- Then: 연결 상태가 `needs_reauth`로 바뀌고, 도구는 "재연결이 필요합니다 + 재연결 경로"를
  담은 오류를 돌려준다. 조용히 실패하지 않는다.

### User Story 2: 노션을 연결한다

- As: 소유자는
- I: Notion 내부 통합 토큰(`NOTION_API_TOKEN`) 또는 OAuth 중 하나로 연결하면
- So: 에이전트가 노션 검색·조회·페이지 생성을 할 수 있다

### User Story 3: 승인 정책이 실제로 걸린다

- As: 소유자는
- I: 설정에서 Gmail 쓰기를 "승인"으로 두면
- So: 에이전트의 `gmail_create_draft` 호출이 승인 카드로 올라오고, 읽기는 자동 통과한다

#### Acceptance Scenarios

Scenario 1: **정책 반영**
- Given: `gmail` 서비스의 `writePolicy = approval`, `readPolicy = auto`
- When: 지니/워커 PTY가 (재)spawn된다
- Then: `mcp__connectors__gmail_search_threads`는 허용 목록에, 쓰기 도구는 PreToolUse
  승인 훅 매처에 들어간다

Scenario 2: **서비스 비활성**
- Given: `gmail` 서비스의 `enabled = false`
- When: 에이전트가 Gmail 도구를 호출한다
- Then: 도구 자체가 차단된다 (허용 목록에도, 승인 매처에도 없음)

## Out of Scope

- Slack·Asana 커넥터 (정책 표에만 남는다)
- 캘린더 쓰기 도구의 반복 일정·참석자 협상
- 기존 `google-readonly-*` (프로젝트 ingest) 경로의 대체 — 그쪽은 그대로 둔다

## Success Criteria

1. `GET /api/connectors`가 provider별 실제 상태(configured/connected/needs_reauth)를 낸다
2. 지니 PTY의 MCP config에 `connectors` 서버가 실려 도구가 등록된다
3. 만료된 액세스 토큰이 자동 갱신된다 (계약 테스트로 증명)
4. `invalid_grant`가 `needs_reauth` + 재연결 경로로 드러난다 (계약 테스트로 증명)
5. 서비스 정책의 read/write 모드가 spawn 인자에 반영된다 (계약 테스트로 증명)
