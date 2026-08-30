# my-crew — 에이전트 작업 규약 (paperthin 기반)

이 문서는 이 리포에서 작업하는 에이전트·기여자의 표준 지침이다. 사용자 대면 안내는 README 4종(역할 헤더 참조)에 있으며, 메커니즘·규칙은 여기에만 둔다.

## 원칙 (paperthin 5축)

1. **아티팩트를 신뢰, 작성자를 신뢰하지 않기** — 산출물 완성 직후 자기 세션 판단 대신 콜드리드(zero-context 검토)나 현재 진실로부터의 재도출로 검증한다.
2. **SSOT** — 사실은 한 곳에만 산다. 정본: 프로젝트명·버전·Node 요구는 `package.json`(engines 포함), 환경변수는 `.env.example`, 앱 로스터는 `src/server/app-registry.ts`. 다른 표면은 참조만 한다.
3. **절제** — 개선이 증명되지 않으면 바꾸지 않는다. 적은 slop(노이즈·중복·패딩)이지 추가가 아니다.
4. **재귀 검증** — 변경 후 문서는 clean v0로 읽혀야 한다: "무엇이 바뀌었나"가 아니라 "지금 무엇이 참인가".
5. **negatives-as-corpus** — 코드·앱·문서를 지우지 말고 아카이브로 옮기고 사유(cause of death)를 기록한다.

## 사이클 규약

- 개시: `docs/<기능명>/`에 spec → plan → tasks → findings → progress 문서를 연다 (`templates/` 참조). 폴더는 생성 순간부터 비어 있지 않아야 한다.
- 변이 전: 읽기 전용 감사 → 계획 보고 → 승인 → 실행 순서를 지킨다.
- edit-safety: 타깃 존재 확인(없으면 MISS 보고), 발생 위치별 치환(일괄 스윕 금지), 대규모 구조 이동은 스크립트로.
- 마감 전: 관련 README/CLAUDE.md 반영 게이트 — 메커니즘은 CLAUDE.md, 사용자 대면은 README. 레지스터 혼입 금지.

## 앱 규약

- 앱 추가·제거는 `src/server/app-registry.ts` 등록이 정본이다. 레지스트리에 없는 apps/ 폴더는 아카이브 대상 후보다.

## 이력 규약

- 이 리포(soloforce2)는 soloforce의 clean v0 재시작이다. 이전 이력·negative corpus는 gbrinan/soloforce에 보존되어 있으며, 과거 결정의 출처가 필요하면 그쪽을 참조한다.
