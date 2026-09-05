# Findings & Decisions

> **기술적 발견, 중요한 결정이 있을 때마다 이 파일을 즉시 업데이트하세요.**

## Requirements

- 원격 HTTP MCP(PlayMCP) 등록·할당
- 도구 단위 allow/approval
- 요구 인터뷰 절차(마이크루 스킬)
- 데일리 컨시어지 직원 1명 + 루프

## Research Findings

### 코드베이스 구조 (2026-09-05 읽기 전용 감사)

- **직원 정의** = `config/agents/<id>/meta.json` + `role-directive.md`. `agent-registry.ts`가 부팅 시 스캔해 `history/agents.json`에 없는 직원을 자동 등재한다. 자동 등재 직원의 기본 권한은 `DEFAULT_AUTO_ALLOWED_TOOLS`(Read/Write/Edit/Grep/Glob/WebSearch/WebFetch/Skill/Task*)이고 Bash는 미부여. `mcpServers`는 meta.json 스캔 필드에 **없다** — 자동 등재 직원에게 MCP를 주려면 `manage_mcp assign`(→ `history/agents.json`)이 유일한 경로.
- **마이크루(genie)** = `src/agents/genie.ts` + `prompts/genie.md` + `history/genie-config.json`(mcpServers 포함). 대화형 PTY 1개. `manage_mcp`(install/assign/unassign/list)와 승인 응답은 genie PTY에만 등록.
- **MCP 레지스트리** = `src/server/mcp-registry.ts`. 런타임 정본은 `history/mcp-registry.json`(gitignore), `config/mcp-base.json`은 시드일 뿐. `McpServerDef = { command, args?, env?, mode?: "allow"|"approval" }` — **stdio 전용**. `resolveAgentMcpServers()`가 `resolveCommandPath()`로 커맨드 절대경로를 풀고, `mode`에 따라 `allowNames`/`approvalNames`로 나눈다.
- **spawn 배선** = `worker-pty.ts` 57~125행, `terminal-ws.ts` 88~150행. `--strict-mcp-config --mcp-config <tmp.json>`. approval 서버는 `PreToolUse` 훅 매처 `mcp__<name>__.*` 로 승인카드(`scripts/mcp-approval-hook.mjs`), allow 서버는 `allowedTools`에 `mcp__<name>` 통째 추가. **서버 단위**라 한 서버 안의 읽기/쓰기를 나눌 수 없다.
- **설치 라우트** = `routes.ts` 3544행 `POST /api/mcp/install` — `name, command` 필수. 승인카드(`tool: "McpInstall"`) 60초 대기 후 `addMcpServer`.
- **워커 질문** = `safefs-server.ts` 1157행 `ask` 도구 → `worker-questions.ts`. 3분 윈도우, 마이크루가 자문해 대신 답할 수 있음, 부재중이면 즉시 마이크루 의견 적용, 미영속. 설계 목적은 "막혔을 때 escalation".
- **키 볼트** = `key-vault.ts` `PRESET_KEYS`(id/label/envName/scope). server 스코프 키는 `.env`에 기록되고 `process.env`로 올라간다. 직원 spawn env는 `safeChildEnv` 화이트리스트 + `allowedEnvKeys`.
- **루프** = `loops/*.yaml`(`config/guides/loops.md`). `approval.mode: draft_only`로 외부 발신을 막는 관례. `config/loop-templates/morning-brief.yaml`이 이미 아침 브리핑 골격(enabled: false).
- **라우팅 표** = `prompts/genie.md` "라우팅 표" 절. 모호 요청의 기본 수신자를 직원마다 1줄로 지정.
- **외부 입력 방어** = `src/server/external-injection-filter.ts`, genie.md "핵심 보안 원칙". B2B 메시지용이나 원격 MCP 반환 본문에도 같은 원칙이 필요.

### 기존 패턴

- 스카우트 직원(trend-scout/ax-scout/repo-scout/spf-news-scout): meta.json + 역할 지시서 5단계 절차(과거 로그 → 플랜 → 실행 → 브리핑 → Notion 기록) + "엔진 없이 지어내기 금지" 하드 룰. 새 직원도 같은 골격.
- 팀 배치: 운영팀(fleet-status·hermes), 리서치팀(scouts), 경영지원팀(book-keeper·lead-keeper). `docs/org-redesign/spec.md` 케이스 a가 "Jarvis에 mail·calendar 도구 권한"을 Out of Scope로 남겨 둠 — 본 사이클이 그 착수점.
- 이미 존재하는 원격 MCP 의존: `package.json`의 `@notionhq/notion-mcp-server`, `korean-law-mcp`(둘 다 로컬 stdio 래퍼). Supabase는 `mcp-base.json`에 `cmd /c npx` 래퍼로 등록 — 원격을 로컬 프록시로 우회해 온 흔적.

### PlayMCP 확인 사실

- 공식: 툴박스는 PlayMCP에 등록된 MCP 도구를 골라 담고, 카카오 계정 1회 인증으로 ChatGPT·Claude 같은 외부 서비스에서 바로 쓰는 기능. 예시 요청: "방금 말한 것 내 카톡 '나와의 채팅'으로 보내줘", "오늘 일정 알려줘", "받은 선물 보여줘", "작년 오늘 멜론에서 들은 곡 틀어줘". 외부 에이전트는 One Time Token(OTT) 방식으로 연결. ([Kakao 공지](https://www.kakaocorp.com/page/detail/11865?lang=ENG), [연결 가이드](https://playmcp.kakao.com/llms/mcp-connection-guide.md), [tech.kakao](https://tech.kakao.com/posts/734))
- 이 세션에 붙어 있던 PlayMCP 커넥터에서 실측한 도구 이름: `mcp__PlayMCP__NaverSearch-search_news`, `…NaverSearch-datalab_*`, `…koreaStock-stock_get_quote`, `…opendart-search_disclosures` 등. **게이트웨이가 `<서버>-<도구>` 로 접두**하므로 도구 단위 패턴은 `*-list*`, `*-get*`, `*-search*`, `*-send*` 식으로 잡을 수 있다.
- 미확인(세션 egress 차단): 게이트웨이 URL, 인증 헤더 이름, OTT 만료 주기. 로컬에서 툴박스 연결 가이드로 확인해야 한다.
- Claude Code CLI 2.1.261은 `--transport http` + `--header` 를 지원하고 `--mcp-config` JSON에 `{ "type": "http", "url", "headers" }` 엔트리를 받는다. 로컬 프록시 없이 직접 붙일 수 있다.

### 카카오톡 — PlayMCP로 되는 것 / 안 되는 것 (2026-09-05 조사)

| 능력 | 경로 | 가능 여부 | 근거·제약 |
| --- | --- | --- | --- |
| 나와의 채팅방에 보내기 | PlayMCP "카카오톡 나챗방" MCP | **가능** | 발송 제한·검수 없음(Kakao Developers). PlayMCP 예시 "방금 내용 내 카톡으로 보내줘"가 이것 |
| 톡캘린더 조회·등록 | PlayMCP 톡캘린더 MCP | 가능 | 공식 발표 예시 "오늘 일정 알려줘" |
| 카카오맵·선물하기·멜론 | PlayMCP 각 MCP | 가능 | 선물은 결제 동반 → approval 필수 |
| 친구에게 보내기 | Kakao Developers 메시지 API (PlayMCP 도구 아님) | **사실상 불가** | 권한 신청·검수 필요, 일 30,000건·발신자당 100건·수신자 쌍당 20건, "자동 메시지는 지양, 검수 반려 가능". 비서 자동 발송 용도로 승인받기 어렵다 |
| 채팅방 메시지 읽기(수신) | 없음 | **불가** | PlayMCP 카카오톡 도구는 발신 전용. 개인 카톡 수신 API는 존재하지 않는다 |
| 채널(비즈니스) 알림톡·친구톡 | 카카오 비즈메시지 (유료·템플릿 사전 승인) | 가능(별도) | `apps/isenssign/src/lib/notifications/kakao-alimtalk.ts`가 이미 구현. PlayMCP와 무관 |
| 카톡봇(사용자가 말 걸면 답하는 봇) | 카카오톡 채널 + 카카오 i 오픈빌더 챗봇 | **가능(별도 인프라)** | 아래 §카톡봇 |

운영 주의(gpters 실전 가이드): PlayMCP의 OAuth/OTT 도구는 **"한 사람의 수동 개입"을 전제**로 설계돼 있어 봇이 100% 무인으로 진입한다고 가정하면 안 된다. 개인 OAuth로 끝나는 도구(나챗방)가 진입 장벽이 가장 낮고, 운영 봇에는 기존 채널을 대체하지 말고 얹으라는 조언.

### 카톡봇 (카카오 i 오픈빌더) 메커니즘

- 구성: 카카오톡 채널 개설 → 오픈빌더 신청(승인 약 3일) → 챗봇 생성 → 채널 연결 → 블록에 **스킬 서버**(HTTPS POST JSON 웹훅) 연결.
- 제약: 스킬 응답 **5초 SLA**. AI 챗봇용 **콜백**을 켜면 요청에 1회용 `callbackUrl`이 오고 **1분 안에 1회** 최종 응답을 보낼 수 있다(`useCallback: true`).
- 밀어내기 불가: 콜백 만료 후 봇이 먼저 말을 걸 수 없다. 뒤늦은 결과는 알림톡(유료·템플릿) 또는 **나에게 보내기**로 우회해야 한다.
- 인증: 채널 챗봇은 채널을 추가한 누구나 말을 걸 수 있다. 사장님 전용으로 쓰려면 텔레그램 브리지와 같은 **페어링 코드** 게이트가 필요하다.
- 공개 HTTPS 필요: 기존 `TUNNEL_URL`/`NGROK_URL` + P4 도메인 게이트(SSO 필수)가 이미 있다. 웹훅 경로는 SSO 예외 + 오픈빌더 서명/시크릿 검증으로 열어야 한다.

### 우리 채널 구조 (현행)

| 채널 | 방향 | 구현 | 비고 |
| --- | --- | --- | --- |
| 웹 대시보드 | 양방향 | `chat.ts` | 정본 표면 |
| 텔레그램 | 양방향 + 승인 버튼 | `telegram.ts`(1,300줄) + `telegram-triage.ts` | long polling → 페어링 → rate limit → `enqueueInternal(prompt, "telegram:<chatId>")`. 트리아지: Gemini Flash로 단순 대화 선처리, 나머지 마이크루 |
| 디스코드 | 크루 라운지 | `discord.ts` | 에이전트 간 대화 표시 |
| 음성 | 양방향 | `routes/voice.ts` | `/api/chat`과 위임 경로 공유 |
| 카카오톡 | **읽기 전용·수동** | spf-comms `kakao-inbox/` 내보내기 .txt 인제스트 | 발신 금지 하드 룰 |
| 알림톡 | 발신(앱 전용) | isenssign | 비즈메시지 키 필요 |

관찰: 양방향 채널 계약(페어링·rate limit·인젝션 스포트라이트·source 태그·회신 마커·승인 버튼)이 `telegram.ts` 한 파일 안에만 암묵적으로 존재한다. 카톡봇을 붙이려면 이 계약을 꺼내야 두 번째 구현이 복제가 아니라 재사용이 된다.

## Resources

### 문서

- [PlayMCP 툴박스](https://playmcp.kakao.com/toolbox)
- [외부 에이전트 연결 가이드](https://playmcp.kakao.com/llms/mcp-connection-guide.md)
- [Kakao Adds 'Toolbox' Feature to PlayMCP](https://www.kakaocorp.com/page/detail/11865?lang=ENG)
- [PlayMCP 오픈클로 연동 (카카오 서비스 목록·200여 MCP)](https://www.kakaocorp.com/page/detail/12012)
- [카카오톡 메시지 API 이해하기 (나에게/친구에게 보내기·쿼터)](https://developers.kakao.com/docs/latest/ko/kakaotalk-message/common)
- [친구 API·메시지 API 체크리스트 (자동 메시지 지양·검수)](https://devtalk.kakao.com/t/api-api/116052)
- [운영 봇에 PlayMCP를 얹는 1단계 (OAuth 수동 개입 전제)](https://www.gpters.org/mcp-43q62kh1/post/step-1-installing-playmcp-oA7czlywADYN6fZ)
- [오픈빌더 스킬 서버 (블록에 스킬 적용)](https://i.kakao.com/docs/skill-block)
- [AI 챗봇 콜백 개발 가이드 (5초 SLA·callbackUrl 1분)](https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/ai_chatbot_callback_guide)

### 코드 참조

- 레지스트리 타입·해석: `src/server/mcp-registry.ts:14-20`, `:235-253`
- 워커 spawn MCP 배선·훅: `src/server/worker-pty.ts:57`, `:110-125`
- 마이크루 spawn MCP 배선: `src/server/terminal-ws.ts:88`, `:145-147`
- 설치 라우트: `src/server/routes.ts:3544`
- ask 도구: `src/mcp/safefs-server.ts:1157`, `src/server/worker-questions.ts`
- 키 볼트 프리셋: `src/server/key-vault.ts:22-33`
- 자동 등재 직원 기본 권한: `src/agent-registry.ts:72-96`, meta.json 스캔 필드 `:268-276`

### API 엔드포인트

- GET `/api/mcp/registry`, GET `/api/mcp/assignments`
- POST `/api/mcp/install`, `/api/mcp/assign`, `/api/mcp/unassign`, `/api/mcp/uninstall`

## Technical Decisions

| Decision | Rationale |
| -------- | --------- |
| 인터뷰 주체는 마이크루(스킬), 직원이 아님 | 대화·manage_mcp·승인 응답이 모두 genie PTY 전용. 워커 `ask`는 3분 뒤 마이크루가 대신 답하는 구조라 "사용자의 요구"를 캐는 데 부적합 |
| 워커 `ask`에 인터뷰 모드를 추가하지 않음 | 절제. 마이크루가 이미 인터뷰를 할 수 있으므로 개선이 증명되지 않음. 워커가 실행 중 사소한 확인이 필요하면 기존 `ask`로 충분 |
| 레지스트리에 `type/url/headers` 추가, `mode`는 유지 + `toolModes` 병행 | 기존 3개 항목(playwright·excel·lighthouse)의 동작 불변. `toolModes`가 있으면 그것이 우선 |
| 시크릿은 `${ENV}` 플레이스홀더 + spawn 시 치환 | 레지스트리 파일(gitignore이지만 백업·역싱크 대상)에 토큰 실값을 남기지 않음. 치환 실패는 fail-closed |
| 첫 직원은 daily-concierge 1명 | PlayMCP 예시 시나리오와 1:1, `morning-brief` 템플릿·`draft_only` 관례 재활용. market-scout는 수요 확인 후 |
| 카톡 발송은 첫 주 `draft_only` | 원격 MCP 반환 본문의 인젝션 위험·OTT 만료 동작이 미검증. 승인카드 모드는 그 다음 |
| 카카오톡 발신은 "나에게 보내기"만 목표로 한다 | 친구에게 보내기는 검수·쿼터·자동 메시지 반려로 비서 용도에 부적합. 제3자 발신은 알림톡(템플릿·유료)이 정식 경로 |
| 정기 알림 발송은 MCP가 아니라 서버측 REST(나에게 보내기 + refresh token)로 | OTT/OAuth 도구는 사람의 재인증을 전제하므로 08:40 루프가 조용히 실패한다. 에이전트가 즉석에서 보내는 건은 MCP(승인), 루프 결과 배달은 서버 notify 경로 |
| 카톡봇은 직원이 아니라 **채널 어댑터**(텔레그램·음성과 동형) | 봇은 마이크루의 입출력 표면이다. 처리·위임·라우팅은 기존 경로 그대로 |
| 카톡봇 착수 전 `telegram.ts`에서 채널 계약을 추출한다 | 두 번째 양방향 채널을 복제로 만들면 페어링·인젝션·승인 규칙이 드리프트한다 |
| 자동 등재 meta.json에 `mcpServers` 필드를 추가하지 않음 | 할당 정본은 `history/agents.json`(manage_mcp)이라 이중 정본이 생김. 씨앗 문서에는 "권장 할당"을 주석으로만 둔다 |

## Issues Encountered

### 1. playmcp.kakao.com 접근 차단

**문제**: 세션 egress 프록시가 playmcp.kakao.com, a2a-mcp.org, gpters.org를 차단해 툴박스 페이지·연결 가이드를 직접 읽지 못함.

**원인**: 원격 환경 네트워크 정책.

**해결**: 공식 발표·기술 블로그 검색 결과와 세션에 연결된 PlayMCP 커넥터의 실측 도구 목록으로 대체. 게이트웨이 URL·헤더는 Open Question으로 남김.

**결과**: 설계에는 영향 없음(전송 계층은 표준 HTTP MCP). 구현 착수 전 사용자 확인 필요.

### 2. 승인 훅 스크립트가 리포에 없다 (선행 결함)

**문제**: `worker-pty.ts:112`·`terminal-ws.ts:160`이 `scripts/mcp-approval-hook.mjs`와 `scripts/stop-response-hook.mjs`를 PreToolUse/Stop 훅으로 지정하지만, 두 파일은 soloforce2 git 이력 어디에도 없다 (`.gitignore`는 `scripts/_*`만 제외). `mcp-registry.ts:221`이 계약 테스트로 지목한 `scripts/mcp-env-passthrough-test.ts`도 없다.

**원인**: clean v0 재시작 때 gbrinan/soloforce의 `scripts/` 일부가 이식되지 않은 것으로 보인다. 라이브 머신에는 untracked로 남아 있을 수 있다.

**해결**: 미정 — 본 사이클의 **Step 0 선행 과제**. gbrinan/soloforce에서 두 훅과 계약 테스트를 이식하거나 재작성하고, `route-golden`류 정적 검사에 "훅 파일 존재"를 추가한다.

**결과**: 미해결. 훅 파일이 없으면 approval 모드 MCP 도구가 승인 없이 실행된다(node가 모듈을 못 찾아 exit 1 → Claude Code는 exit 2만 차단하므로 **fail-open**). 카톡 발송·선물 같은 쓰기 도구를 approval에 맡기는 본 설계의 전제가 무너지므로, 이 결함을 닫기 전에는 PlayMCP 쓰기 도구를 어느 직원에게도 할당하지 않는다.

## Learnings

### "물어보는 에이전트"는 새 직원이 아니라 오케스트레이터의 절차다 (2026-09-05)

MyCrew의 직원은 위임받아 실행하고 보고하는 존재이고, 사용자와 대화하는 표면은 마이크루 하나다. PlayMCP 예시의 "에이전트"는 이 시스템에서 마이크루 + 툴박스 할당에 해당한다. 새 직원은 그 대화의 결과로 반복 실행을 맡을 때만 필요하다.
