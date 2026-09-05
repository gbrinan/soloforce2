# 실계정 E2E — 절차와 결과

> 2026-09-04 실행. 자격증명이 필요한 2단계(L3·L4)는 남아 있다 — 아래 "남은 구간" 참조.

## 왜 라이브로 돌리는가

모킹은 **내가 상상한 응답**을 고정한다. 실제 공급자가 무엇을 주는지는 쳐 봐야 안다.
이 E2E에서 실제로 결함 1건이 나왔다 — 모킹만 봤으면 배포까지 갔을 것이다.

## 발견한 결함 (수정 완료)

**설정 오류를 재동의로 오진했다.**

실제 `oauth2.googleapis.com`은 잘못된 client id/secret에 이렇게 답한다:

```
HTTP 401
{"error": "invalid_client", "error_description": "The OAuth client was not found."}
```

이전 코드는 토큰 엔드포인트의 400·401을 **전부** `RefreshRejectedError` → `needs_reauth`로
처리했다. 그러면 사용자는 "재연결이 필요합니다"를 보고 재연결을 반복하는데, 원인은 `.env`의
클라이언트 자격증명이므로 **아무리 눌러도 낫지 않는다.** 무한 루프다.

수정: 토큰 엔드포인트의 4xx를 '사람이 할 수 있는 일' 기준으로 가른다 (RFC 6749 §5.2).

| 공급자 오류 코드 | 상태 | 사람이 할 일 |
|---|---|---|
| `invalid_grant`, `invalid_scope`, 분류 불가 4xx | `needs_reauth` | 설정 → 연결에서 재연결 |
| `invalid_client`, `unauthorized_client`, `unsupported_grant_type`, `invalid_request` | `misconfigured` | `.env` 수정 후 서버 재시작 |

`needs_reauth`는 다음 호출을 즉시 차단하지만(재시도해도 같으므로), `misconfigured`는
**차단하지 않는다** — `.env`를 고치고 재시작했으면 이번엔 성공해야 하기 때문이다.
설정 오류에는 재시도도 하지 않는다(같은 답이 온다).

UI도 갈랐다: `misconfigured`는 빨강 배지 + "재연결해도 고쳐지지 않습니다" + 연결 버튼 비활성.

## 실행한 것과 결과

### 1. 공급자 엔드포인트 도달성

| 대상 | 결과 |
|---|---|
| `oauth2.googleapis.com/token` | 도달 O — `401 invalid_client` |
| `www.googleapis.com/drive/v3` | 도달 O — `401 invalid authentication credentials` |
| `api.notion.com` | **프록시 차단** — `403 Host not in allowlist` (이 컨테이너 제약, 코드 문제 아님) |

### 2. 라이브 계약 테스트 (`npm run test:connectors:live`)

```
L1 실 구글 invalid_client → misconfigured ✓
L2 실 Drive API 401 형태 확인 ✓
L3 폐기 토큰 → needs_reauth       SKIP — GOOGLE_OAUTH_CLIENT_ID/SECRET 없음
L4 실계정 Drive·Gmail 왕복        SKIP — GOOGLE_OAUTH_REFRESH_TOKEN 없음
```

### 3. 앱 레벨 — 서버 실기동 (`PORT=3467`)

정적 토큰을 넣고 기동해 사슬 전체가 도는지 확인했다.

- `GET /api/connectors` → 두 provider 모두 `configured: true`, `state: "connected"`,
  구글은 9개 스코프가 실려 나옴
- `GET /api/service-policies` → `google-drive`·`gmail`·`google-calendar`·`notion`의
  `connected`가 **실제 토큰 상태를 따라 true로 바뀜**, `mcpServerId`가 `connectors`로 정규화됨
  (결함 1·2의 반대 증명 — 하드코딩된 `true`도, 죽은 `claude.ai Google_Drive`도 사라졌다)
- `POST /api/connectors/google/access-token` (브로커, 토큰 없이) → `401 unauthorized`
- 같은 요청 (토큰 첨부) → **실제 구글까지 갔다가** `403 misconfigured` + 정확한 복구 문장

### 4. 전 구간 — 에이전트가 실제로 보는 것

MCP 서버를 기동한 호스트에 붙여 도구를 호출했다.

```
→ drive_search_files
← isError: true
   drive_search_files 실패: google OAuth 클라이언트 설정이 잘못됐습니다 —
   재연결해도 고쳐지지 않습니다. .env의 클라이언트 ID/시크릿을 확인하고 서버를
   재시작하세요. (사유: 토큰 엔드포인트 거부 (HTTP 401, invalid_client): ...)

→ notion_search
← isError: true
   notion_search 실패: notion API 오류 (HTTP 403): Host not in allowlist: api.notion.com
```

에이전트 → MCP 서버 → 브로커 → 실 공급자 → 오류가 **사람이 읽고 행동할 수 있는 문장으로**
되돌아오는 전 구간이 실제로 돈다. Notion의 프록시 차단이 그대로 드러난 것도 오류 처리가
투명하다는 증거다 — 삼키지 않는다.

## 남은 구간 (실 자격증명 필요)

L3·L4는 이 환경에 자격증명이 없어 SKIP됐다. 아래를 갖춘 곳에서 돌리면 완주한다.

### 준비

1. Google Cloud Console → **API 및 서비스 → 라이브러리**에서 3개 사용 설정:
   Google Drive API · Gmail API · Google Calendar API
2. **사용자 인증 정보 → OAuth 2.0 클라이언트 ID(웹 애플리케이션)**
   - 승인된 리디렉션 URI: `http://localhost:3456/api/connectors/google/oauth/callback`
3. **OAuth 동의 화면** → 스코프 추가 (`.env.example` 참조) → 본인 계정을 **테스트 사용자**로 등록
   (민감/제한 스코프라 검증 전에는 테스트 사용자만 허용된다)
4. `.env`에 `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` 입력

### 실행

```bash
npm start                      # 설정 → 서비스 정책 → 계정 연결 → Google "연결"
npm run test:connectors:live   # L3 실행 (L4는 refresh token까지 있어야 함)
```

동의 화면을 통과하면 `connections.json`에 refresh token이 봉인되고, 그 값을
`GOOGLE_OAUTH_REFRESH_TOKEN`으로 내보내면 L4까지 돈다.

### 확인할 것

- [ ] 동의 후 `/api/connectors`의 `accountLabel`에 **실제 이메일**이 뜬다
- [ ] `drive_search_files`가 실제 파일 목록을 돌려준다
- [ ] `gmail_search_threads`가 실제 스레드를 돌려준다
- [ ] 구글 계정 설정에서 앱 접근을 취소하면 → 다음 호출이 **`needs_reauth`** 로 간다
      (`misconfigured`가 아니라 — 이 둘이 갈리는지가 이번 수정의 핵심이다)
- [ ] `gmail_create_draft`가 승인 카드를 먼저 띄운다 (writePolicy=approval)

### Notion

`api.notion.com`이 이 컨테이너의 프록시 allowlist에 없어 직접 호출을 못 했다.
로컬이나 allowlist에 추가된 환경에서는 `NOTION_API_TOKEN`만 넣으면 바로 연결된다
(내부 통합 토큰은 만료가 없다). **쓰려는 페이지마다 통합을 "연결"로 초대해야 보인다** —
초대하지 않으면 검색 결과가 빈 배열로 나오지 정상 오류가 나지 않으므로 이 점을 먼저 의심할 것.
