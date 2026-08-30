# Feature Specification: 직원 조직 재설계 (원칙·케이스 기반)

## Overview

C안(최소수정+체인 명문화) 위에, 운영 원칙 4개와 실사용 케이스 3개(a/b/c)를 조직 설계에 인코딩한다.

## 원칙 (mandatory)

- P1 **모델 교체 가능**: 모든 직원의 모델은 `config/agents/<id>/meta.json`의 `model` 필드가 정본이며, UI에서 직원별 변경 가능해야 한다. (현행: 필드 존재 ✅ / UI 변경 경로 검증 필요)
- P2 **에이전트·스킬 별도 형상관리**: 주요 직원과 스킬은 각자 GitHub repo로 관리하며, 표준 수립 절차를 따른다:
  1. file-based-planning-workflow 구조로 repo 세팅 (docs/<기능>/ spec→plan→tasks→findings→progress)
  2. paperthin 철학(clean v0·SSOT·절제·negatives-as-corpus) 기반으로 재작성 요청 → `/shower`(콜드리드) → `/hate`(공격) 검증
  3. Agent Skills 공식 문서 기준 검증 Hook: 스킬 저장/설치 시 "이 문서(platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) 기준으로 잠재 문제를 확인하라" 프롬프트 훅 실행 — name 64자·소문자·하이픈·예약어, description 비어있지 않음·1024자·트리거 조건 포함 여부를 기계 검증 + LLM 검증 이중으로.
- P3 **온보딩 명명·변경**: 최초 설치 시 사용자·비서·CTO·CSO·CQO 이름 입력(현행 ✅), 이후 변경 가능해야 한다.
- P4 **배포 모드 2종**: ① 로컬(mycrew 방식) ② 도메인 선택 배포(사용자 임의 입력 또는 soloforce.app) — 도메인 모드에서는 Google OAuth로 접근 통제(기반: src/server/auth-google.ts 존재, 도메인 모드 강제 게이트 필요).

## User Scenarios (mandatory)

### Case a: 이메일 → 일정 → 조건 추적 → 프로젝트 폴더

- Given: 이메일 수신 (apps/mail)
- When: Jarvis가 메일을 읽고 일정 관련이면 캘린더 빈 슬롯 확인 → 사용자에게 등록 여부 질문 → 승인 시 등록
- Then: 캘린더 항목이 anandara(확장 앱, 호스트 가산 로스터)로 연결되어 금액·조건이 추적되고, 담당 직원이 관련 프로젝트 폴더(readPaths)를 조회할 수 있다
- 호출 체인: **Jarvis(수신·판단·질문·등록) → book-keeper(금액·조건 장부 반영) → 해당 프로젝트 담당(폴더 조회)**. 신규 직원 불필요 — Jarvis에 mail·calendar 도구 권한, anandara는 확장 로스터로 연결.

### Case b: 링크 수집 지시 → 인제스트 → 로컬+노션

- Given: 사용자가 링크를 공유하며 "이 내용 기억하고 관련 수집하자"
- When: Jarvis가 지시를 저장하고 지식관리 체인에 라우팅
- Then: **ingest-crab**(인제스트·정리·로컬 코퍼스 적재, ssotize/re0 반사) → **corpus-keeper**(노션 등 공유 표면 반영) → 꺼내보기·공유 가능
- 관련 수집이 필요하면 Jarvis가 scout류(trend/repo/data-collector)를 병렬 소집하고 산출물을 같은 체인으로 흘린다. (이 체인은 C안에서 지시서에 명문화됨 ✅)

### Case c: Orchestrator + hermes 결합 모드

- Given: 반복·배치·셸 작업이 많은 세션
- When: 사용자가 결합 모드를 켜면
- Then: Jarvis가 hermes를 상주 보조(오퍼레이터 셸)로 붙여 위임하고, hermes는 2회 이상 반복된 워크플로를 스킬로 승격한다(P2 절차로 형상관리). 모드는 genie-config 플래그로 전환.

## 지휘·실행 체계 (개정)

```text
사용자(아난) ⇄ Jarvis[Opus5] ── (모드c) hermes 상주 보조
                │
    ┌───────────┼───────────────┬─────────────────┐
    ▼           ▼               ▼                 ▼
 아샬(CTO)    동국(CSO)      Mr세균(CQO)      운영팀 직속
 개발팀        기획팀          감사팀           fleet-status(관제)
 backend/     doc-writer/    ↑ 전 직원        book-keeper*(케이스a)
 frontend/    image-prompt/    검증 게이트
 tester/      deck-factory
 retrospective
    │
 리서치팀(수집·검증): ax-scout·repo-scout·trend-scout·data-collector·
                     ax-consultant·insight-researcher·gpt-runner(교차검증)
    │ 산출물 인계
    ▼
 지식관리팀(체인): Jarvis → ingest-crab(적재·paperthin반사) → corpus-keeper(반영·노션)
                  + mentor-advisor(코퍼스 소비자)
    │
 SPF팀(퍼널): spf-news-scout → spf-sales → spf-logistics (+spf-comms)
 경영지원팀: book-keeper(장부) · lead-keeper(리드보드)
```

## Out of Scope (이번 사이클)

- Google OAuth 도메인 게이트 구현(P4) — 별도 SPEC
- 스킬 검증 Hook 코드 구현 — 별도 SPEC (설계는 본 문서 P2)
- Jarvis mail·calendar 도구 권한 배선(케이스 a) — 별도 SPEC

## Success Criteria

1. 케이스 b가 지시서만으로 재현된다 (체인 명문화 확인)
2. 모든 직원 meta.json에 model 필드가 있고 팀 소속이 실제 역할과 일치한다
3. P2 절차 문서가 존재하고, 첫 적용 사례(스킬 1개) 검증을 통과한다

## Related Documents & 용어 (콜드리드 지적 반영)

선행 결정·근거: [../paperthin-redesign/findings.md](../paperthin-redesign/findings.md) — "C안"의 원문(재배열 4안 비교), 구조 리뷰, first nail 결과가 모두 여기 있다. "지시서"란 `config/agents/<id>/role-directive.md`를 말한다.

| 용어 | 뜻 |
| --- | --- |
| 직원 | AI 에이전트. 정의 = `config/agents/<id>/`의 meta.json+role-directive.md |
| Jarvis / genie | 오케스트레이터 직원(id: genie). 이름은 온보딩 입력값 — 아샬·동국·Mr세균도 마찬가지로 P3의 입력 이름이지 고정 캐릭터가 아님 |
| genie-config | 런타임 설정 파일 `history/genie-config.json` (gitignore, src/agents/genie.ts가 로드) |
| hermes | 오퍼레이터 셸 직원 — 텔레그램 지시 수행 + 반복 워크플로 스킬화 |
| ingest-crab / corpus-keeper | 지식관리팀 체인의 적재/반영 담당 (인계 규칙은 각 role-directive.md 말미) |
| anandara | 리포 밖 확장 앱(`../mycrew-works/anandara`) — app-registry가 호스트에 존재할 때만 로스터에 가산 |
| SPF | 고객사 계란(egg) 사업 도메인명 (팀 이름의 유래) |
| paperthin / ssotize / re0 / shower / hate | 아티팩트 위생 스킬 스위트(LilMGenius/paperthin v0.9.4)와 그 개별 스킬 — "반사"란 해당 스킬의 규칙을 지시서에 상시 습관으로 내장했다는 뜻 |
| mycrew | 이 시스템의 제품명(MyCrew). 리포=soloforce2, 패키지=my-crew |
| UI (P1) | 웹 대시보드(포트 3456)의 직원 설정 화면 |

Out of Scope 3건의 착수 포인터:
- OAuth 게이트: `src/server/auth-google.ts`(현행 로그인) + `src/server/index.ts`(미들웨어 장착 지점) + P4의 도메인 모드 판별은 `.env`의 도메인 설정 유무
- 스킬 검증 Hook: 실행 지점 = `src/server/routes/store-github-skills.ts`의 설치 직전(파싱 함수 `parseFrontmatter` 이후)
- mail·calendar 배선: `apps/mail`(수신함) + genie의 allowedTools(`config/agents-default.json`의 genie 항목)에 도구 추가, 폴더 조회는 meta.json `readPaths`

## 중복·이음새 점검 (콜드리드 + 내부 판단, 2026-08-31)

콜드 리뷰어가 지목한 중복 7건을 내부 맥락으로 재판정:

| 지목 | 콜드 제안 | 내부 판단 |
| --- | --- | --- |
| data-collector ↔ scout 4종 | 폐지·흡수 | **부분 수용**: 전문 스카우트가 없는 도메인의 범용 수집 전담으로 스코프 명문화. staged 리서치(insight-researcher)의 실행 손발 역할은 유지 |
| tester ↔ Mr세균(CQO) | 통합 | **기각, 경계 명문화**: tester=개발 중 테스트 작성·실행(팀 내부), Mr세균=최종 승인 게이트(팀 외부·전사). 이중 검증은 의도된 설계 |
| hermes ↔ Jarvis | 어댑터로 흡수 | **부분 수용**: 흡수 대신 운영팀 이동 + 케이스 c의 "결합 모드"로 공식화. 스킬화 임무는 hermes 고유가치라 유지 |
| ax-consultant ↔ ax-scout | 모호 | 경계 명문화: scout=수집만, consultant=수집물 통합·설계. 조사 요청 기본 라우팅=scout |
| fleet-status ↔ book-keeper "비용" | 모호 | SSOT 명문화: 장부 정본=book-keeper(쓰기), fleet-status=읽기 전용 요약 뷰 |
| spf-comms ↔ spf-sales | 뒷절반 부재 | 경계 명문화: sales=신규 퍼널(발굴~미팅), comms=기존 고객 대화(카톡), logistics=배송 |
| doc-writer ↔ 동국(CSO) | 모호 | 경계 명문화: 동국=기획 판단·우선순위(관리), doc-writer=집필 실무. "써줘"의 기본 라우팅=doc-writer |

라우팅 규칙 원칙: **모호한 요청의 기본 수신자를 직원마다 한 줄로 지정**하고(예: "조사"→도메인 스카우트, 없으면 data-collector), Jarvis 프롬프트에 이 표를 내장한다.

승인 대기 변이: ① hermes 팀 이동(리서치→운영) ② 위 경계 7줄을 각 role-directive.md에 1줄씩 추가 ③ Jarvis 라우팅 표 내장.
