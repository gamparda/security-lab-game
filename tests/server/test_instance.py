import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from instance import SingleInstance, preferred_port, write_json
import launcher


class InstanceTest(unittest.TestCase):
    def test_same_version_reuses_owned_instance_and_other_version_is_blocked(self):
        with TemporaryDirectory() as directory:
            opened = []
            first = SingleInstance(directory, '1.2.3', opened.append)
            second = SingleInstance(directory, '1.2.3', opened.append)
            other = SingleInstance(directory, '9.9.9', opened.append)
            try:
                self.assertTrue(first.owner)
                self.assertFalse(second.owner)
                first.publish('http://localhost:5174')
                result = second.reuse(True)
                self.assertTrue(result['reused'])
                self.assertEqual(result['url'], 'http://localhost:5174')
                self.assertEqual(opened, [True])
                self.assertEqual(other.reuse(False)['error'], 'version-conflict')
                self.assertEqual(opened, [True])
                self.assertNotIn('token', result)
            finally:
                second.close(); other.close(); first.close()
            replacement = SingleInstance(directory, '1.2.4', opened.append)
            self.assertTrue(replacement.owner)
            replacement.close()

    def test_port_setting_is_validated_and_retained(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            for value in [5178, '5178', 8000, None, True]:
                write_json(root / 'settings.json', {'port': value})
                self.assertEqual(preferred_port(root), 5178 if type(value) is int and value == 5178 else 5173)

    def test_foreign_endpoint_is_rejected(self):
        with TemporaryDirectory() as directory:
            first = SingleInstance(directory, '1.2.3', lambda _: None)
            second = SingleInstance(directory, '1.2.3', lambda _: None)
            try:
                write_json(Path(directory) / 'instance.json', {'address': 'http://example.com', 'token': 'a' * 64})
                with self.assertRaisesRegex(ValueError, 'endpoint'):
                    second.reuse(False)
            finally:
                second.close(); first.close()

    def test_foreign_port_is_not_reused_and_last_port_is_tried_first(self):
        calls = []
        def create(address, handler, **kwargs):
            calls.append(address[1])
            if len(calls) == 1:
                raise OSError('Foreign listener')
            return 'owned-server'
        with patch.object(launcher, 'GameServer', side_effect=create):
            self.assertEqual(launcher.start_server(5178), 'owned-server')
        self.assertEqual(calls, [5178, 5173])
