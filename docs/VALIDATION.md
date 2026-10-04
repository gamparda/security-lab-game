# 검증

## 실행

```sh
npm run check
```

시스템 Chromium: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run check`.

Linux CI는 `SECURITYLAB_HEADED=1`과 Xvfb 가상 화면에서 데스크톱 3D 브라우저를 실행한다. 3D 검사는 실제 마우스 잠금을 사용하므로 창 없는 headless shell에서 잠금이 거부되는 환경을 피한다. 3D 입력 검사는 하나의 파일에서 순서대로 실행하며, 다른 worker의 2D 검사는 headless로 실행해 가상 화면의 포커스를 빼앗지 않는다. 로컬 기본 검사는 기존 headless 방식이다.

```sh
SECURITYLAB_HEADED=1 SECURITYLAB_CROSS_BROWSER=1 xvfb-run --auto-servernum --server-args='-screen 0 1920x1080x24' npm run check
```

Linux 브라우저 검사 실패 시 `test-results`의 trace와 오류 내용을 GitHub Actions 아티팩트로 7일 보관한다. 테스트용 이동이나 마우스 잠금 우회는 사용하지 않는다.

Windows CI의 3D 검사는 일반 Chromium·Edge의 실제 창과 D3D11 WARP 소프트웨어 그래픽을 사용한다. 640 × 480 화면에서 한 worker로 실행하며, 2D 검사는 headless에서 GPU를 끄고 실행해 소프트웨어 그래픽 경쟁을 줄인다. 화면 캡처 부하를 줄이기 위해 자동 trace의 화면 녹화는 끄고 동작·DOM 기록을 유지한다. 달리기는 실제 키 입력으로 이동한 거리와 시뮬레이션 시간을 비교한다. 로컬 Windows 기본 검사는 D3D11을 유지한다. 단독 EXE 검사는 내장 GLB의 실제 첫 화면을 먼저 확인한 뒤 전체 PC·모바일 및 Edge 검사를 진행하며, 실패 trace를 7일 보관한다.

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

Chromium PC·모바일, Firefox, WebKit을 CI에서 검사합니다. Windows는 소스 없는 EXE로 검사합니다.

전체 플레이, 정상 기능 유지, 저장·초기화, 해시 복원 실패, 키보드 조작, 입력 처리, 로딩 실패·재시도, 동시 파일 요청을 검사합니다.

Windows 배포 검사는 EXE만 있는 임시 폴더에서 실제 실행창을 시작하고, 내장 파일·단일 인스턴스·포트 충돌·PC/모바일 게임을 확인합니다.

## v0.4.0 검사 범위

단위 48개와 서버·배포 24개, 기존 2D 브라우저 검사 148개를 유지합니다. 선택형 3D 진입, 장비 5종, 충돌, 전체 미션, 저장, 자산 실패·시간 초과, WebGL 손실·복원, 중첩 대화상자 검사를 추가합니다.

Windows CI는 단독 EXE로 Chromium PC·모바일과 Edge를 검사합니다. 첫 렌더링과 내장 모델을 확인하며 실제 GPU 성능을 보장하지는 않습니다. 최종 통과 여부는 해당 릴리즈 커밋의 [GitHub Actions](https://github.com/nu4ddi4/security-lab-game/actions)에서 확인합니다.

## 미확인

v0.2.6 실행은 사용자 PC에서도 확인했습니다. 실제 Windows PC의 GPU 성능·30분 실행, 실제 모바일·Safari·스크린리더·200% 확대·입문자 시연은 미확인입니다.
