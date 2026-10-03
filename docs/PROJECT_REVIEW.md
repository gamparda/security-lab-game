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
| `scripts/package.py` | Python·게임 파일을 EXE로 패키징 |

HTML·CSS·JavaScript 구조를 유지합니다. 미션 추가 전 명령·단서 정의와 저장 버전 처리를 정리합니다. 다음 작업은 [ROADMAP.md](ROADMAP.md)에 있습니다.
