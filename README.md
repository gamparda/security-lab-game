# Security Lab

단서 조사 → 원인 설명 → 방어 적용 → 재검증으로 진행하는 보안 학습 게임.

## 실행

1. [최신 릴리즈](https://github.com/nu4ddi4/security-lab-game/releases/latest)의 Windows EXE 또는 ZIP을 받습니다.
2. EXE를 실행합니다. ZIP은 압축을 풀고 안의 EXE를 실행합니다.
3. 게임을 하는 동안 실행창을 열어둡니다.

Windows 10/11 64비트용입니다. 게임 파일과 Python이 EXE에 포함되어 있어 소스코드·Python·Node.js를 따로 설치하지 않습니다. 진행은 브라우저와 접속 주소별로 저장됩니다. 다른 주소로 옮길 때는 진행 내보내기/가져오기를 사용하세요.

공식 플레이 환경은 **Windows 10/11 + 최신 Google Chrome Desktop + 키보드·마우스**입니다. 최소 1280×720, 기준 1920×1080입니다. 모바일·터치·Edge·Firefox·Safari/WebKit은 공식 지원하지 않습니다. 실행창은 Chrome을 직접 엽니다.

## 미션

| 미션 | 목표 |
| --- | --- |
| 튜토리얼 | 명령어와 조사 범위 확인 |
| 노출된 서비스 | 443 유지, 불필요한 8080 차단 |
| 약한 로그인 정책 | 흔한 값 차단과 시도 제한, 정상 로그인 확인 |
| 변조된 자료 | SHA-256 비교, 원본 복구, 재비교 |

포트와 로그인은 시뮬레이션입니다. SHA-256은 실제로 계산합니다. 다음 행동 안내, 힌트, 진행 백업·이동, 초기화, 방어 전후 비교를 지원합니다.

첫 실행은 2D 화면입니다. ‘3D 실습실’을 선택하면 WASD·마우스로 이동하고 E로 장비의 조사 도구를 엽니다. 3D를 사용할 수 없으면 2D로 이어갈 수 있습니다. [3D 조작](docs/3D_LAB.md).

## 개발

```sh
python run.py
```

검증: Windows에 최신 Google Chrome 설치 → `npm ci` → `npm run check`. Chrome 단일 Playwright 프로젝트이며 브라우저를 별도로 다운로드하지 않습니다.

3D 일시정지 화면에서 Native/Ultra/Quality/Balanced/Performance 화질을 선택합니다. 기본 Quality는 75%로 3D만 렌더링하고 HTML은 원래 해상도를 유지합니다. F3으로 성능 정보를 확인합니다. [런타임·CI 최적화](docs/CHROME_RUNTIME.md).

[구조](docs/PROJECT_REVIEW.md) · [계획](docs/PLAN.md) · [안정화 계획](docs/STABILIZATION_PLAN.md) · [다음 작업](docs/ROADMAP.md) · [검증](docs/VALIDATION.md) · [배포](docs/DEPLOYMENT.md)
