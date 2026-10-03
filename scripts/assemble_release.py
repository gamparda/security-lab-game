"""Assemble versioned Windows downloads from the verified executable."""

import hashlib
import json
from pathlib import Path
import re
import shutil
from zipfile import ZipFile, ZIP_DEFLATED


def assemble_release(source, directory, version):
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Release version must be X.Y.Z')
    content = source.read_bytes()
    if not content.startswith(b'MZ'):
        raise ValueError('Windows executable missing MZ signature')
    directory.mkdir(parents=True, exist_ok=True)
    stem = 'SecurityLab-v' + version + '-Windows-x64'
    executable = directory / (stem + '.exe')
    archive = directory / (stem + '.zip')
    shutil.copyfile(source, executable)
    with ZipFile(archive, 'w', ZIP_DEFLATED) as target:
        target.write(executable, executable.name)
    checksums = directory / ('SHA256SUMS-v' + version + '.txt')
    checksums.write_text(''.join(
        hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.name + '\n'
        for path in [archive, executable]
    ), encoding='utf-8')
    return archive, executable, checksums


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
    assemble_release(root / 'portable' / 'SecurityLab.exe', root / 'release', version)
