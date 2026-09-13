# 현재 구현의 운영 명령

이 문서는 실행 환경에 종속된 명령을 관리한다. 상위 절차는 [실행 계약](execution.md)을 따른다.

## 실행 가능한 최소 경로

스킬 폴더 기준 `scripts/pipeline.py`는 Python 표준 라이브러리로 실행한다.

```sh
python3 scripts/pipeline.py extract-xlsx input.xlsx extracted.json --source-id S01 --org company-id --project project-id
python3 scripts/pipeline.py prepare scoped-units.json requests.json --model host-agent --max-chars 12000
python3 scripts/pipeline.py build request.json response.json fresh-candidate-directory
```

1. `extract-xlsx`는 원본을 수정하지 않고 희소 셀과 병합 범위, 수식/저장된 값, 숨김 상태, 미판독 media 목록을 JSON으로 만든다. XLSX 전용이다. DOCX/PDF 어댑터는 이 공용 스크립트에 아직 없다.
2. `scoped-units.json`은 추출물 중 **소유 기업/프로젝트가 확정된 구조 단위**다. 여러 기업이 한 파일에 있으면 분리한 뒤 prepare한다. LLM이 범위를 추론했으면 후보 상태를 표시하고 호스트의 허용 범위와 대조한다. 원문 전체 정산에서 제외한 단위·헤더·이미지도 별도로 남긴다.
3. 각 unit은 `unit_id, locator, text`를 가진다. 파일에는 `source_id, source_revision, org_id, project_id, units`가 필요하다. `structure`에는 단위를 이해하는 데 필요한 헤더 값·병합 anchor·부서 문맥을 명시한다. 자동 추출만으로 이 의미 문맥이 완성되지는 않는다.
4. prepare는 `requests` 배열을 만든다. 호스트 에이전트가 **각 요청을 LLM으로 읽고** `request_id, results` 응답을 작성한다. 기존 에이전트 LLM을 사용하므로 별도 API 키가 필요 없다. 이 CLI 자체에는 모델 API 호출/자동 재시도 기능이 없다. 응답 예시는 요청의 prompt가 정본이다.
5. build는 요청 ID, 전체 단위 정산, 중복, 인용문 실제 존재와 주장 상태를 검사한 뒤 후보 JSON과 참조 목차를 만든다. 실패는 현재 Wiki를 바꾸지 않는다. 후보 ID는 배치 내 ID이며 기존 Wiki의 안정 ID와 같다고 간주하지 않는다.
6. 의미 검토 후 기존 정본 ID와 대조해 승인된 변경 범위만 반영한다. 정본 승격·원자적 current 전환·전 모드 뷰 자동 생성은 아직 구현하지 않았다. 현재 build의 출력은 후보와 후보 목차까지다.

요청 해시는 원문 단위·출처 판·범위·모델 표기·프롬프트·스키마를 포함한다. 같은 요청 ID의 검증된 응답만 재사용한다. 현재는 캐시 키만 제공하며 자동 캐시 저장·조회나 모델 버전 검증을 구현하지 않았다. 모델 표기에는 호스트가 확인한 버전/설정을 기록한다. 변경 원문은 재분석하고, 영향받지 않은 정본은 유지한다.

`max-chars`는 unit 본문 문자 예산이다. 토큰 예산이나 구조 문맥 포함 총 요청 크기 보장이 아니다. 큰 단위는 자동 절단 대신 분할을 요청하며, 헤더 문맥은 호스트가 별도 예산 안에서 붙인다.

