# My Crew — Windows 설치 안내서

> **문서 역할**: Windows 기존 설치의 Git 업데이트·환경 설정 이전과 WSL2 첫 설치 안내서. 사용법은 [README-USER.md](README-USER.md), 개발·운영 정보는 [README.md](README.md).

> 작성: 2026-06-05 | Git 업데이트·자료 수집 안내 추가: 2026-09-06 | 대상: Windows 사용자

---

<a id="update-existing"></a>

## 기존 설치: Git 업데이트와 Mac의 .env 이전

이미 Soloforce2가 실행되는 Windows PC라면 이 절차를 사용합니다. 먼저 런처와 실행 프로세스에서 실제 소스 폴더와 Windows Node / WSL 여부를 확인하고 기존 방식을 유지하세요. 아래 첫 설치 스크립트를 업데이트 용도로 다시 실행할 필요는 없습니다.

`git pull`은 원격 저장소의 변경을 내려받습니다. Mac에서 수정만 하고 아직 원격에 올리지 않은 코드는 받을 수 없습니다. 업데이트할 변경이 `gbrinan/soloforce2`의 `main`에 반영되었는지 먼저 확인하세요. `.git`이 없는 배포본은 Git 체크아웃이 아니므로 이 명령을 적용할 수 없습니다.

### 1. 기존 설정과 자료 보존

- 앱에서 진행 중인 작업을 마치고 해당 앱 서버를 정상 종료합니다. 다른 Node 프로세스는 종료하지 않습니다.
- 현재 `.env`와 개인 자료를 저장소 밖 비공개 로컬 폴더에 백업합니다. 자료 위치는 기본 `history/`이며 `MYCREW_HOME`을 설정했다면 그 아래 `history/`입니다. `WORKSPACE_ROOT` 아래 업무 프로젝트도 보존합니다.
- `git status --short`에 변경이 있으면 먼저 내용을 확인하고 이번 업데이트와 병합합니다. `git reset --hard`, `git clean`으로 해결하지 않습니다.
- 자료 수집 기능은 **Node 24 사용을 권장**하며 Mac의 24.14.0에서 검증했습니다. Windows의 실제 실행은 아래 검사로 확인합니다. Mac의 `node_modules`를 복사하지 않고 실행 환경에서 설치합니다.

### 2. PowerShell에서 코드 받기

아래 경로는 예시입니다. `package.json`이 있는 실제 폴더로 바꿉니다. 이 예시는 `origin`이 `gbrinan/soloforce2`이고 현재 브랜치가 `main`인 설치를 대상으로 합니다. 다른 브랜치나 미커밋 변경이 있으면 Codex가 상태를 확인한 뒤 적용하도록 합니다.

```powershell
$Repo = 'C:\Soloforce2\repo' # 실제 실행 소스 폴더로 변경
Set-Location -LiteralPath $Repo -ErrorAction Stop

node --version
git remote -v
git status --short --branch

$Branch = git branch --show-current
if ($LASTEXITCODE -ne 0 -or $Branch -ne 'main') { throw 'Git 저장소와 현재 브랜치를 확인하세요.' }
$Changes = git status --porcelain
if ($LASTEXITCODE -ne 0 -or $Changes) { throw '기존 변경을 확인하고 보존·병합한 뒤 업데이트하세요.' }

git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw '업데이트 실패: 분기 차이나 충돌을 확인하세요.' }
git log -1 --oneline
```

`Already up to date`는 현재 브랜치에 내려받을 커밋이 없다는 뜻입니다. 원하는 기능의 배포·인증·실행 성공을 의미하지 않습니다. Git에 올리지 않은 Mac 변경은 별도로 원격 반영이 필요합니다.

### 3. Mac에서 작성한 .env 적용

`.env`는 Git으로 옮기지 않습니다. 사용자가 별도로 옮긴 파일을 실행 소스 루트의 `package.json` 옆에 둡니다. Windows에 기존 파일이 있으면 기존 경로·키를 유지하고 새 연결 설정을 병합합니다. Codex에는 파일 위치를 알려주면 되며 비밀 값을 채팅에 붙여넣지 않습니다.

| 항목 | Windows에서 확인할 내용 |
|---|---|
| `WORKSPACE_ROOT`, `MYCREW_HOME`, `CLAUDE_PATH` | Mac의 `/Users/...` 경로를 실제 Windows 실행 경로로 변경. WSL로 실행하면 Linux/WSL 경로 사용 |
| `PROJECTS_FOLDER` | 기존 폴더명 보존. `PROJECTS_DIR`은 `WORKSPACE_ROOT`와 이 폴더명을 합친 경로 |
| `GOOGLE_DRIVE_CONNECTOR_PROJECT_ID` | Google Cloud 프로젝트 ID가 아닌 `PROJECTS_DIR` 아래 실제 프로젝트의 최대 2단 상대 경로. 필요한 폴더가 존재하는지 확인 |
| Drive Client ID/secret, `SOLOFORCE_CONNECTION_ENCRYPTION_KEY` | 전달된 값을 사용. 기존 토큰이 있으면 복호화에 사용한 키를 유지 |
| `NOTION_ACCESS_TOKEN` | 읽을 페이지에 연결을 추가한 Notion 내부 연결 토큰 |
| `CORPUS_EMBED_MODEL`, `CORPUS_EMBED_URL` | 선택 항목. 실제 실행 환경에서 접근 가능한 로컬 모델·주소를 준비한 경우만 설정 |

현재 `.env` 로더는 바깥 따옴표를 제거하거나 `${다른_변수}`를 확장하지 않습니다. `KEY=value` 형식으로 실제 값을 적고, 같은 키가 프로세스 환경변수에 있으면 그 값이 우선한다는 점도 확인합니다. 경로·필수 키의 존재 여부만 점검하고 값 전체를 출력하지 않습니다.

기본 포트 3456과 Windows 브라우저 `http://localhost:3456`을 사용한다면 콜백은 다음과 같습니다. 포트가 다르면 함께 변경하고 Google OAuth 클라이언트의 승인된 리디렉션 URI에도 정확히 등록합니다.

- Drive 자료 연결: `http://localhost:3456/api/connections/google-drive/oauth/callback`
- 앱 Google 로그인 사용 시: `http://localhost:3456/auth/google/callback`

`localhost`와 `127.0.0.1`을 섞지 않습니다. [Drive·Notion 계정 설정 및 처리 범위](config/corpus/README.md)를 확인하고, 실제 로그인·권한 동의·약관 동의는 사용자가 진행합니다.

### 4. 설치·검증·실행

같은 소스 폴더의 PowerShell에서 실행합니다. `npm.cmd`를 사용하므로 `npm.ps1` 실행을 위해 시스템 실행 정책을 바꿀 필요가 없습니다. `npm ci`는 기존 `node_modules`를 재설치하므로 서버가 종료된 상태에서 진행합니다.

```powershell
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw '의존성 설치 실패' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw '빌드 실패' }
npm.cmd run test:corpus
if ($LASTEXITCODE -ne 0) { throw '자료 수집 테스트 실패' }
npm.cmd run test:google-readonly-connection
if ($LASTEXITCODE -ne 0) { throw 'Drive 회귀 테스트 실패' }
npm.cmd start
```

`better-sqlite3` 네이티브 바인딩 오류가 실제로 발생하면 같은 Node 환경에서 `npm.cmd rebuild better-sqlite3` 후 실패한 검사를 다시 실행합니다. 런처가 이미 실행 중인 서버를 재사용할 수 있으므로 `.env` 변경 후에는 실제 서버 프로세스가 재시작되었는지 확인합니다.

서버가 실행된 상태에서 별도 PowerShell 창으로 확인합니다. 포트를 변경했다면 주소도 변경합니다.

```powershell
Invoke-RestMethod 'http://localhost:3456/api/health'
Invoke-RestMethod 'http://localhost:3456/api/connections/google-drive/status'
Invoke-RestMethod 'http://localhost:3456/api/corpus/status'
Start-Process 'http://localhost:3456'
```

401/403 응답은 로그인 상태를 확인하고 인증된 브라우저에서 다시 점검합니다. 인증을 끄거나 서버를 외부에 공개할 필요는 없습니다. `configured: true`만으로 실제 클라우드 계정 연결 성공을 판단하지 않습니다. 설정 → 데이터에서 가상 문서를 등록해 분류·검색·백업을 확인한 뒤, 사용자가 선택한 Drive 파일·Notion 페이지로 실제 연결을 검증합니다. OCR·전사는 필요 상태로 분기하며 변환 엔진은 포함하지 않습니다. 벡터 검색은 별도 로컬 모델을 준비했을 때만 검증합니다.

WSL 설치는 Ubuntu 터미널의 실제 소스 폴더에서 Git 업데이트, `.env` 병합, 설치·빌드·테스트·실행 순서로 진행합니다. `npm.cmd` 대신 `npm`을 사용하고 각 명령이 성공한 뒤 다음으로 진행하세요. Windows Node의 `node_modules`와 혼용하지 않습니다.

### Windows Codex에 요청하기

아래 문구에 실제 `.env` 위치를 넣어 기존 프로젝트를 연 Codex에 전달합니다.

```text
이 Windows PC의 Soloforce2를 Git으로 업데이트하고 실행까지 확인해줘.
README-WINDOWS.md의 '기존 설치: Git 업데이트와 Mac의 .env 이전'과
config/corpus/README.md를 기준으로 진행해줘.
Mac에서 옮긴 .env 위치: [실제 Windows 파일 경로]
실제 실행 소스 폴더와 Windows Node/WSL 방식을 먼저 확인하고 유지해줘.
기존 코드 변경·.env·개인 자료를 보존하고, 원격과 브랜치를 확인한 뒤
git pull --ff-only로 업데이트해줘. 충돌이나 분기 차이는 원인을 확인해 해결해줘.
필요한 .env 항목과 경로만 병합하고 비밀 값은 출력·커밋·업로드하지 마.
Node 24 환경에서 의존성 설치, build, test:corpus,
test:google-readonly-connection을 실행하고 실제 서버를 재시작해줘.
health·설정 화면·가상 문서 등록/분류/검색/백업까지 확인해줘.
Google 로그인·권한·약관 동의는 내가 진행할 화면을 알려줘.
실행 폴더, 적용 커밋, 테스트 결과, 접속 URL, 남은 사용자 동작을 보고해줘.
```

---

## 읽기 전에

이 안내서는 **My Crew**를 Windows 환경에 처음 설치하는 분을 위한 단계별 가이드입니다.
대부분은 스크립트가 자동으로 처리합니다. 직접 하셔야 하는 작업은 딱 **세 번**입니다:

1. UAC(사용자 계정 컨트롤) "예" 클릭
2. 재부팅 후 Ubuntu 초기 아이디/비밀번호 등록
3. Claude 계정 로그인

---

## 사전 요구사항

설치를 시작하기 전에 아래 항목을 확인해 주세요.

| 항목 | 요구 사항 | 확인 방법 |
|------|---------|---------|
| **Windows 버전** | Windows 10 빌드 19041 이상, 또는 Windows 11 | `윈도우키 + R` → `winver` 입력 후 Enter |
| **BIOS 가상화** | Intel VT-x 또는 AMD-V 활성화 필요 | 아래 "BIOS 가상화 확인" 참고 |
| **관리자 계정** | PC 관리자 권한 필요 | 없으면 회사 IT 담당자에게 요청 |
| **인터넷 연결** | 설치 중 파일 다운로드 필요 | — |
| **Claude 계정** | Claude.ai 계정 (무료 가입 가능) | https://claude.ai 에서 미리 가입 권장 |
| **여유 공간** | 약 3GB 이상 | — |

### BIOS 가상화 확인 방법

`Ctrl + Shift + Esc` → 작업 관리자 → **성능** 탭 → CPU 항목에서 **"가상화: 사용"** 확인.

[캡처: 작업 관리자 성능 탭 — 가상화 사용 표시]

"사용 안 함"으로 표시되면 PC를 재부팅한 뒤 BIOS(UEFI)에 진입하여 활성화해야 합니다.
→ 자세한 방법은 아래 **트러블슈팅 FAQ #2** 참고.

---

## 설치 절차

### 1단계 — ZIP 압축 해제

받으신 `.zip` 파일을 원하는 폴더에 압축 해제하세요.

> **주의**: 바탕화면이나 다운로드 폴더처럼 경로에 **한글이나 공백이 포함된 폴더는 피해주세요**.
> 권장 경로: `C:\mycrew\` 또는 `C:\Users\(영문아이디)\mycrew\`

[캡처: 탐색기에서 ZIP 우클릭 → "모두 추출" 선택 화면]

---

### 2단계 — 설치 스크립트 실행

압축 해제된 폴더 안에서 **`setup-windows.ps1`** 파일을 찾습니다.

**`setup-windows.ps1` 파일을 우클릭** → **"PowerShell로 실행"** 클릭

[캡처: setup-windows.ps1 우클릭 컨텍스트 메뉴 → PowerShell로 실행]

> **"PowerShell로 실행"이 보이지 않으면** Windows 11에서는 먼저 "추가 옵션 표시"를 클릭하면 나타납니다.

---

### 3단계 — UAC 승인

"이 앱이 디바이스를 변경하도록 허용하시겠어요?" 라는 파란 창이 뜹니다.

**"예"를 클릭**하세요.

[캡처: UAC 프롬프트 화면 — Anthropic 게시자 표시]

---

### 4단계 — WSL2 자동 설치 및 재부팅

PowerShell 창이 열리면서 WSL2(Windows Subsystem for Linux)와 Ubuntu를 자동으로 설치합니다.

[캡처: PowerShell 창에 "[설치] WSL2 + Ubuntu를 자동으로 설치합니다" 메시지 표시]

설치가 완료되면 재부팅 여부를 묻습니다:

```
지금 재부팅하시겠습니까? [Y/n]:
```

**`Y` 입력 후 Enter**를 누르면 PC가 자동으로 재부팅됩니다.

> 지금 재부팅하기 어려운 경우 `n`을 입력해도 됩니다. 나중에 직접 재부팅하면 설치가 자동으로 이어집니다.

---

### 5단계 — 재부팅 후 자동 재개

재부팅 후 Windows에 로그인하면 잠시 뒤 PowerShell 창이 자동으로 다시 열립니다.

[캡처: 재부팅 후 "[재진입] 재부팅 후 이어가는 중..." 메시지 표시된 PowerShell 창]

> 창이 자동으로 열리지 않으면 `setup-windows.ps1`을 다시 우클릭 → "PowerShell로 실행" 하면 됩니다.

---

### 6단계 — Ubuntu 초기 계정 등록 *(최초 1회만)*

Ubuntu가 처음 실행되면 아이디와 비밀번호를 등록해야 합니다.

안내 문구가 표시되면 **Enter**를 눌러 Ubuntu 창을 엽니다.

[캡처: Ubuntu 초기 계정 등록 안내 메시지]

새로 열린 검은 Ubuntu 창에서:

1. **`New UNIX username:`** → 소문자/숫자로 이루어진 아이디 입력 후 Enter (예: `mycrew`)
2. **`New password:`** → 비밀번호 입력 (화면에 표시되지 않음) 후 Enter
3. **`Retype new password:`** → 동일한 비밀번호 다시 입력 후 Enter
4. **`$` 프롬프트**가 나오면 `exit` 입력 후 Enter

[캡처: Ubuntu 창에 "$" 프롬프트 표시된 화면]

Ubuntu 창이 닫히면 PowerShell 창으로 돌아가 **Enter**를 한 번 더 누릅니다.

> **비밀번호를 잊어버리면 복구가 번거롭습니다**. 따로 메모해 두세요.

---

### 7단계 — Node.js 및 Claude Code CLI 자동 설치

PowerShell이 Ubuntu 내부에서 필요한 프로그램들을 자동으로 설치합니다. (수 분 소요)

- Node.js 자동 설치 (없을 경우)
- 패키지 자동 설치
- Claude Code CLI 자동 설치

[캡처: "📦 패키지 설치 중..." 및 "✅ Claude Code CLI 설치 완료" 메시지 표시]

---

### 8단계 — Claude 계정 로그인

Claude Code CLI 로그인이 필요하면 아래 메시지가 표시됩니다:

```
⚠️  Claude Code CLI에 로그인되어 있지 않습니다.
   아래 명령어로 로그인하세요:
   $ claude
```

이 때 자동으로 또는 수동으로 `claude` 명령 실행 시 브라우저가 열립니다.

[캡처: 브라우저에서 Claude 로그인 화면]

**claude.ai 계정으로 로그인**한 뒤 터미널로 돌아와 **Enter**를 누릅니다.

> Claude 계정이 없으시면 https://claude.ai 에서 무료로 가입하세요.

---

### 9단계 — 환경 설정 입력

처음 설치 시 세 가지를 입력합니다. 모두 기본값이 있으니 그냥 Enter를 눌러도 됩니다.

```
작업 디렉토리 경로 [기본값 자동 설정]: ← 그냥 Enter
프로젝트 폴더명 [mycrew-works]: ← 그냥 Enter
서버 포트 [3456]: ← 그냥 Enter
```

[캡처: 환경 설정 입력 화면]

---

### 10단계 — 설치 완료 및 브라우저 자동 열기

모든 과정이 완료되면 다음 메시지가 표시되고 브라우저가 자동으로 열립니다:

```
==========================================
  [OK] 설정 완료!
==========================================
  대시보드: http://localhost:3456
  브라우저를 자동으로 엽니다...
  데스크톱 아이콘 생성: C:\Users\<사용자>\Desktop\MyCrew.lnk
```

설치가 완료되면 데스크톱에 **MyCrew** 아이콘이 생성됩니다.
다음번부터는 이 아이콘을 더블클릭하면:

1. WSL/직접 환경 가리지 않고 `mycrew-launch.cmd` 가 호출됩니다.
2. `.env` 의 `PORT` 를 읽어 헬스체크 후, 서버가 꺼져 있으면 백그라운드로 기동합니다 (필요시 빌드도 자동).
3. 기본 브라우저로 `http://localhost:PORT` 를 엽니다.

> 아이콘이 생기지 않은 경우 `setup-windows.ps1` 의 블록 10 출력에 `단축아이콘 생성 실패` 메시지가 있는지 확인하고, 직접 `mycrew-launch.cmd` 를 더블클릭해 사용해도 됩니다.

[캡처: 설치 완료 화면 및 브라우저 자동 열림]

---

### 11단계 — 온보딩 화면 초기 설정

브라우저에서 **온보딩 화면**이 열립니다.

1. **회사명** 입력
2. **사용자 이름** 입력 (나를 부르는 이름)
3. **AI 비서 이름** 입력 (기본값 사용 가능)
4. **"시작하기"** 버튼 클릭

[캡처: 온보딩 초기 설정 화면]

이제 My Crew를 사용하실 수 있습니다!

---

## 설치 완료 확인 방법

### 체크리스트

- [ ] 브라우저에서 `http://localhost:3456` 접속 시 대시보드가 정상 표시됨
- [ ] 온보딩 화면 입력 후 대화 화면으로 전환됨
- [ ] AI 비서에게 간단한 메시지를 보냈을 때 응답이 옴

### 헬스체크 URL

브라우저 주소창에 아래를 입력했을 때 `{"status":"ok"}` 와 유사한 응답이 오면 정상입니다:

```
http://localhost:3456/health
```

---

## 트러블슈팅 FAQ

### FAQ 1. "wsl.exe를 찾을 수 없습니다" 오류가 뜹니다

**원인**: Windows Update가 충분히 되어 있지 않거나, Windows 버전이 너무 낮습니다.

**해결 방법**:
1. `윈도우키` → "Windows Update" 검색 → 업데이트 설치
2. 재부팅 후 다시 시도
3. `winver`로 빌드 번호 확인 — 19041 미만이면 Windows 업그레이드 필요

---

### FAQ 2. "BIOS 가상화 활성화 안 됨" 오류가 뜹니다

**원인**: CPU 가상화 기능이 BIOS에서 비활성화되어 있습니다.

**해결 방법**:
1. PC를 재부팅하고 부팅 직후 `F2`, `Del`, 또는 `F10` 키를 연타해 BIOS에 진입합니다
   (제조사마다 다름: 삼성/LG = F2, Dell = F2/F12, HP = F10/Esc)
2. BIOS에서 **Advanced** 또는 **Security** 메뉴를 찾아 **Intel Virtualization Technology** (또는 **AMD SVM Mode**)를 **Enabled**로 변경
3. 저장(F10) 후 재부팅
4. 다시 `setup-windows.ps1` 실행

---

### FAQ 3. 헬스체크 타임아웃 — 브라우저가 열렸는데 페이지가 없습니다

**원인**: 서버가 아직 시작 중이거나 오류로 인해 시작에 실패했습니다.

**해결 방법 (1)**: 1~2분 기다린 후 브라우저에서 `http://localhost:3456` 새로고침

**해결 방법 (2)**: 로그 확인
1. `윈도우키 + R` → `wsl` 입력 → Enter (Ubuntu 창 열기)
2. 다음 명령 입력:
   ```bash
   cat /tmp/teamLGS.log
   ```
3. 오류 메시지를 캡처해서 담당자에게 전달

[캡처: wsl 터미널에서 로그 확인 화면]

---

### FAQ 4. 화면에 한글이 깨져서 보입니다

**원인**: PowerShell의 문자 인코딩 설정 문제

**해결 방법**:
1. PowerShell 창 제목 표시줄을 우클릭 → **속성**
2. **글꼴** 탭에서 "맑은 고딕" 또는 "NSimSun" 선택
3. 또는 PowerShell 창에서 다음 명령 실행:
   ```powershell
   chcp 65001
   ```
4. 그래도 깨지면 설치 완료 후에는 브라우저 대시보드에서 정상 표시되니 진행해주세요.

---

### FAQ 5. "포트 3456에 연결할 수 없습니다" / 방화벽 차단

**원인**: Windows Defender 방화벽 또는 회사 보안 소프트웨어가 3456 포트를 차단했을 수 있습니다.

**해결 방법**:
1. `윈도우키` → "Windows Defender 방화벽" 검색
2. **고급 설정** → **인바운드 규칙** → **새 규칙**
3. **포트** → TCP → **3456** → 연결 허용 → 적용
4. 회사 PC라면 IT 보안팀에 "localhost:3456 포트 허용" 요청

---

### FAQ 6. 재부팅 후 PowerShell이 자동으로 열리지 않습니다

**원인**: RunOnce 레지스트리 등록이 사용자 계정 권한으로 되어 있어, 다른 계정으로 로그인하면 자동 재개가 안 됩니다.

**해결 방법**: `setup-windows.ps1`을 다시 우클릭 → "PowerShell로 실행"하면 이어서 진행됩니다.

---

### FAQ 7. "setup-linux.sh 실패" 오류

**원인**: Ubuntu 내부에서 Node.js 설치 또는 빌드 중 문제가 발생했습니다.

**해결 방법**:
1. `윈도우키 + R` → `wsl` → Enter
2. 다음 명령으로 로그 확인:
   ```bash
   cat /tmp/teamLGS.log
   ```
3. 인터넷 연결 상태 확인 후 다시 시도
4. 해결이 안 되면 로그와 함께 담당자에게 문의

---

## 두 번째 이후 실행 방법

My Crew를 설치 후 PC를 재부팅하거나 서버를 다시 시작해야 할 때:

### 방법 1 (권장 — 데스크톱 아이콘)
설치 마지막 단계에서 생성된 데스크톱 **MyCrew** 아이콘을 더블클릭합니다.
서버가 꺼져 있으면 자동 기동 후 브라우저가 열립니다.

### 방법 2 (배치 파일)
프로젝트 폴더의 `mycrew-launch.cmd` 를 직접 더블클릭해도 동일하게 동작합니다.

### 방법 3 (setup 재실행)
`setup-windows.ps1`을 다시 실행하면 이미 설치된 환경을 감지하고 서버만 재시작합니다.

### 방법 4 (WSL 직접)
1. `윈도우키 + R` → `wsl` → Enter
2. My Crew 폴더로 이동: `cd /mnt/c/mycrew/` (본인 경로에 맞게)
3. `npm run start`

---

## 알려진 한계 및 베타 고지

> **중요: 솔직하게 알려드립니다.**

이 Windows 설치 스크립트는 현재 **실제 Windows 환경에서 충분한 실측 테스트가 이루어지지 않은 상태**입니다. 설치 로직은 완성되어 있으나, 다양한 Windows 환경(버전, 보안 소프트웨어, 언어 설정 등)에서의 엣지 케이스는 아직 검증 중입니다.

처음 설치하시는 분은 사실상 **베타 테스터**이십니다. 다음 사항을 미리 양해 부탁드립니다:

- 예상치 못한 오류가 발생할 수 있습니다
- 오류 발생 시 로그(`/tmp/teamLGS.log`)를 캡처해서 담당자에게 전달해 주시면 빠른 개선에 도움이 됩니다
- Mac/Linux 버전은 안정적으로 동작합니다. Windows 지원은 순차적으로 안정화 예정입니다

피드백 전달: **ysk08900@gmail.com** 또는 슬랙 채널

---

## 문의

설치 중 막히는 부분이 있으시면 다음 정보를 함께 보내주세요:

1. 어느 단계에서 막혔는지
2. 화면 캡처 또는 오류 메시지
3. `winver` 결과 (Windows 버전)
4. (가능하면) `wsl -d Ubuntu cat /tmp/teamLGS.log` 결과

---

*My Crew 설치 안내서 v1.0 | 캡처 이미지는 추후 업데이트 예정*
