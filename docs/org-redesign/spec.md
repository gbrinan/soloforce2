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
