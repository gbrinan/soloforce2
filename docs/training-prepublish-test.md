# 배포 전 재시험 — 2026-09-09

수정 후 판정: **실제 어댑터의 네 단계 파일 생성·인계 확인**. 아래 최초 실패 기록은 원인 추적을 위해 유지한다. 운영 HTTP 큐 전체나 실제 수강생 환경까지 검증했다는 뜻은 아니다.

## 수정 후 결과

- Codex CLI 0.153.4에서 Astra→Terra→Astra→Terra가 각각 성공했다.
- brief.md → data.csv/session.md → review.md/review.json → handoff.md/validation.md/validation.json을 실제로 저장하고 다음 단계에서 읽었다.
- CSV 3행의 합계는 60이다. review와 validation의 합계·행수 및 검토 판정이 일치한다.
- Astra가 요청 횟수 제한과 결과 기록 절차를 REVISE로 판정했고, Terra가 두 항목을 수정하면서 ‘수정 완료·재검토 필요’를 유지했다. 이 정상 경로를 무조건 PASS로 기대하던 최초 테스트 기대값을 수정했다.
- 변경: 명시적인 Windows 샌드박스, 자동 승인 검토, 필수 SafeFS 시작, MYCREW_HOME 기준 쓰기 루트, 제공자·MCP 오류 보존. 안전장치를 해제하지 않았다.
- 실제 시험에서 앞에 슬래시를 붙인 `/history/...`와 잘못된 저장 루트를 사용한 것도 실패 원인이었다. 역할 지침과 문서는 SafeFS의 `history/...` 상대경로를 명시한다.
- 재현: `node node_modules/tsx/dist/cli.mjs scripts/codex-runtime-test.ts`, 빌드 후 `node scripts/training-pipeline-smoke.mjs --live` (현재 CLI를 CODEX_PATH로 지정).
- 로컬 실행 증거: `history/test-runs/training-smoke-1788891385213/history/outputs/training-designer/smoke/`. 고객 자료나 인증 파일은 배포하지 않는다.

## 최초 재시험 기록

| 검사 | 결과 | 증거 |
|---|---|---|
| 전체 빌드 | PASS | 서버/클라이언트 타입 검사 및 Vite 빌드 종료 코드 0. 번들 크기·플러그인 시간 경고만 남음 |
| 호출 본문 | PASS | JSON 파싱, skipOutput=false, 첫 담당자 및 4개 단계 모델 배정 확인 |
| 기존 CLI 0.144.5 + Astra | FAIL | HTTP 400: 모델이 더 최신 Codex를 요구함 |
| 기존 CLI 0.144.5 + Terra | PASS | 실제 어댑터 호출 성공 |
| 설치된 CLI 0.153.4 + Astra | 응답 PASS / 산출물 FAIL | 모델이 응답했으나 brief.md 미저장을 명시 |
| CLI 0.153.4 + Terra 파일 저장 | FAIL | 명시적인 허용 경로에 쓰기를 요청했으나 safefs 도구가 제공되지 않는다고 응답. 실제 파일 없음 |

## 관찰된 문제

1. PATH의 CLI는 0.144.5, 데스크톱 앱에 포함된 CLI는 0.153.4였다. CODEX_PATH를 테스트 프로세스에서만 후자로 지정하자 Astra 응답이 성공했다. 전역 설치나 서버 설정은 변경하지 않았다.
2. 실제 파일을 만들지 못한 응답도 어댑터는 success=true로 반환했다. 프로세스의 정상 종료가 교육 산출물 완성을 보장하지 않는다.
3. 새 CLI에서 SafeFS 가용성과 쓰기 경로가 정상 작동하는지는 미해결이다. 모델의 오류 보고와 파일 부재를 확인했으며, 특정 권한 설정을 원인으로 단정하지 않는다.

## 시험 범위와 재개 조건

- 실운영 서버의 큐를 사용하지 않고 격리된 MYCREW_HOME에서 실제 Codex 어댑터를 호출했다. 회사·개인 자료는 사용하지 않았다.
- Astra/Terra가 각각 모델 응답을 반환하는 것까지 확인했다. 4단계 HTTP 작업 전체가 통과한 것은 아니다.
- 서버가 사용할 새 CLI 경로를 정한 뒤, 같은 어댑터에서 SafeFS 읽기/쓰기 성공과 실제 MD 파일을 확인해야 한다.
- 이후 합성 데이터로 4단계를 실행하고 brief → 차시/데이터 → review → validation/handoff의 실제 파일 및 내용 연결을 검사해야 한다.
- 그 전에는 GitHub 반영을 배포 완료로 간주하지 않는다. 이번 재시험 중 커밋·푸시·배포는 하지 않았다.

로컬 상세 증거: `history/outputs/training-designer/prepublish-1788889699261/`의 adapter-smoke.json, diagnostic.json, astra-new-cli.json, terra-write-probe.json. 이 폴더는 Git 배포 대상이 아니다.
