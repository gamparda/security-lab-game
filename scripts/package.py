"""Build a standalone executable on its target operating system."""

from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    # Use the same exact runtime allowlist as the server. Directory-wide copies
    # would also bundle authoring assets and files that the game never serves.
    sys.path.insert(0, str(ROOT))
    from run import PUBLIC_FILES

    bundled_files = [*PUBLIC_FILES, 'package.json', 'vendor/three/LICENSE', 'vendor/three/README.md', 'vendor/three/examples/jsm/libs/MESHOPT_LICENSE.md']
    for name in bundled_files:
        try:
            content = (ROOT / name).read_bytes()
        except OSError as error:
            raise OSError(name + ': bundled file unreadable (' + str(error) + ')') from error
        if not content:
            raise OSError(name + ': bundled file is empty')

    # Packaging requires npm ci on the build machine; the resulting executable
    # contains the verified local modules and never needs npm at runtime.
    subprocess.run(['node', 'scripts/vendor-three.js', '--check'], cwd=ROOT, check=True)
    command = [
        sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean',
        '--onefile', '--windowed', '--name', 'SecurityLab',
    ]
    for name in bundled_files:
        destination = Path(name).parent.as_posix()
        command.extend(['--add-data', name + ':' + destination])
    command.append('launcher.py')
    subprocess.run(command, cwd=ROOT, check=True)


if __name__ == '__main__':
    main()
