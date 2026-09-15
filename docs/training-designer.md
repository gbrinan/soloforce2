# 교육설계 에이전트

운영 전 [실행 재시험 결과](training-prepublish-test.md)를 확인한다. CLI 0.153.4로 Astra→Terra→Astra→Terra의 실제 MD·CSV 생성과 읽기·수정을 확인했다. 0.144.5에서는 Astra 호출이 거부됐다. 운영 서버의 `CODEX_PATH`를 현재 CLI 실행 파일의 절대경로로 지정하고 그 실행 파일의 `--version`을 확인한다. Windows에서는 npm의 .cmd 래퍼 대신 네이티브 codex.exe 경로를 사용한다. CLI를 업데이트한 뒤 서버를 재시작한다.

어댑터는 Windows의 제한된 unelevated 샌드박스, 자동 승인 검토, 필수 SafeFS 시작을 설정한다. 자동 승인이 거절되면 실패로 반환하며 권한을 우회하지 않는다. `history/...` 상대경로는 MYCREW_HOME 기준이다. `/history/...`는 운영체제 루트 경로이므로 SafeFS 입력에 사용하지 않는다.

회귀 검사: `node node_modules/tsx/dist/cli.mjs scripts/codex-runtime-test.ts`. 실제 모델·파일 검사: 빌드 후 `node scripts/training-pipeline-smoke.mjs --live`. 후자는 네 번의 실제 모델 호출을 수행하므로 CLI 인증과 사용량이 필요하다. 생성 파일은 분리된 history/test-runs 아래에 저장된다.

기업과 제품에 종속되지 않는 실습 교육 설계 담당자다. 회사명, 강사명, 브랜드와 학습자 AI 환경은 작업별로 입력한다. 제작 모델은 `gpt-5.6-terra`, 어댑터는 `codex-cli`다.

## 권장 운영: Astra 설계·검토, Terra 작성·수정

처음 만드는 과정은 `training-architect`(gpt-6-astra)가 구조를 설계하고, `training-designer`(gpt-5.6-terra)가 원고를 작성한다. Astra 검토 후 Terra가 수정·인계한다. 두 에이전트의 config 폴더를 함께 배포한다. 공통 산출물은 training-designer의 프로젝트별 출력 폴더에 두며 Astra에도 이 폴더의 쓰기 권한이 있다.

실제 호출 본문은 [training-pipeline.json](../templates/training-pipeline.json)이다. 사용 전 request의 교육 조건과 출력 폴더를 프로젝트에 맞게 바꾸고, 로컬 POST /api/delegate에 JSON으로 전송한다. 반복 실행 시 별도 프로젝트 폴더 또는 기존 수정 대상을 명시한다. 다음은 Bash 예시이며 포트는 설치에 맞춘다.

```bash
curl --fail-with-body -X POST http://127.0.0.1:3456/api/delegate \
  -H 'Content-Type: application/json' \
  --data-binary @templates/training-pipeline.json
```

`stages`와 `stageAgents`가 실제 단계별 담당자를 지정한다. 제출 전에 두 ID가 직원 목록에 있고 각 모델 설정이 맞는지 확인한다. 누락된 단계 담당자는 기존 엔진에서 기본 직원으로 대체될 수 있다. 자연어로 교육설계를 호출하는 것만으로 이 네 단계가 자동 구성되는 것은 아니다. 이미 확정된 과정의 원고 수정은 아래 Terra 단독 호출을 사용한다.

검토 판정은 문서에 기록된다. 엔진이 품질 판정을 해석하여 자동 중단하는 기능은 추가하지 않았다. BLOCKED는 마지막 단계에서 재개 조건을 보고하며, 수정 후 검토가 필요하면 Astra를 명시적으로 다시 호출한다. 임의 재검토 루프로 비용을 늘리지 않는다.

## 등록

`config/agents/training-designer/meta.json`과 `role-directive.md`를 함께 배포한다. 이 저장소는 `meta.md`를 읽지 않는다. 별도의 등록 코드 수정은 필요 없다.

기존 온보딩을 완료해 `MYCREW_HOME/history/agents.json`이 존재하는 설치에서 레지스트리가 새 폴더를 자동 발견한다. 서버 재시작 후 직원 목록을 확인한다. 초기 설치는 기존 온보딩부터 진행한다. 사용자 데이터 파일을 빈 배열로 덮어쓰지 않는다.

이미 같은 ID가 `history/agents.json`에 있으면 그 설정이 우선한다. 직원 설정에서 adapter/model을 확인한다. 역할 원본은 위 파일이며 레지스트리가 `history/agents/training-designer/wiki/role-directive.md`로 동기화한다. 실행 컴퓨터에 Codex CLI 인증 및 해당 모델 사용 권한이 필요하다. 다른 모델로 자동 대체하여 성공했다고 보고하지 않는다.

## 호출

자연어 예시:

> 교육설계에게 맡겨줘. 파트너 관리 담당자 대상 3시간 실습 교안 MD를 만들어줘. 초급이며 이전에 기본 프롬프트를 배웠어. 학습자는 일반 채팅과 파일 업로드만 가능하고 외부 연동·설치는 불가해. 합성 데이터로 업무 우선순위를 판단하고 10분 재시연까지 하게 해줘. 회사명과 로고는 넣지 마.

키워드 라우팅은 가장 긴 일치어를 우선하므로 다른 업무 키워드가 섞이면 다른 담당자가 선택될 수 있다. 담당자를 확실히 지정하려면 기존 로컬 위임 API의 `agent`를 사용한다. 아래 본문을 `POST /api/delegate`로 보낸다. API 접근 설정과 포트는 설치 환경을 따른다.

```json
{
  "agent": "training-designer",
  "skipOutput": false,
  "request": "기업 정보 없이 초급 직원 대상 90분 실습 교안을 작성해줘. 학습자는 일반 AI 채팅과 파일 업로드만 가능해. 합성 CSV, 차시별 MD, 강사용 기대 결과와 디자인 인계서를 history/outputs/training-designer/demo/에 저장해줘. 가정과 미검증 항목을 표시해줘.",
  "projectName": "training-demo"
}
```

ACK의 `jobId`는 접수 증거이며 완료 증거가 아니다. 작업 결과에서 MD 파일과 검증 기록을 확인한다. 모델 호출 전에 구성만 점검하려면 `getWorkerAgent('training-designer')`와 `resolveWorkerRuntime()`을 사용한다.

`skipOutput: false`는 필수다. 생략하면 기존 API가 파일을 쓰지 말라는 지시를 추가한다.

## 입력과 인수

권장 입력: 대상 직무·업무 판단·사전 교육·교육 시간·허용 AI와 기능·데이터 제한·필요 산출물·템플릿. 모르는 항목은 미확인으로 적는다. 설치 제약이 있는 학습자에게 제작자의 CLI를 요구하지 않는다.

완성 MD는 학습자 행동, 입력 데이터, 실행 순서, 기대 판정, 복구 방법이 연결되어야 한다. 데이터는 한 행의 의미·키·단위·기준일을 포함한다. 강사 양성에는 재시연과 피드백을 포함한다. PPTX 제작은 후속 요청 또는 해당 기능을 사용할 수 있는 환경에서 수행한다.

하나의 담당자로 시작하면 요구사항부터 노트까지 맥락을 보존하기 쉽다. 다만 실제 화면 디자인과 현장 검증은 별도 전문성이 필요하므로, 이 역할의 자기 검토만으로 렌더링이나 현업 적합성이 검증됐다고 간주하지 않는다.
