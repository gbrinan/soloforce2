# Feature Specification: 툴박스 컨시어지

## Overview

PlayMCP 툴박스처럼 "필요한 MCP를 붙이고, 사용자에게 무엇이 필요한지 물어보고, 대신 실행하는" 경험을 MyCrew 안에서 재현한다. 새 시스템을 만들지 않고 **마이크루(대화·manage_mcp·승인) + 직원(반복 실행) + 루프(스케줄)** 라는 기존 3층 위에 얹는다.

핵심 판단: **"물어보는 에이전트"는 마이크루다.** 워커는 fire-and-forget이고 `ask`는 3분 뒤 마이크루가 대신 답하는 escalation 도구라서, 사용자 요구를 캐내는 인터뷰의 주체가 될 수 없다. 인터뷰는 마이크루 스킬로, 실행은 직원으로 나눈다.

## User Scenarios & Testing (mandatory)

### User Story 1: 툴박스 연결 인터뷰

- As: 사용자는
- I: "툴박스 연결해줘"라고만 말하면 무엇을 원하는지 질문받고, 필요한 MCP·도구·승인 수준이 표로 제안된다
- So: 어떤 MCP가 있는지 몰라도 목표 기준으로 연결이 끝나기 위해

#### Acceptance Scenarios

Scenario 1: **목표 → 도구 매핑**

- Given: PlayMCP 토큰이 키 볼트에 등록되어 있을 때
- When: 사용자가 "아침마다 일정이랑 뉴스 카톡으로 받고 싶어"라고 하면
- Then: 마이크루가 인터뷰 5문항(§인터뷰 설계)을 거쳐 `톡캘린더(읽기·allow) + NaverSearch 뉴스(읽기·allow) + 카카오톡 나에게 보내기(발송·approval)` 매핑표와 담당 직원·루프 초안을 제시하고 승인을 요청한다

Scenario 2: **승인 후 할당**

- Given: 사용자가 매핑표를 승인했을 때
- When: 마이크루가 `manage_mcp install → assign`을 호출하면
- Then: 승인카드 1회로 설치되고, 지정 직원이 재spawn되어 도구가 보인다 (`GET /api/mcp/assignments`에 반영)

### User Story 2: 원격 HTTP MCP 등록

- As: 마이크루는
- I: `command` 대신 `url`을 가진 MCP를 레지스트리에 등록할 수 있다
- So: PlayMCP·Notion·Supabase 같은 원격 MCP를 로컬 프록시 없이 붙이기 위해

#### Acceptance Scenarios

Scenario 1: **토큰은 파일에 남지 않는다**

- Given: 레지스트리 항목의 headers 값이 `Bearer ${PLAYMCP_TOKEN}`일 때
- When: 직원이 spawn되면
- Then: `--mcp-config` 임시 파일에만 실제 값이 치환되고 `history/mcp-registry.json`에는 플레이스홀더만 남는다

### User Story 3: 도구 단위 승인

- As: 사용자는
- I: 캘린더 조회는 승인 없이 지나가고 카톡 발송·선물 주문만 승인카드를 받는다
- So: 승인 폭탄 없이 위험한 행동만 통제하기 위해

#### Acceptance Scenarios

Scenario 1: **읽기 allow, 쓰기 approval**

- Given: PlayMCP 항목에 `toolModes.allow=["*-list*","*-get*","*-search*"]`, 기본 approval일 때
- When: 직원이 `mcp__PlayMCP__talkcalendar-list_events`와 `mcp__PlayMCP__kakaotalk-send_to_me`를 차례로 호출하면
- Then: 전자는 allowedTools로 통과, 후자는 PreToolUse 훅이 승인카드를 띄운다

### User Story 4: 데일리 컨시어지 직원

- As: 사용자는
- I: 평일 아침 일정·미확인 메일·관심 뉴스를 한 장으로 받고, 승인하면 카톡 "나와의 채팅"으로도 받는다
- So: PlayMCP 예시("오늘 일정 알려줘", "카톡으로 보내줘")가 매일 자동으로 돌기 위해

#### Acceptance Scenarios

Scenario 1: **루프 실행**

- Given: `loops/daily-concierge-brief.yaml`이 `enabled: true`일 때
- When: 08:40 KST에 루프가 돌면
- Then: daily-concierge가 브리핑을 채팅에 보고하고, 발송 도구 호출은 승인카드로 멈춘다 (`approval.mode: draft_only`면 발송 자체를 생략)

## 에이전트 후보 판정

| 후보 | 역할 | 툴박스 MCP | 형태 | 판정 |
| --- | --- | --- | --- | --- |
| A. toolbox-concierge | 요구 인터뷰 → 도구 매핑 → 설치·할당 제안 | (메타) | **마이크루 스킬** | 채택 — 대화·manage_mcp·승인이 모두 genie 전용이라 직원으로 만들 수 없음 |
| B. daily-concierge | 아침 브리핑 작성 → 카톡 나에게 발송 | 톡캘린더·NaverSearch(뉴스)·카카오톡, mail 앱 | **신규 직원 1명 + 루프** | 채택 — PlayMCP 예시 시나리오 그대로, 기존 `morning-brief` 템플릿 재활용 |
| C. market-scout | 관심 종목·경쟁사 공시 워치 | koreaStock·opendart·NaverSearch datalab | 신규 직원 | 보류 — 수요 확인 후. 스카우트 패턴(trend/ax/repo) 복제로 비용 낮음 |
| D. 기존 직원 강화 | spf-comms에 카카오톡 발송, trend-scout·data-collector에 NaverSearch, lead-keeper에 카카오맵 | 각각 | assign만 | 채택 — 채용 없이 `manage_mcp assign` 3건 |

절제 규칙: 이번 사이클 신규 직원은 B 1명. C는 별도 사이클.

## 인터뷰 설계 (스킬 `toolbox-concierge`)

백워드 디자인: 목표(무엇을 얻고 싶나) → 지식(그러려면 어떤 정보·행동이 필요한가) → 도구(어느 MCP 도구가 그것을 주는가) → 통제(어디까지 대신해도 되나).

| # | 질문 | 답이 결정하는 것 |
| --- | --- | --- |
| 1 | 아침에 가장 먼저 알고 싶은 것은? (일정 / 메일 / 뉴스 / 시장 / 기타) | 읽기 도구 집합 |
| 2 | 어디로 받고 싶나? (대시보드 / 카톡 나에게 / 텔레그램) | 발송 도구 + 승인 수준 |
| 3 | 대신 해도 되는 행동은? (조회만 / 초안까지 / 발송·등록까지) | `toolModes` allow/approval 경계 |
| 4 | 반복 주기와 시각은? | 루프 cron, `draft_only` 여부 |
| 5 | 절대 하면 안 되는 것은? | 역할 지시서 금지 절, 승인 강제 패턴 |

출력: 매핑표(도구 → 모드 → 담당 직원) + 루프 초안(`enabled: false`) + "승인하시면 설치·할당합니다" 한 줄. 승인 전에는 아무것도 설치하지 않는다.

## Requirements (mandatory)

### Functional Requirements

- FR-1: `McpServerDef`가 `type: "http"`, `url`, `headers`를 받고, spawn 시 `{type, url, headers}` 엔트리로 `--mcp-config`에 실린다
- FR-2: `env`·`headers` 값의 `${ENV_NAME}`은 spawn 시 `process.env`로 치환된다. 미정의면 spawn을 막고 경고를 남긴다
- FR-3: `toolModes: { allow?: string[]; approval?: string[] }`로 도구 패턴별 모드를 지정할 수 있다. 미지정 시 기존 `mode` 동작 유지
- FR-4: `POST /api/mcp/install`과 `manage_mcp` 도구가 `command` 또는 `url` 중 하나를 받는다
- FR-5: 키 볼트 프리셋에 `playmcp`(envName `PLAYMCP_TOKEN`)가 있고 `.env.example`에 같은 키가 있다
- FR-6: 스킬 `config/skill-templates/toolbox-concierge.md`와 가이드 갱신(`config/guides/mcp.md`), 마이크루 라우팅 표 1줄
- FR-7: 직원 `config/agents/daily-concierge/{meta.json, role-directive.md}` + `loops/daily-concierge-brief.yaml`(`enabled: false`)

### Non-functional / 원칙 제약

- NFR-1(절제): 신규 직원 1명, 신규 UI 없음. 기존 승인카드·루프·키 볼트 재사용
- NFR-2(SSOT): 토큰 키 이름의 정본은 `.env.example`, 직원 정의는 `config/agents/<id>/`, 루프 정의는 `loops/`
- NFR-3(fail-closed): 미치환 시크릿·미정의 서버는 조용히 통과하지 않는다
- NFR-4(호환): `mode`만 있는 기존 항목(playwright·excel·lighthouse)은 동작이 바뀌지 않는다
- NFR-5(외부 입력): 원격 MCP가 돌려주는 본문(카톡·메일)은 외부 입력이다. 발송·등록 도구 호출 전 `external-injection-filter` 규칙을 지시서에 명문화

## Out of Scope

- PlayMCP OAuth/OTT 발급 UI — 토큰은 사용자가 키 볼트에 붙여넣는다
- market-scout(C) 채용, 카카오맵·선물·멜론 도구의 개별 시나리오
- L2 카톡봇 구현·L3 알림톡 — 별도 SPEC (본 문서는 계층 설계와 착수 순서만 확정)
- 친구에게 보내기(Kakao 메시지 API) — 검수·쿼터·자동 메시지 반려로 채택하지 않음
- 워커 `ask`에 인터뷰 모드 추가 (필요성 미증명 — findings 참조)
- 스토어 카탈로그에 PlayMCP 항목 노출

## Success Criteria

1. `scripts/mcp-http-registry-test.ts`가 FR-1~3을 픽스처로 통과한다
2. 마이크루가 인터뷰 5문항만으로 매핑표를 내고, 승인 후 `GET /api/mcp/assignments`에 daily-concierge 할당이 보인다
3. daily-concierge 루프 1회 실행에서 읽기 도구는 승인카드 0건, 발송 도구는 승인카드 1건이다
4. `history/mcp-registry.json`에 토큰 실값이 없다 (grep 검증)

## 카카오톡 계층 설계 (2026-09-05 추가)

PlayMCP로 되는 카카오톡은 **발신(나에게 보내기)·캘린더·맵·선물·멜론**이고, 수신과 제3자 발신은 다른 경로다 (findings §카카오톡). 그래서 카카오톡을 세 계층으로 나눈다.

| 계층 | 용도 | 경로 | 소유 |
| --- | --- | --- | --- |
| L1 발신(개인) | 브리핑·결과를 내 카톡으로 | 즉석: PlayMCP 나챗방 MCP(승인) / 정기: 서버 REST + refresh token (`KAKAO_REST_KEY` 키 볼트 재사용) | daily-concierge, 루프 delivery |
| L2 수신(봇) | 카톡에서 마이크루에게 지시 | 카카오톡 채널 + 오픈빌더 스킬 웹훅 → 채널 어댑터 → `enqueueInternal(…, "kakao:<userId>")` | 채널 어댑터(직원 아님) |
| L3 제3자 발신 | 고객·거래처 알림 | 알림톡(템플릿·유료), isenssign 구현 재사용 | 앱 전용, 이번 스코프 아님 |

### L2 카톡봇 동작 규칙

- 페어링: 텔레그램과 동일한 1회용 코드. 미페어링 사용자는 안내 문구만 받는다.
- 5초 SLA: 웹훅은 즉시 `"접수했습니다"` + `useCallback: true`. 1분 콜백 안에 답할 수 있는 건(트리아지 티어: 단순 질문·상태 조회)은 콜백으로, 위임이 필요한 건은 "위임했습니다. 결과는 나와의 채팅방으로 보냅니다"로 닫고 결과를 L1로 배달한다.
- 승인: 1차는 카톡에서 승인을 받지 않는다(대시보드·텔레그램 버튼 유지). 오픈빌더 quickReplies 승인은 2차 후보.
- 보안: 웹훅 경로는 SSO 게이트 예외 + 오픈빌더 시크릿 검증. 본문은 `[EXTERNAL_INPUT]` 스포트라이트로 마이크루에게 전달.

### 에이전트 구조 개선안 (채널 관점)

1. **채널 계약 추출**: `src/server/channels/bridge.ts`에 페어링·rate limit·인젝션 스포트라이트·source 태그·회신 마커·청킹을 두고, `telegram.ts`가 첫 구현, `kakao-chatbot.ts`가 둘째 구현이 된다. 트리아지(`telegram-triage.ts`)도 채널 무관으로 승격.
2. **알림 배달 계층**: 루프 `delivery`에 채널 선택(`chat | telegram | kakao-me`)을 추가하고, 서버가 L1 REST로 보낸다. 직원은 발송 도구를 직접 쥐지 않아도 결과가 카톡에 닿는다 → 승인 폭탄·OTT 만료 문제 회피.
3. **hermes 범위 확장**: "텔레그램 지시 수행"을 "채널 지시 수행"으로 일반화(지시서 1줄). 소스 태그만 다르고 처리는 같다.
4. **spf-comms 실시간화 조건부**: SPF 고객 대화가 카카오톡 채널로 옮겨지면 L2 웹훅이 `kakao-inbox/`를 자동으로 채운다. 개인 카톡에 남아 있는 한 내보내기 파일 방식은 유지된다(PlayMCP로는 읽을 수 없음).
5. **직원 로스터 불변**: 카톡 관련 신규 직원은 daily-concierge 1명뿐. 봇·발신은 표면과 배달 계층이다(음성·브라우저 도구층 판정과 동형).

착수 순서: L1 즉석(MCP) → L1 정기(REST) → 채널 계약 추출 → L2 봇. L2는 채널 개설·오픈빌더 승인(약 3일)·공개 HTTPS가 전제라 별도 SPEC(`docs/kakao-channel/`)으로 연다.

## 선행 조건 (blocking)

- **P0 승인 훅 복원**: `scripts/mcp-approval-hook.mjs`·`scripts/stop-response-hook.mjs`가 리포에 없어 approval 모드가 fail-open이다 (findings Issue 2). 복원·검증 전에는 PlayMCP 쓰기 도구(발송·등록·주문)를 할당하지 않는다. 읽기 도구(allow)는 이 결함과 무관하므로 먼저 진행할 수 있다.

## Open Questions

- [ ] PlayMCP 게이트웨이 URL·토큰 헤더 이름·만료 주기 — 세션에서 playmcp.kakao.com 접근이 차단되어 미확인. 사용자가 툴박스 페이지의 연결 가이드로 확인해 findings에 기록
- [ ] 카카오톡 발송을 `approval`로 둘지 `draft_only`(발송 생략)로 시작할지 — 첫 주는 draft_only 권장
- [ ] daily-concierge 소속: 운영팀(fleet-status 옆) vs 경영지원팀 — 운영팀 제안
