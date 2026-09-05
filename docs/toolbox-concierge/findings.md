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

## Resources

### 문서

- [PlayMCP 툴박스](https://playmcp.kakao.com/toolbox)
- [외부 에이전트 연결 가이드](https://playmcp.kakao.com/llms/mcp-connection-guide.md)
- [Kakao Adds 'Toolbox' Feature to PlayMCP](https://www.kakaocorp.com/page/detail/11865?lang=ENG)

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
