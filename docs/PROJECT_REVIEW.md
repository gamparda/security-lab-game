# 코드 구조

| 파일 | 역할 |
| --- | --- |
| `src/missions.js` | 미션, 단서, 힌트, 해설 |
| `src/engine.js` | 명령 해석, 상태 변경, 완료 판정, 해시 |
| `src/storage.js` | 진행 저장·복원·검사 |
| `src/app.js` | 화면과 입력 |
| `src/bootstrap.js` | CSS·게임 준비 확인 |
| `run.py` | 게임 파일 전용 로컬 서버 |
| `launcher.py` | EXE 실행창과 서버 시작 |
| `instance.py` | 사용자별 단일 실행·인증된 로컬 열기 요청 |
| `scripts/package.py` | Python·게임 파일을 EXE로 패키징 |

HTML·CSS·JavaScript 구조를 유지합니다. 미션은 ID로 정의하고 저장 시 단서·순서·완료 조건을 검사합니다. 다음 작업은 [ROADMAP.md](ROADMAP.md)에 있습니다.

## 안정화 적용

v0.3.0에서 저장 충돌·원본 보존·시작 복구·오류 복사·진행 이동을 구현했습니다. 다음 행동 안내와 미션 정의 검사도 추가했습니다.

적용 내용과 수동 검증: [STABILIZATION_PLAN.md](STABILIZATION_PLAN.md).
