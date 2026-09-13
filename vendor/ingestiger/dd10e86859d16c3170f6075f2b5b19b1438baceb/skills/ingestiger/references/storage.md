# 로컬 + Google Drive 저장 계약

이 문서는 두 저장소의 정본·판·동기화 규칙을 관리한다. 설계이며 저장 어댑터/동기화 엔진은 아직 구현하지 않았다.

## 하나의 지식, 두 저장 위치

정본의 정체성은 `(workspace_id, knowledge_id, revision)`이다. 로컬 파일명이나 Drive 제목은 식별자가 아니다. 기본 방식은 **지정된 로컬 작업공간에서 변경을 확정하고 같은 판을 Drive에 복제**하는 것이다. 양쪽에서 독립적인 정본을 만들지 않는다. 기본 실행과 Soloforce2 모두 같은 방식이다.

로컬은 작업·오프라인 읽기·검증 위치다. Drive는 공유·보관·복구 위치다. Drive에서 받은 원본도 원격 파일 ID·판과 읽기용 로컬 사본을 연결한다. 원본이 Google 문서이면 export는 원본 자체가 아닌 변환 사본이다. 기본 원격 표현은 MD/JSON/원본 바이너리이며 Google Docs 자동 변환은 하지 않는다. 사람용 문서 변환은 별도 파생 뷰다.

## 저장 대상과 배치

```text
local workspace                         approved Drive folder (folderId)
  sources/originals/<source>/<revision>  sources/ 같은 source/revision
  sources/extracted/...                 extracted/ 같은 판
  candidates/<batch>/...                candidates/ (승인된 대상 범위만)
  snapshots/<revision>/                 snapshots/<revision>/
    knowledge/ + views/ + STRUCTURE.md + WORKFLOW.md     같은 내용과 manifest
  current.json                          current.json (완성된 snapshot 참조)
  sync/outbox + receipts                전달 영수증은 로컬, 비밀은 호스트 보관
```

이는 물리 저장 추가 규칙이며 기업·프로젝트 논리 배치는 contracts.md를 따른다. 같은 파일을 부서별로 복제하지 않는다. 이미지 golden sample은 원본과 최소 메타만 저장하고 자동 분석하지 않는다. 원본과 후보는 민감 자료를 포함할 수 있으므로 선택된 목적 폴더와 소유 범위 안에서만 복제한다. 공개 권한 생성이나 링크 공개는 기본 동작이 아니다.

## 저장 절차

1. 서버/호스트가 principal·기업·프로젝트·로컬 root·Drive connection/folderId의 연결을 확인한다. 요청자가 보낸 경로·폴더명만으로 접근을 허용하지 않는다.
2. 구조 검증과 의미 검토를 별도 수행한다. 원문 인용이 있는 잘못된 해석은 구조 검사만 통과할 수 있으므로 의미 검토가 pending이면 후보로만 저장한다.
3. expected base revision을 확인하고 프로젝트 단위 writer lock을 잡는다. 임시 로컬 snapshot을 만들고 해시·참조를 검증한 뒤 같은 파일시스템에서 current 포인터를 전환한다. 확정된 판의 업로드 작업을 durable outbox에 남긴다. 포인터/장부 간 크래시를 복구할 journal이 필요하다.
4. Drive에 immutable revision 폴더와 파일을 업로드한다. 매핑 키는 `(workspace, source-or-knowledge-id, revision, artifact-kind)`이며 Drive fileId를 기록한다. 제목 검색으로 기존 파일을 덮어쓰지 않는다.
5. 파일별 크기·다운로드 바이트 해시를 확인하고 manifest 완성을 확인한다. 큰 파일은 재개 가능한 업로드와 영수증을 사용한다. 업로드 성공 응답만으로 원격 전체판 완료를 선언하지 않는다.
6. 완성된 manifest가 있는 판만 Drive current에서 가리킨다. Drive 여러 파일의 갱신은 트랜잭션이 아니므로 두 저장소를 원자적 동시 저장이라고 부르지 않는다. 초기 버전은 작업공간당 단일 쓰기 호스트만 허용한다. 다중 호스트 전환은 writer 인계/중앙 lock 검증 후 확장한다.
7. `local_saved`, `drive_pending`, `drive_syncing`, `synced`, `conflict`, `failed`를 별도 보고한다. 두 저장소 요청의 완료는 같은 판이 `synced`인 경우다. Drive 실패 시 로컬 결과를 잃지 않으며 완료 보고 대신 부분완료를 반환한다.

## 재시도·외부 변경·복구

업로드 키·fileId·관측 판·content hash·시도 수·사유를 저장한다. 응답 유실 시 이미 생성된 파일을 조정해 확인한 뒤 재시도하고 중복 파일을 새 정본으로 노출하지 않는다. 429/5xx는 백오프, 인증/권한 해제는 access_pending, 예상하지 않은 원격 변경은 conflict다. 더 최신 modifiedTime을 무조건 승자로 고르지 않는다.

Drive 직접 편집은 다음 수집에서 변경 후보로 등록한다. 로컬 정본을 자동 덮어쓰지 않는다. 원격 삭제도 삭제 전파가 아니라 변경/접근 보류 사건이다. 로컬 복구는 지정한 완성 snapshot의 manifest·모든 파일 해시·권한을 검증한 뒤 수행한다. 옛 접근권한 캐시로 다른 기업 자료를 복구하지 않는다.

Drive 단절 시 일반 에이전트는 로컬 유효판을 읽을 수 있고 로컬 판과 원격 마지막 동기화 판을 보고한다. 다른 컴퓨터에서 Drive를 읽는 경우 그 컴퓨터는 완성된 원격 snapshot만 사용한다.

## 권한과 현재 연결

Google Drive 쓰기는 기존 읽기 전용 연결만으로 가능하지 않다. 파일별 권한인 `drive.file`을 우선 검토하되 앱이 생성/사용자 선택으로 허용받은 파일 범위에 한정되므로 임의 기존 폴더 전체에 쓰기 가능하다고 가정하지 않는다. 연결된 목적 폴더의 실제 생성·읽기·갱신 시험을 해야 한다. 추가 OAuth 동의는 구현 후 호스트 연결 흐름에서 처리한다. [공식 scope 설명](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

대용량 원본은 resumable upload를 사용한다. [공식 업로드 방식](https://developers.google.com/workspace/drive/api/guides/manage-uploads). 인증 토큰·재개 세션 비밀은 LLM 문맥이나 Wiki에 저장하지 않는다.
