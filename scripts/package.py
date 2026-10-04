"""Build a standalone executable on its target operating system."""

from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
subprocess.run([
    sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean',
    '--onefile', '--windowed', '--name', 'SecurityLab',
    '--add-data', 'index.html:.', '--add-data', 'src:src',
    '--add-data', 'assets/models/security_lab.glb:assets/models',
    '--add-data', 'vendor:vendor',
    '--add-data', 'package.json:.', 'launcher.py',
], cwd=root, check=True)
