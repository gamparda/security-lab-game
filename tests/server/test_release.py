from pathlib import Path
from hashlib import sha256
import tempfile
import unittest
from zipfile import ZipFile
from scripts.clean_release_assets import remove_guide
from scripts.assemble_release import assemble_release


class ReleaseArchiveTest(unittest.TestCase):
    def test_versioned_zip_and_direct_executable_are_identical_and_checksummed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'SecurityLab.exe'
            content = b'MZ\x00\xff standalone executable'
            source.write_bytes(content)
            archive, executable, checksums = assemble_release(source, root / 'release', '0.2.8')
            self.assertEqual(archive.name, 'SecurityLab-v0.2.8-Windows-x64.zip')
            self.assertEqual(executable.name, 'SecurityLab-v0.2.8-Windows-x64.exe')
            self.assertEqual(checksums.name, 'SHA256SUMS-v0.2.8.txt')
            self.assertEqual(executable.read_bytes(), content)
            with ZipFile(archive) as target:
                self.assertEqual(target.namelist(), [executable.name])
                self.assertEqual(target.read(executable.name), content)
            recorded = dict(line.split('  ', 1)[::-1] for line in checksums.read_text().splitlines())
            self.assertEqual(recorded, {path.name: sha256(path.read_bytes()).hexdigest() for path in [archive, executable]})

    def test_invalid_version_or_executable_produces_no_release(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'SecurityLab.exe'
            source.write_bytes(b'MZ verified executable')
            for version in ['../0.2.8', 'v0.2.8', '0.2', '0.2.8\n']:
                with self.subTest(version=version), self.assertRaises(ValueError):
                    assemble_release(source, root / 'release', version)
            source.write_bytes(b'Not an executable')
            with self.assertRaises(ValueError):
                assemble_release(source, root / 'release', '0.2.8')
            source.unlink()
            with self.assertRaises(FileNotFoundError):
                assemble_release(source, root / 'release', '0.2.8')
            self.assertFalse((root / 'release').exists())

    def test_remove_guide_preserves_executable_and_can_repeat(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'portable.zip'
            executable = b'MZ\x00\xff executable contents'
            with ZipFile(archive, 'w') as target:
                target.writestr('SecurityLab.exe', executable)
                target.writestr('시작안내.txt', 'Old guide')
            self.assertTrue(remove_guide(archive))
            with ZipFile(archive) as target:
                self.assertEqual(target.namelist(), ['SecurityLab.exe'])
                self.assertEqual(target.read('SecurityLab.exe'), executable)
            self.assertFalse(remove_guide(archive))

    def test_unexpected_archive_is_left_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'portable.zip'
            with ZipFile(archive, 'w') as target:
                target.writestr('other.exe', b'MZ')
            before = archive.read_bytes()
            with self.assertRaises(ValueError):
                remove_guide(archive)
            self.assertEqual(archive.read_bytes(), before)
