# Findings & Decisions — 커넥터 툴

## 읽기 전용 감사 (2026-09-04)

### 결함 1 — 연결 상태가 하드코딩된 거짓말

`config/service-policies.json` / `src/server/service-policies.ts:DEFAULT_POLICIES`가
google-drive·gmail·google-calendar·notion·slack을 전부 `connected: true`로 박아 둔다.
어떤 OAuth 연결도, 어떤 MCP 서버도 뒤에 없다. 설정 화면
(`ServicePolicyMatrix`)은 `connected && enabled`인 서비스만 표에 그리므로,
사용자는 "연결됨"을 보지만 에이전트는 그 도구를 호출할 수 없다.
→ **이것이 "툴의 프로젝트 부분에 반영이 안 된다"의 실체다.**

### 결함 2 — 차단 접두사가 아무 도구와도 매칭되지 않는다

`getPolicyDisallowedTools()`는 `mcpServerId`("claude.ai Google_Drive")를
`mcp__claude_ai_Google_Drive__` 로 바꿔 차단 목록을 만든다. 그런 이름의 MCP 서버는
존재하지 않으므로 차단 목록은 **항상 공집합과 같다**. 정책 UI를 어떻게 돌려도
에이전트 동작은 바뀌지 않았다.

또 이 목록은 `jobs.ts:2097`(runWorkerAgent → src/agent.ts)에만 실린다. 지니 PTY
(`terminal-ws.ts`)와 워커 PTY(`worker-pty.ts`)는 이 경로를 타지 않아, 정책이
인터랙티브 세션에는 애초에 닿지 않았다.

### 결함 3 — 갱신 실패에 복구 경로가 없다

`google-readonly-provider.ts`는 refresh를 하지만 실패를 전부
`GoogleProviderError("token_refresh")` 하나로 뭉갠다. 호출자
(`google-readonly-service.ts`)는 이를 `provider_failure`로 바꿔 502를 낸다.
`invalid_grant`(사용자가 앱 접근 취소 = 재동의 필요)와 일시적 5xx가 구분되지 않으므로
"만료됐고 갱신도 안 된다"는 막다른 골목이 된다. 상태 전이(`needs_reauth`)도,
재연결 링크도 없다.

### 자산 — 재사용할 수 있는 것

- `EncryptedConnectionSecretBroker` (AES-256-GCM, 0600, revoke) — 암호화 패턴 정본
- PKCE 트랜잭션 레지스트리 (`GoogleConnectionRegistry`) — state/verifier 1회성 소비
- `resolveAgentMcpServers` + `buildMcpServerEntry` — spawn 배선 지점
- `src/mcp/appdata-server.ts` — 항상 실리는 시스템 MCP 서버의 선례 (지니 전용)
- `@notionhq/notion-mcp-server`가 이미 dependency에 있다 (미배선)

### 결함 4 — 설정 오류를 재동의로 오진 (라이브 E2E에서 발견, 2026-09-04)

실 `oauth2.googleapis.com`은 잘못된 client id/secret에 `HTTP 401 {"error":"invalid_client"}`
를 준다. 초기 구현은 토큰 엔드포인트의 400·401을 전부 `needs_reauth`로 처리해, 원인이
`.env`인데 사용자에게 재연결을 무한 반복시켰다. **모킹만으로는 못 잡는 결함이다** —
실제 공급자가 어떤 상태 코드와 코드명을 주는지는 쳐 봐야 알 수 있었다.
→ RFC 6749 §5.2 오류 코드로 `needs_reauth`(재동의로 나음)와 `misconfigured`(.env 수정으로
나음)를 가른다. 상세: `e2e.md`.

## 결정

### D1 — 기존 `google-readonly-*`를 고치지 않고 옆에 짓는다

그쪽은 "프로젝트 폴더로의 되돌릴 수 있는 메타데이터 ingest"라는 다른 목적이고,
계약 테스트 4종(`npm run test:google-readonly-connection`)이 그 모양을 고정하고 있다.
단일 프로젝트·단일 provider·ingest 전용이라 도구 표면과 요구가 어긋난다.
→ `src/server/connectors/`에 provider 다중 지원 토큰 계층을 새로 만든다.
암호화는 같은 AES-256-GCM 패턴을 쓰되 스키마가 달라(`ConnectionSecretSchema`는
`{refreshToken}` strict) 별도 vault를 둔다.

### D2 — provider(인증 단위) ≠ service(정책 단위)

구글은 OAuth grant 하나로 Drive·Gmail·Calendar를 함께 받는다. 정책은 서비스별로
따로 걸어야 한다. 그래서 `provider: google | notion`(토큰 보관 단위)과
`service: google-drive | gmail | google-calendar | notion`(정책 단위)을 분리한다.

### D3 — `connectors`는 레지스트리 항목이 아니라 시스템 서버

`history/mcp-registry.json`은 이미 배포된 설치본마다 디스크에 굳어 있어, 항목을
추가해도 기존 사용자에게 닿지 않는다(레지스트리는 최초 1회만 시드된다).
`safefs`·`appdata`처럼 spawn 코드가 항상 직접 포함하고, 노출 여부는 **연결 상태와
서비스 정책**으로 가른다.

### D4 — 환경변수 토큰을 1급 소스로 인정한다

`.env.example`은 이미 `GOOGLE_OAUTH_REFRESH_TOKEN`을 "Gmail/Calendar/Drive MCP 연동 시
필수"라고 약속해 놓고 아무 데서도 읽지 않는다. 노션도 내부 통합 토큰이면 OAuth가
불필요하다. 두 경로를 모두 지원한다 — env가 있으면 OAuth 없이 바로 연결된 것으로 본다.

### D5 — 만료의 3분류

| 원인 | 상태 | 사용자에게 보이는 것 |
|---|---|---|
| 액세스 토큰 만료 | (전이 없음) | 없음 — 조용히 갱신 |
| 일시적 5xx/네트워크 | (전이 없음) | 1회 재시도 후 실패 메시지 |
| `invalid_grant` / 401 | `needs_reauth` | "재연결이 필요합니다" + `/api/connectors/<id>/oauth/start` |

## 필요한 외부 API (요구 목록)

### Google Cloud Console에서 활성화할 API

| API | 용도 | 스코프 |
|---|---|---|
| Google Drive API v3 | 검색·메타데이터·본문 읽기·파일 생성 | `drive.readonly`, `drive.file` |
| Gmail API v1 | 스레드 검색·읽기·라벨·초안 | `gmail.readonly`, `gmail.compose`, `gmail.labels` |
| Google Calendar API v3 | 일정 조회·생성 | `calendar.readonly`, `calendar.events` |
| — (OAuth 기본) | 계정 식별 | `openid`, `email` |

- 토큰 엔드포인트: `https://oauth2.googleapis.com/token`
- 동의 화면: 위 스코프는 전부 민감/제한 스코프이므로 테스트 사용자 등록 또는 앱 검증 필요
- `access_type=offline` + `prompt=consent`가 없으면 refresh token이 오지 않는다

### Notion

| API | 용도 |
|---|---|
| `POST /v1/search` | 페이지·데이터베이스 검색 |
| `GET /v1/pages/{id}` · `GET /v1/blocks/{id}/children` | 페이지 조회 |
| `POST /v1/pages` · `PATCH /v1/pages/{id}` | 페이지 생성·수정 |
| `POST /v1/comments` | 코멘트 |
| `GET /v1/users/me` | 연결 계정 확인 |

- 버전 헤더 `Notion-Version: 2022-06-28` 필수
- OAuth 토큰 교환은 HTTP Basic(client_id:client_secret) + JSON 본문
- 기본 토큰은 만료되지 않는다 → 만료 = 통합 폐기 = 즉시 `needs_reauth`
