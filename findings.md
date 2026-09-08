# Integration findings

기존 회의 경로는 src/server/meetings.ts와 src/server/routes.ts이며 HTML 출력 및 목록 메타데이터를 이미 관리한다. 새 서비스 호출은 이 처리 함수에서 선택하고 기존 렌더러를 재사용한다. 자료실은 corpus 모듈이 담당하므로 검수 전 초안을 자동으로 자료실 검색에 넣지 않는다.

독립 Bun 서비스는 services/meeting-memory에 포함했다. Soloforce2는 Node 및 ky 2를 사용하여 HTTP 경계로 연결한다. 별도 프로세스는 운영 설정이 늘어나는 단점이 있지만 독립 사용과 기존 Node 런타임 유지라는 요구를 충족한다. SQLite 파일을 직접 공유하는 방법은 런타임 결합과 검수 정책 우회 위험 때문에 선택하지 않았다.

추가 운영 제약은 docs/meeting-memory.md가 정본이다. 이번 통합은 기존 구현의 이동·연결이며 새로운 공급자 성능 우위를 주장하지 않는다.
