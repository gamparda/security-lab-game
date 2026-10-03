from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile
from scripts.clean_release_assets import remove_guide


class ReleaseArchiveTest(unittest.TestCase):
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
