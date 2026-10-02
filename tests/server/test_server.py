import http.client
import importlib.util
from pathlib import Path
import threading
import unittest
from http.server import ThreadingHTTPServer

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
