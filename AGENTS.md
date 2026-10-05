# 개발 규칙

- 원본 기획은 `docs/PLAN.md`이다. 첫 버전은 프레임워크 없는 정적 웹 앱이다.
- 실제 IP·URL로 요청하지 않는다. 명령어는 허용 목록만 해석한다.
- `eval`, `Function`, 사용자 입력 기반 `fetch`, 소켓, 셸 실행을 도입하지 않는다.
- 동적 출력에는 `textContent`를 사용한다. 개인 파일·실제 비밀번호는 받지 않는다.
- 포트와 로그인은 시뮬레이션, SHA-256은 Web Crypto 실제 연산이다.
- 방어 적용과 정상 기능 재검증을 모두 통과해야 미션이 완료된다.
- 변경 뒤 `npm run check`를 실행한다. 공식 E2E 환경: Windows 10/11에 설치된 최신 Google Chrome Desktop 하나. CI는 핵심 unit/server + standalone Chrome smoke를 실행한다.
- 선택 암호 퍼즐과 실제 서버 실습은 필수 미션 안정화 후 진행한다.
