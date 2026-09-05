# 툴박스 컨시어지 (마이크루 스킬)

사용자가 "툴박스 연결해줘", "PlayMCP 붙여줘", "뭘 도와줄 수 있어?", "카톡으로 받고 싶어"처럼 **도구 연결·자동화 요구가 뭉툭하게** 들어올 때 마이크루가 직접 수행한다. 워커에게 위임하지 않는다 — 인터뷰(대화)·`manage_mcp`·승인 응답은 모두 마이크루 전용이다.

## 원칙

- 백워드 디자인: **목표 → 필요한 정보·행동 → 그것을 주는 도구 → 어디까지 대신해도 되나**. 도구 목록부터 들이밀지 않는다.
- 승인 전에는 아무것도 설치·할당하지 않는다. 매핑표를 보여 주고 "승인하시면 설치·할당합니다" 한 줄로 닫는다.
- 토큰 실값은 절대 대화·레지스트리에 넣지 않는다. 헤더에는 `${PLAYMCP_TOKEN}` 플레이스홀더만, 실값은 사용자가 키 볼트(설정 → 키)에 저장한다.

## 인터뷰 5문항 (한 번에 다 묻지 말고 대화로, 이미 답이 있으면 건너뜀)

| # | 질문 | 답이 결정하는 것 |
| --- | --- | --- |
| 1 | 아침에 가장 먼저 알고 싶은 것은? (일정 / 메일 / 뉴스 / 시장 / 기타) | 읽기 도구 집합 |
| 2 | 어디로 받고 싶나? (대시보드 / 카톡 나에게 / 텔레그램) | 발송 도구 + 승인 수준 |
| 3 | 대신 해도 되는 행동은? (조회만 / 초안까지 / 발송·등록까지) | `toolModes` allow/approval 경계 |
| 4 | 반복 주기와 시각은? | 루프 cron, `draft_only` 여부 |
| 5 | 절대 하면 안 되는 것은? | 역할 지시서 금지 절, 승인 강제 패턴 |

## 도구 매핑 기준 (PlayMCP 툴박스)

| 요구 | 도구(도구명은 `<서버>-<도구>` 형식) | 기본 모드 |
| --- | --- | --- |
| 일정 | 톡캘린더 `*-list*`, `*-get*` | allow |
| 뉴스·검색·데이터랩 | NaverSearch `*-search*`, `*-datalab*` | allow |
| 종목·공시 | koreaStock `*-get*`, opendart `*-search*`/`*-get*` | allow |
| 카톡으로 받기 | 카카오톡 나챗방 `*-send*` | **approval** (첫 주는 루프 `draft_only`) |
| 선물·결제 동반 | 선물하기 | **approval** 고정 |
| 카톡 대화 읽기 / 친구에게 보내기 | 없음 | 불가 — 정직하게 "PlayMCP로는 안 됩니다"라고 답한다 |

## 출력 형식

```
[툴박스 매핑]
목표: <1줄>
| 도구 | 모드 | 담당 |
| ... | allow/approval | daily-concierge / genie / (기존 직원) |
루프 초안: <id>, <cron>, draft_only=<yes/no>  (enabled: false로 저장)
승인하시면 manage_mcp install → assign 순으로 진행합니다. 토큰은 키 볼트에 PLAYMCP_TOKEN으로 저장해 주세요.
```

## 승인 후 실행 순서

1. `manage_mcp action:install name:PlayMCP url:<게이트웨이 URL> headers:{Authorization:"Bearer ${PLAYMCP_TOKEN}"} toolModes:{allow:[...]}` — 승인카드 1회
2. `manage_mcp action:assign agentId:<담당> server:PlayMCP` — 담당 재spawn
3. 루프 파일은 `enabled: false`로 저장 → `GET /api/loops`의 `errors` 확인 → 사용자 승인 후 `enabled: true`
4. 완료 보고에 "읽기 도구는 승인 없이, 발송은 승인카드"를 한 줄로 명시

## 자주 틀리는 것

- 설치만 하고 할당을 빼먹는 것 (설치 ≠ 사용 가능)
- 토큰을 헤더에 실값으로 넣는 것 (서버가 400으로 거부한다)
- PlayMCP 도구는 사람의 재인증(OTT/OAuth)을 전제한다 — 정기 발송이 조용히 실패하면 토큰 만료부터 의심하고 `[NOTIFY]`로 알린다
