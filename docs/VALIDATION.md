# 검증

## 실행

```sh
npm run check
```

시스템 Chromium: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run check`.

Linux CI는 `SECURITYLAB_HEADED=1`과 Xvfb 가상 화면에서 브라우저를 실행한다. 3D 검사는 실제 마우스 잠금을 사용하므로 창 없는 headless shell에서 잠금이 거부되는 환경을 피한다. 가상 화면의 포커스가 다른 브라우저에 넘어가지 않도록 이 모드에서는 한 번에 하나의 worker만 실행한다. 로컬 기본 검사는 기존 headless 방식이다.

```sh
SECURITYLAB_HEADED=1 SECURITYLAB_CROSS_BROWSER=1 xvfb-run --auto-servernum --server-args='-screen 0 1920x1080x24' npm run check
```

Linux 브라우저 검사 실패 시 `test-results`의 trace와 오류 내용을 GitHub Actions 아티팩트로 7일 보관한다. 테스트용 이동이나 마우스 잠금 우회는 사용하지 않는다.

## 게시 버전

| 버전 | 엔진 | 서버·배포 | 브라우저 | Windows 실행창 |
| --- | ---: | ---: | ---: | --- |
| v0.2.0 | 32 | 4 | 24 | 통과 |
| v0.2.2 | 32 | 6 | 42 | 통과 |
| v0.2.4 | 32 | 12 | 46 | 통과 |
| v0.2.5 | 32 | 14 | 46 | 통과 |
| v0.2.6 | 32 | 10 | 48 | 통과 |
| v0.2.7 | 32 | 10 | 52 | 통과 |
| v0.2.8 | 32 | 12 | 52 | 통과 |
| v0.3.0 | 42 | 17 | 148 | 통과 |
| v0.3.0 + 3D (main 통합) | 47 | 17 | 158 | 독립 EXE 브라우저 82개 통과 |

Chromium PC·모바일, Firefox, WebKit을 CI에서 검사합니다. Windows는 소스 없는 EXE로 검사합니다.

전체 플레이, 정상 기능 유지, 저장·초기화, 해시 복원 실패, 키보드 조작, 입력 처리, 로딩 실패·재시도, 동시 파일 요청을 검사합니다.

Windows 배포 검사는 EXE만 있는 임시 폴더에서 실제 실행창을 시작하고, 내장 파일·단일 인스턴스·포트 충돌·PC/모바일 게임을 확인합니다.

## 미확인

v0.2.6 실행은 사용자 PC에서도 확인했습니다. 실제 모바일 기기·Safari·스크린리더·200% 브라우저 확대와 교육 효과·플레이 시간은 검증하지 않았습니다.

## 3D 초기 구현 검증 · 2026-10-04

최신 main 통합 전 작업 브랜치에서 단위/엔진/모델 37개, 서버 12개, 브라우저 59개를 검증했다. 3D 키보드·마우스 검사 5개는 모바일에서 제외하고 모바일 2D 시작을 검증했다. 독립 EXE에서 같은 브라우저 검사 59개와 리소스·포트를 확인했다.

Windows 11 / Python 3.13.14 / Node 24.18.0 / Blender 5.2.2 LTS / Chromium 153에서 제작했다. 1920 × 1080, RTX 5060 Ti / D3D11 하드웨어 가속의 대표 실내 시점에서 60 FPS를 관측했다. 모든 학교 PC의 최저 프레임을 보장하는 수치는 아니다. 기본 headless SwiftShader는 약 7–11 FPS였다.

## 최신 main과 3D 통합 검증 · 2026-10-04

원본 main `f3a57b4`를 통합했다. `engine.js`, `missions.js`, `storage.js`, `launcher.py`, `instance.py`는 해당 main의 내용을 그대로 유지한다. 기존 시작 복구 스크립트의 SHA-256 CSP 승인을 보존하고 로컬 GLB·내장 텍스처를 위한 self/blob 허용을 함께 적용했다. 3D 연결에는 미션 ID를 전달하고 진행 가져오기·초기화 대화상자의 Esc·Tab 조작을 보호했다.

`npm ci` 후 `GAME_URL`로 별도 로컬 검사 주소를 지정하고 `SECURITYLAB_CROSS_BROWSER=1 npm run check`를 실행했다. 단위/엔진/모델 47개, 서버·실행창 단위 17개, Chromium PC·모바일/Firefox/WebKit 브라우저 158개가 통과했다. 3D 키보드·마우스 전용 검사 6개는 Chromium PC에서 실행하므로 다른 세 프로젝트의 18개 항목은 제외한다. 해당 프로젝트에서는 기존 2D 전체 동작과 2D 보기를 검증한다.

새로 만든 독립 Windows EXE만 한글·공백 임시 경로에 복사해 `tests/windows_launcher.ps1`를 실행했다. 공개 리소스 전부, 같은 버전의 단일 인스턴스 재사용, 다른 버전 차단, 기존 외부 포트 회피, 마지막 실행 주소 복구와 PC·모바일 브라우저 82개가 통과했다. 검사 상태 폴더는 기존 실행창과 분리하며 이미 사용 중인 5173 포트의 프로그램을 종료하지 않는다.

Node 개발 서버에서도 공개 리소스 22개의 실제 내용·MIME·시작 스크립트 해시 CSP 일치, 비공개 파일 거부와 쓰기 요청 거부를 확인했다. 실제 모바일 기기, Safari 제품, Firefox/WebKit의 3D 이동과 전체 스크린리더 경험은 추가 검증 대상이다.
