# 배포

## Windows

- `SecurityLab-vX.Y.Z-Windows-x64.exe`: 다운로드 후 바로 실행.
- `SecurityLab-vX.Y.Z-Windows-x64.zip`: 같은 EXE 한 개.
- `SHA256SUMS-vX.Y.Z.txt`: ZIP·EXE 체크섬.
- Windows 10/11 64비트. 소스코드나 별도 런타임 설치 불필요.
- 플레이하는 동안 실행창을 유지합니다. 종료 버튼으로 서버를 닫습니다.
- 기본 포트는 5173이며, 사용 중이면 5183까지 찾습니다. 진행은 브라우저·주소·포트별로 저장됩니다.

## 릴리즈

`package.json`과 잠금 파일의 버전, `docs/RELEASE.md`를 갱신해 PR을 머지합니다. Windows 빌드·독립 실행·게임 검사가 통과하면 태그와 릴리즈를 게시합니다. 제목은 `Security Lab vX.Y.Z`입니다.

## 웹 파일 내보내기

`python scripts/export_web.py`. 현재 웹 ZIP은 릴리즈에 올리지 않습니다. 홈서버에서 제공할 때는 HTTPS를 설정합니다.
