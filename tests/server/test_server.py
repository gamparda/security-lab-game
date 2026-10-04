import http.client
import re
from concurrent.futures import ThreadPoolExecutor
import importlib.util
from pathlib import Path
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from tempfile import TemporaryDirectory

spec = importlib.util.spec_from_file_location('game_server', Path(__file__).resolve().parents[2] / 'run.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = module.GameServer(('127.0.0.1', 0), module.GameHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, method, path):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        connection.request(method, path)
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_public_assets_and_security_headers(self):
        for name, content_type in module.PUBLIC_FILES.items():
            with self.subTest(name=name):
                status, headers, body = self.request('GET', '/' + name)
                self.assertEqual(status, 200)
                self.assertEqual(headers['Content-Type'], content_type)
                self.assertEqual(body, (module.ROOT / name).read_bytes())
                self.assertIn("connect-src 'self' blob:", headers['Content-Security-Policy'])
                self.assertNotIn("'unsafe-inline'", headers['Content-Security-Policy'])
                self.assertNotIn("'unsafe-eval'", headers['Content-Security-Policy'])
                self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')

    def test_home_and_head(self):
        status, headers, body = self.request('GET', '/')
        self.assertEqual(status, 200)
        self.assertIn('보안 체험 게임'.encode(), body)
        status, head_headers, head_body = self.request('HEAD', '/')
        self.assertEqual(status, 200)
        self.assertEqual(head_body, b'')
        self.assertEqual(head_headers['Content-Length'], headers['Content-Length'])

    def test_startup_guard_is_authorized_by_matching_strict_csp(self):
        _, headers, body = self.request('GET', '/')
        policy = re.search(r'<meta http-equiv="Content-Security-Policy" content="([^"]+)"', body.decode()).group(1)
        self.assertEqual(headers['Content-Security-Policy'], policy + "; frame-ancestors 'none'")
        self.assertIn("'sha256-" + module.STARTUP_HASH + "'", policy)
        self.assertNotIn('unsafe-inline', policy)
        self.assertNotIn('unsafe-eval', policy)

    def test_private_files_and_traversal_denied(self):
        for path in ['/.git/config', '/README.md', '/run.py', '/src/', '/%2e%2e/index.html', '/src/../index.html',
                     '/assets/', '/assets/models/', '/assets/authoring/painted_concrete_02_Diffuse_1k.jpg',
                     '/assets/models/security_lab.json', '/vendor/three/package.json', '/vendor/../run.py',
                     '/assets/%2e%2e/run.py', '/assets%5c..%5crun.py', '/assets/models/security_lab.glb/extra']:
            with self.subTest(path=path):
                self.assertEqual(self.request('GET', path)[0], 404)

    def test_write_methods_denied(self):
        for method in ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']:
            with self.subTest(method=method):
                self.assertEqual(self.request(method, '/')[0], 405)

    def test_existing_reusable_listener_cannot_share_game_port(self):
        legacy = ThreadingHTTPServer(('127.0.0.1', 0), module.GameHandler)
        try:
            with self.assertRaises(OSError):
                module.GameServer(legacy.server_address, module.GameHandler)
        finally:
            legacy.server_close()

    def test_asset_burst_survives_slow_accept_loop(self):
        class SlowAccept(module.GameServer):
            def get_request(self):
                time.sleep(0.015)
                return super().get_request()

        server = SlowAccept(('127.0.0.1', 0), module.GameHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        gate = threading.Barrier(32)
        def request(_):
            connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=1.5)
            try:
                gate.wait(timeout=5)
                connection.request('GET', '/src/style.css')
                response = connection.getresponse()
                content = response.read()
                return response.status == 200 and content == (module.ROOT / 'src/style.css').read_bytes()
            except OSError:
                return False
            finally:
                connection.close()

        try:
            with ThreadPoolExecutor(max_workers=32) as pool:
                self.assertTrue(all(pool.map(request, range(32))))
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_cached_assets_survive_extracted_files_disappearing(self):
        expected = dict(self.server.assets)
        with TemporaryDirectory() as directory, patch.object(module, 'ROOT', Path(directory)):
            for name, content in expected.items():
                with self.subTest(name=name):
                    status, _, body = self.request('GET', '/' + name)
                    self.assertEqual(status, 200)
                    self.assertEqual(body, content)

    def test_missing_bundled_file_prevents_listener_start(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            for name, content in self.server.assets.items():
                if name != 'src/style.css':
                    target = root / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(content)
            with patch.object(module, 'ROOT', root):
                with self.assertRaisesRegex(OSError, 'src/style.css: bundled file unreadable'):
                    module.GameServer(('127.0.0.1', 0), module.GameHandler)
