"""Build a standalone executable on its target operating system."""

from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
subprocess.run([
    sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean',
    '--onefile', '--windowed', '--name', 'SecurityLab',
    '--add-data', 'index.html:.', '--add-data', 'src:src', 'launcher.py',
], cwd=root, check=True)
(root / 'dist' / '시작안내.txt').write_text(
    'Security Lab · Windows 포터블\n\n'
    '1. ZIP 압축을 풀고 SecurityLab.exe를 더블클릭하세요.\n'
    '2. 기본 브라우저에서 게임이 자동으로 열립니다.\n'
    '3. 실행 창은 플레이하는 동안 열어두세요.\n'
    '4. 실행 창의 종료 버튼으로 앱을 종료합니다.\n\n'
    'Python, Node.js, npm 설치는 필요 없습니다. Windows 10/11 64비트용입니다.\n'
    '첫 실행은 내장 파일 압축 해제로 잠시 걸릴 수 있습니다.\n'
    '진행은 사용한 브라우저에 저장됩니다. 브라우저를 바꾸면 다른 진행으로 시작합니다.\n'
    '이 포터블은 게임 실행 파일을 이동할 수 있다는 뜻이며 브라우저 저장까지 이동하지는 않습니다.\n'
    '게임만 제공하는 localhost 서버를 사용하며 실제 외부 서버를 조사하지 않습니다.\n',
    encoding='utf-8-sig',
)
