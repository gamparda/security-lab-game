# Security Lab · 보안 체험 게임

고등학생을 위한 브라우저 보안 체험 게임의 첫 프로토타입입니다. 가상의 학교 동아리 자료 서버에서 단서를 조사하고, 원인을 설명하고, 방어를 적용한 뒤 정상 동작을 재검증합니다.

## 실행

### 패키징된 실행 파일

검증된 Windows 포터블과 웹 ZIP은 [최신 릴리즈](https://github.com/nu4ddi4/security-lab-game/releases/latest)에서 다운로드합니다.

운영체제별 실행 파일은 GitHub Actions의 **Package executable** 워크플로에서 생성합니다. 성공한 빌드의 **Artifacts → SecurityLab-운영체제-아키텍처**를 다운로드하고 압축을 풉니다. Windows에서는 `SecurityLab.exe`를 더블클릭하면 게임이 브라우저에서 자동으로 열립니다. Python·Node.js·npm을 설치할 필요가 없습니다.

첫 배포 대상은 **Windows 10/11 64비트 포터블**입니다. 실행 창의 **게임 다시 열기**로 브라우저를 다시 열 수 있고, **종료** 또는 실행 창 닫기로 게임 서버를 종료합니다. 파일 하나에 Python 런타임과 게임 파일이 포함되어 있어 첫 실행 시 압축 해제 시간이 필요할 수 있습니다. 진행은 기존처럼 브라우저에 저장됩니다.

실행기는 내장 서버가 모든 게임 파일을 정상 제공하는지 확인한 뒤 브라우저를 엽니다. 브라우저에서는 CSS가 실제로 적용되고 게임 모듈과 저장된 진행의 초기화가 끝날 때까지 로딩 안내를 표시합니다. CSS 요청은 실패 시 한 번 자동 재시도하며, 각 로딩 단계는 8초 이내에 끝나지 않으면 실패로 안내합니다. 다시 불러오기는 페이지를 새로 열며 정상 저장을 삭제하지 않습니다.

홈서버용 웹 파일은 같은 빌드의 **security-lab-web** 아티팩트에 별도 ZIP으로 제공합니다. 정적 파일을 그대로 호스팅할 수 있으며 홈서버에서는 HTTPS를 설정해야 합니다. 배포 방법은 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)를 참고하세요.

### 원본 코드로 실행

**Python 3.9 이상과 브라우저만 있으면 실행할 수 있습니다.** Node.js·npm·pip 또는 별도 패키지 설치는 필요 없습니다.

GitHub의 **Code → Download ZIP**으로 내려받고 압축을 풉니다. Windows는 프로젝트 폴더의 `run.bat`을 더블클릭합니다. macOS·Linux는 터미널에서 프로젝트 폴더로 이동해 실행합니다.

```sh
cd security-lab-game
python3 run.py
```

브라우저에서 **http://localhost:5173**을 엽니다. `file://`로 직접 열지 마세요. 실행 중 게임 입력을 외부로 전송하지 않습니다. 개발 서버는 `127.0.0.1`에만 바인딩하며 게임 정적 파일만 제공합니다. 종료는 `Ctrl+C`입니다.

Windows 터미널에서는 `py -3 run.py` 또는 `python run.py`로 실행할 수도 있습니다. 포트가 사용 중이면 `python3 run.py --port 5174`로 실행하고 표시된 주소를 엽니다. Python이 설치되어 있어야 합니다.

Node.js를 이미 사용하는 개발자는 패키지 설치 없이 `node scripts/serve.js`로 실행할 수도 있습니다. `.nvmrc`, `.editorconfig`, VS Code 확장 추천을 포함합니다.

## 구현된 미션

| 미션 | 조사 | 방어 및 검증 | 연산 범위 |
| --- | --- | --- | --- |
| 튜토리얼 | `help`, `inspect approval` | 허용된 조사 범위 선택, `verify` | 시뮬레이션 |
| 노출된 서비스 | `scan club-server`, `inspect club-server 8080` | 443 유지·8080 차단 → 다시 scan → verify | 시뮬레이션 |
| 약한 로그인 정책 | `inspect login` | 길이·차단 목록·시도 제한 설정 → 정상 로그인·반복 실패 검증 | 더미 데이터 시뮬레이션 |
| 변조된 자료 | `inspect baseline`, `hash files` | 변경 파일 선택·원본 복구 → hash files → verify | Web Crypto SHA-256 실제 계산 |

설정은 「방어 설정」 탭에서 변경합니다. 미션은 순서대로 열리며, 원인 설명·방어 적용·정상 기능 재검증을 통과해야 다음 미션으로 이동합니다. 3단계 힌트에는 감점이 없습니다. 진행은 이 브라우저의 localStorage에 저장하며, 현재 미션 및 전체 초기화를 지원합니다. 마지막 미션 완료 후 원인·대응·검증 해설을 제공합니다.

「전후 비교」 탭은 조사 당시의 접근 상태·로그인 정책 결과·파일 해시 일치 여부를 나란히 보여줍니다. 설정이나 파일을 바꾸면 변경 후 결과는 다시 조사하거나 재검증해야 표시됩니다. 조사하지 않은 방어 전 상태는 기록 없음으로 남습니다. 설명을 선택하면 조사 근거를 먼저 확인하도록 안내하거나, 선택한 보기의 오해와 다시 확인할 대상을 알려줍니다.

## 개발과 검증

게임 실행과 별도로 자동 브라우저 테스트 도구를 설치하는 개발자용 절차입니다. Node.js 24 LTS 권장, 22.8 이상 지원.

```sh
npm ci
npm test
npx playwright install chromium
npm run test:e2e
npm run check
```

Python 서버만 검증하려면 패키지 설치 없이 `python3 -m unittest discover -s tests/server`를 실행합니다.

Linux에서 브라우저 시스템 라이브러리가 부족하면 `npx playwright install --with-deps chromium`을 사용합니다. GitHub Actions에도 같은 검증을 구성했습니다.

이미 설치된 Chromium을 테스트에 사용하려면 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`에 실행 파일 경로를 지정합니다. Linux 예: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run check`. 지정하지 않으면 Playwright 전용 브라우저를 사용합니다.

배포할 때는 `package.json`과 잠금 파일의 버전 및 `docs/RELEASE.md`를 갱신하고 PR 검사 통과 후 `main`에 병합합니다. 병합된 커밋에 버전과 같은 태그(예: `v0.2.0`)를 푸시하면 Windows 패키징·전체 테스트·실행 창 검증을 거쳐 ZIP 두 개와 `SHA256SUMS.txt`를 GitHub 릴리즈에 게시합니다. 패키징이나 검사 실패 시 릴리즈는 게시하지 않습니다. 수동 게시에서는 같은 커밋의 성공한 Windows 패키징 실행 ID와 버전 태그를 지정합니다.

- `src/missions.js`: 목표, 허용 명령, 힌트, 설명, 내장 파일
- `src/engine.js`: 허용 목록 명령 해석, 가상 정책, 상태 판정, SHA-256
- `src/storage.js`: 진행 저장, 저장 구조 검사, 완료 조건 재판정
- `src/app.js`, `src/style.css`: 한국어 UI, 탭, 키보드 조작, 반응형 화면
- `tests/`: 핵심 상태 전이 및 PC·모바일 브라우저 테스트
- `run.py`, `run.bat`, `run.sh`: 패키지 설치 없는 Python 실행과 OS별 실행 파일
- `docs/PLAN.md`: 제공받은 원본 계획서
- `docs/ROADMAP.md`, `docs/VALIDATION.md`: 후속 일정, 검증 기록 및 한계

## 안전 경계와 한계

명령어는 게임 전용 문법입니다. 실제 네트워크 스캔, 로그인 요청, 셸·임의 코드 실행을 하지 않습니다. 실제 IP·URL·개인 파일·비밀번호는 입력 대상이 아닙니다. 입력은 최대 200자이며 동적 출력에 `textContent`를 사용합니다. CSP의 `connect-src 'none'`으로 클라이언트 통신을 제한합니다.

열린 포트는 그 자체로 취약점이 아닙니다. SHA-256 불일치는 바이트 변경을 뜻하며 악성 여부를 판단하지 않습니다. 해시 일치도 비교 기준의 신뢰성을 대신하지 못합니다. 단순 SHA-256은 비밀번호 저장 방식으로 사용하지 않습니다.

정답과 상태는 클라이언트에서 확인·수정할 수 있습니다. 점수는 학습 피드백이며 시험·순위·역량 인증에 쓰지 않습니다. 실제 서버 실습과 선택 암호 퍼즐은 포함하지 않았습니다. 기획의 30–45분 플레이 시간과 교육 효과는 입문자 시연으로 별도 검증해야 합니다.
