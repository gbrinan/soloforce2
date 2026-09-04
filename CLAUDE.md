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

## 커넥터 규약 (Drive · Gmail · Calendar · Notion)

- 도구 이름·서비스 매핑·OAuth 스코프의 정본은 `src/server/connectors/catalog.ts`다.
  `config/service-policies.json`과 `src/mcp/connectors-server.ts`는 그 표를 따를 뿐이고,
  디스크에 굳은 정책 항목은 `loadServicePolicies()`가 로드할 때마다 카탈로그로 재동기화한다.
- `connected`는 **저장하지 않는다**. 매 조회마다 실제 토큰 상태로 덮는다 — 저장하면 다시
  "표시만 되고 실체 없는 연결"이 된다(2026-09-04에 고친 결함).
- `connectors` MCP 서버는 레지스트리(`history/mcp-registry.json`) 항목이 아니라
  `safefs`·`appdata`처럼 spawn 코드가 직접 싣는 시스템 서버다. 레지스트리는 최초 1회만
  시드되므로 항목을 추가해도 이미 배포된 설치본에는 닿지 않는다.
- 정책이 인터랙티브 세션에 닿는 유일한 경로는 `getConnectorToolGates()`다
  (`getPolicyDisallowedTools()`는 `jobs.ts`의 워커 잡 경로에만 실린다). 도구를 추가하면
  카탈로그·정책·게이트 셋이 함께 움직여야 한다.
- refresh token은 호스트 프로세스 밖으로 내보내지 않는다. MCP 자식은 브로커
  (`/api/connectors/:provider/access-token`)로 수명 짧은 액세스 토큰만 받는다.
- 토큰 실패는 **사람이 할 수 있는 일** 기준으로 가른다: `needs_reauth`(재동의로 나음)와
  `misconfigured`(.env 수정으로 나음)를 섞지 마라. 실 구글은 잘못된 client에
  `401 invalid_client`를 주는데, 이걸 재동의로 안내하면 사용자가 무한 재연결에 빠진다
  (2026-09-04 라이브 E2E에서 실제로 잡은 결함). 분류표는 `docs/connector-tools/e2e.md`.
- 공급자 오류 처리를 고칠 때는 모킹만 믿지 말고 `npm run test:connectors:live`로
  실 엔드포인트에 물어봐라 — 결함 4는 모킹으로는 잡히지 않았다.

## 이력 규약

- 이 리포(soloforce2)는 soloforce의 clean v0 재시작이다. 이전 이력·negative corpus는 gbrinan/soloforce에 보존되어 있으며, 과거 결정의 출처가 필요하면 그쪽을 참조한다.
