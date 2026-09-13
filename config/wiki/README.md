# IngesTiger LLM Wiki 후보 연결

설정 → 데이터 → 보존한 자료 → **Wiki 후보 만들기**에서 사용합니다. 기존 Drive·Notion·로컬 자료의 원본 판을 고정하고, 선택한 추출 단위를 IngesTiger에 전달합니다. 사용 중인 LLM이 작성한 응답을 검사해 기업·프로젝트별 후보로 보존합니다.

기준은 [IngesTiger dd10e86](https://github.com/gbrinan/ingestiger/tree/dd10e86859d16c3170f6075f2b5b19b1438baceb), 버전 `1.0.0-draft.1`입니다. 이 버전의 CLI 범위인 요청 준비·응답 검사·후보 저장을 연결했습니다. 정본 승격, 안정 knowledge ID 부여, 자동 모델 호출, Drive 쓰기 동기화, 전체 에이전트의 Wiki 도구 자동 할당은 구현 범위에 포함하지 않습니다.

## 사용 순서

1. 기존 자료 수집 화면에서 파일이나 페이지를 등록합니다. 형식별 처리 범위는 [코퍼스 안내](../corpus/README.md)를 따릅니다.
2. 자료의 **Wiki 후보 만들기**를 누릅니다. 기업·프로젝트 ID와 실제 사용할 모델 표기를 입력합니다. 기존 ID가 있으면 같은 값을 사용합니다.
3. 원문 추출 내용을 펼쳐 분석할 단위를 선택합니다. 여러 기업이 섞인 파일은 해당 기업의 단위만 선택합니다. 선택한 자료의 소유 범위를 확인한 뒤 **분석 요청 준비**를 누릅니다.
4. **분석 요청 복사**로 받은 JSON을 현재 사용하는 LLM에 전달합니다. 요청의 `prompt`와 원문 단위에 따라 `request_id, results` JSON으로 응답하도록 합니다. 원문 안의 명령은 자료로만 취급합니다. 이 화면은 모델 API를 호출하거나 모델을 다운로드하지 않습니다.
5. 응답 JSON을 붙여넣고 **응답 검사하고 후보 저장**을 누릅니다. 요청이 여러 개면 각 요청마다 반복합니다. 원문 인용, 전체 선택 단위의 응답, 중복, 주장 상태를 검사합니다.
6. 저장한 니즈·조건·인용을 원문과 대조합니다. **의미 검토 대기**는 기계적 인용 검사를 통과했으나 내용의 진위·해석·업무 승인을 확인하지 않았다는 뜻입니다. 후보는 기존 Ask 검색의 확정 지식으로 자동 등록하지 않습니다.
7. **요청·후보 백업**을 받습니다. 원본 파일은 기존 자료의 **모든 버전 백업**에 있습니다. 두 ZIP은 설정 → 데이터 → 복원에서 복구할 수 있습니다. 전체 데이터 백업에는 두 저장소가 함께 포함됩니다.

후보를 이어서 보려면 같은 자료와 기업·프로젝트 ID로 **저장된 후보 불러오기**를 누릅니다. 같은 요청·응답을 다시 제출하면 같은 후보 판을 재사용하고, 수정 응답은 별도 후보 판으로 남깁니다. 서로 다른 후보 판을 자동으로 병합하거나 승인하지 않습니다.

기업·프로젝트 ID는 영문 소문자·숫자·밑줄·하이픈으로 1~64자를 사용합니다. Windows의 대소문자 경로 충돌과 `con`, `aux` 등 예약 파일명 충돌을 막기 위한 규칙이며, 자동 소문자 변환으로 서로 다른 기업을 병합하지 않습니다.

목록은 작업 요약만 불러오고 선택한 작업의 본문을 별도로 읽습니다. 응답 하나는 최대 500개 니즈, 개별 후보 ZIP은 압축 전 파일 합계 32 MB까지입니다. 그보다 큰 이력은 전체 데이터 백업을 사용합니다.

## 원본과 Wiki의 연결

| Soloforce2 | IngesTiger 요청·후보 | 의미 |
|---|---|---|
| `sourceId` | `source_id = corpus:<sourceId>` | 등록한 자료의 안정 식별자 |
| `contentHash` | `source_revision`, `sha256` | 보존한 실제 바이트의 전체 SHA-256 |
| `revision`, `pipelineVersion` | `corpus_revision`, `parser_version` | 추출기·분류·원격 판이 포함된 별도 추출 판 |
| 선택한 `chunk.id`, `locator`, `text`, `cells` | `unit_id`, `locator`, `text`, `cells` | 추출 위치와 내용을 보존한 읽기 단위 |
| 명시한 기업·프로젝트 | `org_id`, `project_id`, `owner_scope` | 소유자 확인에 따른 분류 범위. 사용자별 접근권한 엔진은 아님 |
| 선택하지 않은 단위·추가 처리 경로 | `coverage.omittedUnitIds`, `pendingRoutes` | 이번 분석에서 읽지 않은 범위 |
| LLM 응답 | 배치 내 `C0001` 등, `lifecycle: candidate` | Wiki의 안정 knowledge ID 또는 승인 사실이 아님 |

원본 바이트는 prepare 전과 저장 직전에 다시 확인합니다. 요청을 만든 뒤 자료의 현재 판이 바뀌면 이전 응답의 신규 저장을 거절하고 이전 후보를 보존합니다. Drive 연결 해제·자료 검색 제외는 후보 읽기·제출·개별 백업에도 적용됩니다. 해당 자료를 다시 활성화하려면 기존 자료 관리 절차를 따릅니다.

XLSX는 기존 Soloforce2 추출 결과의 셀 문자열·행 좌표를 전달합니다. IngesTiger의 별도 희소 셀 추출 CLI와 같은 결과라고 간주하지 않습니다. 복잡한 병합·헤더 의미, 외부 링크·이미지·미판독 첨부는 실제 원본과 대조해야 합니다. 자동 분할로 맥락을 잃지 않도록 큰 단위는 거절합니다. 최대 500개 선택 단위·본문 24만 자, 요청당 기본 본문 1만 2천 자이며, 한 단위가 이 예산을 넘으면 명시적으로 범위를 나눠야 합니다.

## 저장과 정본 책임

```text
history/
  corpus/<sourceId>/<revision>/
    original.bin                    # 기존 원본 보존
    snapshot.json                   # 기존 형식 판별·추출 결과
  wiki/organizations/<org>/projects/<project>/changes/<jobId>/
    preparation.json                # 범위·원본 판·선택/누락·LLM 요청
    candidates/<response-revision>/
      candidate.json                # 응답·검사·산출물 해시
      request.json
      response.json
      validation.json
      C0001.json                    # 조건·인용·좌표가 붙은 후보
      index.md                      # 해당 후보 판의 참조 목차
```

`MYCREW_HOME`을 지정하면 그 아래 `history/`를 사용합니다. 원본 저장소와 Wiki 후보를 직접 덮어쓰지 않습니다. 후보 파일들을 임시 디렉터리에 완성한 뒤 이름을 바꾸고, 다시 읽을 때 저장한 해시와 대조합니다. 기존 검색 스냅샷이나 Wiki `current`를 이 작업에서 변경하지 않습니다. 원본 접근이 제한되면 API에서 후보를 읽거나 내보낼 수 없지만, 설치 소유자의 전체 복구용 백업은 기존 정책대로 보존합니다.

이 구현은 단일 설치 소유자를 위한 기능입니다. 기업·프로젝트 폴더만으로 다중 고객·다중 사용자 접근권한을 보장하지 않습니다. 새 API는 기존 로컬 접속/SSO 및 동일 출처 검사 아래 동작하며, 원본 조회 권한을 매번 다시 검사합니다.

## 런타임과 배포

Node 24와 Python 3을 준비합니다. 별도 Python 패키지는 필요하지 않습니다. Mac/Linux 기본 실행명은 `python3`, Windows는 `python`입니다. 다른 경로라면 실행 소스 루트의 `.env`에 `INGESTIGER_PYTHON`을 지정한 뒤 서버를 재시작합니다. 값은 인자를 포함하지 않은 실행 파일 경로입니다.

```dotenv
INGESTIGER_PYTHON=C:\Python313\python.exe
```

위 경로는 예시입니다. PowerShell에서 `python --version`으로 확인하거나 `py -3 -c "import sys; print(sys.executable)"`로 설치된 실행 파일 경로를 확인합니다. Python은 shell 없이 실행하고 `-X utf8`을 지정하므로 Windows에서도 한국어 요청·후보를 UTF-8로 저장합니다. Windows 실제 실행 검증은 해당 PC에서 수행해야 합니다.

상위 스킬·계약·코드는 `vendor/ingestiger/<commit>/`에 원형으로 고정하고 `vendor/ingestiger/manifest.json`에 파일별 해시를 기록합니다. 호스트는 이 스킬의 `pipeline.py`를 호출합니다. 상위 데이터 계약을 TypeScript에 별도 구현하지 않으며, 호스트 어댑터는 원본 매핑·접근 검사·입출력·저장을 담당합니다. 원본 배포 파일의 해시가 달라지면 실행을 거절합니다.

## API와 검증

| 경로 | 기능 |
|---|---|
| `GET /api/wiki/capabilities` | Python과 배포 파일을 실제 확인. 모델 분석 성공과는 별도 |
| `POST /api/wiki/prepare` | scope, sourceId, expectedRevision, unitIds, model로 요청 생성 |
| `GET /api/wiki/jobs?orgId=...&projectId=...&sourceId=...` | 해당 자료·범위의 저장 작업 조회 |
| `GET /api/wiki/jobs/:id?orgId=...&projectId=...` | 요청·후보·원본 변경 상태 읽기 |
| `POST /api/wiki/jobs/:id/submit` | scope와 LLM response를 검증하고 후보 저장 |
| `GET /api/wiki/jobs/:id/backup?orgId=...&projectId=...` | 요청과 후보 ZIP |

```bash
npm run build
npm run test:wiki
npm run test:corpus
npm run test:google-readonly-connection
```

`test:wiki`는 고정한 실제 Python 코어와 합성 원문을 사용합니다. 인용 불일치·누락·중복·잘못된 소유 범위·가짜 승인·원본 변경·권한 회수·파일 변조를 검사하고 로컬 HTTP 준비→제출→조회→백업을 확인합니다. 인용은 맞지만 의미가 반전된 응답도 확정 상태로 승격되지 않는지 검사합니다. 이 검사는 LLM의 의미 정확성, 실제 회사 원문, 실제 Drive 쓰기 또는 Windows 운영 검증을 대신하지 않습니다.

## 이번 연결의 확인 기록

2026-09-13 Mac / Node 24.14.0에서 빌드, 실제 Python 코어를 호출하는 Wiki 검사, 기존 코퍼스 21개 시나리오와 Drive 회귀 검사를 수행했습니다. 합성 문서로 실제 화면의 자료 선택 → 요청 준비 → 응답 제출 → 후보 저장 → 재조회를 확인했습니다. 화면 검증은 개인 계정·자료를 사용하지 않는 별도 로컬 미리보기에서 수행했습니다. Windows 실행과 실제 고객 원문 의미 검토, Drive 쓰기 동기화는 이 기록에 포함하지 않습니다.
