# MCP 서버 설치·관리 (mcp)

**MCP 서버 설치는 마이크루 본인 작업입니다 — 워커에게 위임하지 마세요.**

## 왜 위임하면 안 되나
워커(데이브 등)는 `manage_mcp` 도구도 없고 `genie-config.json`·`mcp-registry.json` 쓰기 권한도 없어서 **MCP를 설치할 수 없습니다.** 위임하면 빈 결과 → "미완료" 오해 → 무한 재위임. (실제로 그 사고가 있었음)

## 올바른 절차 — `manage_mcp` 도구로 직접
1. {{USER}}이 "X MCP 깔아줘" → **`manage_mcp` action:install** 직접 호출 ({{USER}} 승인카드 ~60초 대기).
2. 누가 쓸지 정해지면 **action:assign** 으로 해당 직원(genie 포함)에게 켜기. **설치만으론 아무도 못 씀 — 할당 필수.** 특정 직원에게서 끄려면 **action:unassign**.
3. 현황은 **action:list**.

> `manage_mcp` 액션: **install**(설치) · **assign**(직원에게 켜기) · **unassign**(직원에게서 끄기) · **list**(현황).

## 원격(HTTP) MCP — PlayMCP·Notion 등
- `command` 대신 **`url`** 로 설치: `manage_mcp action:install name:PlayMCP url:<엔드포인트> headers:{Authorization:"Bearer ${PLAYMCP_TOKEN}"}`.
- 토큰은 **플레이스홀더만**. `${ENV_NAME}`은 spawn 시 `.env`/키 볼트 값으로 치환되고, 미정의면 그 서버만 부착에서 빠진다(fail-closed, 서버 로그에 사유). 실값을 넣으면 설치 자체가 400으로 거부된다.
- 사용자에겐 "키 볼트(설정 → 키)의 *PlayMCP 툴박스 토큰*에 붙여넣어 달라"고 안내. 정본 키 이름은 `.env.example`.

## 도구 단위 모드 (`toolModes`)
- 한 서버 안에서 읽기(조회·검색)는 승인 없이, 쓰기(발송·등록·결제)는 승인카드로 나누려면 install 시 `toolModes:{allow:["*-list*","*-get*","*-search*"]}`.
- 판정 순서: `toolModes.approval` 매칭 → 승인카드 / `toolModes.allow` 매칭 → 통과 / 둘 다 아니면 서버 `mode`(기본 approval).
- 도구명은 서버 접두(`mcp__<name>__`)를 뺀 부분 기준. PlayMCP 게이트웨이는 `<서버>-<도구>`(예: `NaverSearch-search_news`)로 온다.

## 요구 인터뷰
- 사용자가 무엇을 원하는지 뭉툭하면 `config/skill-templates/toolbox-concierge.md` 절차로 먼저 묻고 매핑표를 승인받은 뒤 설치한다.

## 저장 위치 (소스 수정·커밋 불필요)
- 설치 = `history/mcp-registry.json`(데이터)에 등록. **`src/server/mcp-registry.ts`(소스)는 안 건드림** — 거긴 기본 배포판 시드용일 뿐.
- 할당 = `history/agents.json`/`history/genie-config.json` 수정 + 해당 직원 재spawn. 모두 gitignore라 커밋 불필요.

## 런타임 주의 (설치 ≠ 동작)
- **npx 기반** (playwright 등) → 첫 사용 시 자동 다운로드 (Node 있으면 OK).
- **Python·uv 기반** (예: Office PowerPoint MCP) → 런타임이 머신에 미리 있어야 함. 없으면 설치만으론 안 도니, "이건 Python 런타임 설치가 필요합니다"라고 {{USER}}께 보고.
- **API키·OAuth 필요** (예: Google Workspace) → 키는 {{USER}}이 넣어야 함. 임의로 못 채움.
