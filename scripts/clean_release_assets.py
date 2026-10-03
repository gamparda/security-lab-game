"""Remove web downloads and the portable guide from existing GitHub releases."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from zipfile import ZipFile, ZIP_DEFLATED

WINDOWS_ZIP = 'SecurityLab-Windows-x64.zip'
WEB_ZIP = 'security-lab-web.zip'
CHECKSUMS = 'SHA256SUMS.txt'


def remove_guide(archive):
    with ZipFile(archive) as source:
        names = source.namelist()
        if names == ['SecurityLab.exe']:
            return False
        if set(names) != {'SecurityLab.exe', '시작안내.txt'} or len(names) != 2:
            raise ValueError('Unexpected portable archive contents')
        executable = source.read('SecurityLab.exe')
    updated = archive.with_suffix('.clean.zip')
    with ZipFile(updated, 'w', ZIP_DEFLATED) as target:
        target.writestr('SecurityLab.exe', executable)
    with ZipFile(updated) as target:
        assert target.read('SecurityLab.exe') == executable
    updated.replace(archive)
    return True


def gh(*args):
    return subprocess.check_output(['gh', *args])


def main():
    repo = os.environ['GITHUB_REPOSITORY']
    releases = json.loads(gh('api', '--paginate', '--slurp', f'repos/{repo}/releases'))
    for release in [entry for page in releases for entry in page]:
        if release['draft']:
            continue
        names = {asset['name'] for asset in release['assets']}
        if not {WINDOWS_ZIP, CHECKSUMS}.issubset(names):
            continue
        tag = release['tag_name']
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gh('release', 'download', tag, '--repo', repo, '--dir', directory,
               '--pattern', WINDOWS_ZIP, '--pattern', CHECKSUMS)
            archive = root / WINDOWS_ZIP
            recorded = dict(line.split('  ', 1)[::-1] for line in (root / CHECKSUMS).read_text().splitlines())
            if hashlib.sha256(archive.read_bytes()).hexdigest() != recorded.get(WINDOWS_ZIP):
                raise ValueError('Published portable checksum mismatch: ' + tag)
            changed = remove_guide(archive)
            checksum = hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + WINDOWS_ZIP + '\n'
            if changed:
                gh('release', 'upload', tag, str(archive), '--repo', repo, '--clobber')
            if (root / CHECKSUMS).read_text() != checksum:
                (root / CHECKSUMS).write_text(checksum)
                gh('release', 'upload', tag, str(root / CHECKSUMS), '--repo', repo, '--clobber')
            if WEB_ZIP in names:
                gh('release', 'delete-asset', tag, WEB_ZIP, '--repo', repo, '--yes')
            body = release.get('body') or ''
            cleaned = ('Windows 10/11 64비트.\n\n'
                       'ZIP을 풀고 `SecurityLab.exe`를 실행하세요. 소스코드와 별도 런타임 설치는 필요 없습니다.\n'
                       '플레이하는 동안 실행창을 열어두세요.\n')
            title = 'Security Lab ' + tag
            if cleaned != body or release['name'] != title:
                notes = root / 'notes.md'
                notes.write_text(cleaned)
                gh('release', 'edit', tag, '--repo', repo, '--title', title, '--notes-file', str(notes))
        print('Cleaned published downloads:', tag)


if __name__ == '__main__':
    main()
