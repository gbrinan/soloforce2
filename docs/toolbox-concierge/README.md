# 툴박스 컨시어지 (PlayMCP 툴박스 연결 + 요구 인터뷰 에이전트)

## Background

카카오 PlayMCP 툴박스는 카카오 계정 1회 인증으로 여러 MCP(카카오톡 나에게 보내기·톡캘린더·카카오맵·선물·멜론·네이버검색·국내주식·OpenDART 등)를 묶어 외부 에이전트에 연결한다. 그 위에서 "오늘 일정 알려줘", "방금 내용 카톡으로 보내줘" 같은 요청이 곧바로 실행된다.

MyCrew에는 대응물이 절반만 있다. 마이크루(genie)는 대화형 오케스트레이터이고 `manage_mcp`로 MCP를 설치·할당하며, 워커는 `ask`로 사람에게 질문할 수 있다. 그러나 MCP 레지스트리는 stdio 서버만 알고, 승인은 서버 단위이며, `ask`는 "막혔을 때" 용도라 요구 파악 인터뷰에는 맞지 않는다.

## Goal

1. PlayMCP 같은 **원격 HTTP MCP**를 레지스트리에 등록·할당할 수 있게 한다 (토큰은 키 볼트 참조).
2. 한 MCP 안의 **읽기 도구는 승인 없이, 쓰기·발송 도구는 승인 후** 쓰도록 도구 단위 모드를 둔다.
3. 사용자에게 **무엇이 필요한지 묻고 툴박스를 매핑해 할당까지 제안**하는 인터뷰 절차를 마이크루 스킬로 둔다.
4. 인터뷰 결과를 실제로 수행할 첫 직원 **데일리 컨시어지(daily-concierge)** 를 1명 채용한다.

## How it works

### 활성화

- 사용자가 "툴박스 연결해줘" / "PlayMCP 붙여줘" / "뭘 도와줄 수 있어?"라고 하면 마이크루가 `toolbox-concierge` 스킬로 인터뷰를 시작한다.
- 인터뷰 결과(목표 → 필요한 정보·행동 → 도구 매핑 → 승인 수준)를 표로 제시하고 승인받은 뒤 `manage_mcp`로 설치·할당한다.
- 반복 흐름(아침 브리핑 → 카톡 발송)은 daily-concierge 직원 + 루프 YAML로 굳힌다.

### 비활성화

- 직원은 `config/agents/daily-concierge/`를 아카이브로 이동하고 사유를 기록한다(negatives-as-corpus). 루프는 `enabled: false`.
- MCP는 `manage_mcp action:unassign`으로 직원별 해제, 레지스트리 항목은 유지.

## Related Documents

- [spec.md](spec.md): 요구사항, 에이전트 후보 판정, 인터뷰 설계
- [plan.md](plan.md): 레지스트리·승인·스킬·직원 구현 계획
- [tasks.md](tasks.md): 작업 계획 및 추적
- [findings.md](findings.md): 코드 감사 결과, PlayMCP 확인 사실, 결정
- [progress.md](progress.md): 세션별 작업 내역
