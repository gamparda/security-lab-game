import http.client
import importlib.util
from pathlib import Path
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from launcher import check_server_assets, wait_for_server_assets

spec = importlib.util.spec_from_file_location('game_server', Path(__file__).resolve().parents[2] / 'run.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), module.GameHandler)
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
                self.assertIn("connect-src 'none'", headers['Content-Security-Policy'])
                self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')

    def test_home_and_head(self):
        status, headers, body = self.request('GET', '/')
        self.assertEqual(status, 200)
        self.assertIn('보안 체험 게임'.encode(), body)
        status, head_headers, head_body = self.request('HEAD', '/')
        self.assertEqual(status, 200)
        self.assertEqual(head_body, b'')
        self.assertEqual(head_headers['Content-Length'], headers['Content-Length'])

    def test_private_files_and_traversal_denied(self):
        for path in ['/.git/config', '/README.md', '/run.py', '/src/', '/%2e%2e/index.html', '/src/../index.html']:
            with self.subTest(path=path):
                self.assertEqual(self.request('GET', path)[0], 404)

    def test_write_methods_denied(self):
        for method in ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']:
            with self.subTest(method=method):
                self.assertEqual(self.request(method, '/')[0], 405)

    def test_launcher_requires_all_assets_before_opening(self):
        check_server_assets(self.server.server_port)

    def test_launcher_waits_for_slow_asset_response(self):
        class SlowStart(module.GameHandler):
            def do_GET(self):
                if self.path == '/index.html':
                    time.sleep(2.2)
                try:
                    super().do_GET()
                except (BrokenPipeError, ConnectionResetError):
                    pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), SlowStart)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with self.assertRaises(TimeoutError):
                check_server_assets(server.server_port)
            wait_for_server_assets(server.server_port, threading.Event(), timeout=6)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_launcher_retries_transient_failure(self):
        class FirstRequestFails(module.GameHandler):
            failed = False
            def do_GET(self):
                if not type(self).failed:
                    type(self).failed = True
                    self.respond(503, b'Not ready')
                else:
                    super().do_GET()

        server = ThreadingHTTPServer(('127.0.0.1', 0), FirstRequestFails)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            wait_for_server_assets(server.server_port, threading.Event(), timeout=3)
            self.assertTrue(FirstRequestFails.failed)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_launcher_retry_expires_or_can_be_cancelled(self):
        with patch('launcher.check_server_assets', side_effect=OSError('Not ready')):
            with self.assertRaisesRegex(OSError, 'Not ready'):
                wait_for_server_assets(0, threading.Event(), timeout=0)
        cancelled = threading.Event()
        cancelled.set()
        wait_for_server_assets(0, cancelled)

    def test_launcher_rejects_missing_stylesheet(self):
        class MissingStyle(module.GameHandler):
            def do_GET(self):
                if self.path == '/src/style.css':
                    self.respond(404, b'Not found')
                else:
                    super().do_GET()

        server = ThreadingHTTPServer(('127.0.0.1', 0), MissingStyle)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with self.assertRaisesRegex(OSError, 'src/style.css'):
                check_server_assets(server.server_port)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
