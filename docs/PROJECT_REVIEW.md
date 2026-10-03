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

## 추가 검토 결과

- 여러 탭이 최신 진행을 덮어쓰거나 초기화한 진행을 되살리는 문제를 재현했다.
- 시작 스크립트 실패의 무한 로딩, 미지원 저장 원본 삭제, 정상 저장 뒤 남는 실패 안내를 확인했다.
- 브라우저 오류 상세·복사와 포트 변경 시 진행 이동 수단이 부족하다.
- 초기화 취소와 320·360·390px 서비스 미션 화면은 조사한 Chromium 조건에서 정상이다.

근거, 수정 순서와 완료 기준: [STABILIZATION_PLAN.md](STABILIZATION_PLAN.md).
