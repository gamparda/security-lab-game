import http.client
import hashlib
import json
import os
import queue
import re
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
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


def copy_assets(root, assets, omitted=()):
    for name, content in assets.items():
        if name in omitted:
            continue
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)


def request_port(port, method, path):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
    try:
        connection.request(method, path)
        response = connection.getresponse()
        return response.status, dict(response.getheaders()), response.read()
    finally:
        connection.close()


@contextmanager
def python_server(root):
    with patch.object(module, 'ROOT', root):
        server = module.GameServer(('127.0.0.1', 0), module.GameHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


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
        return request_port(self.server.server_port, method, path)

    def test_public_assets_and_security_headers(self):
        for name, content_type in module.PUBLIC_FILES.items():
            with self.subTest(name=name):
                status, headers, body = self.request('GET', '/' + name)
                self.assertEqual(status, 200)
                self.assertEqual(headers['Content-Type'], content_type)
                self.assertEqual(body, (module.ROOT / name).read_bytes())
                self.assertIn("connect-src 'self' blob:", headers['Content-Security-Policy'])
                self.assertIn("img-src 'self' data: blob:", headers['Content-Security-Policy'])
                self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
                self.assertEqual(headers['Cache-Control'], 'no-store')
                self.assertEqual(headers['X-Security-Lab-Version'], module.APP_VERSION)
                self.assertEqual(headers['X-Security-Lab-SHA256'], hashlib.sha256(body).hexdigest())

    def test_home_and_head(self):
        status, headers, body = self.request('GET', '/')
        self.assertEqual(status, 200)
        self.assertIn('보안 체험 게임'.encode(), body)
        status, head_headers, head_body = self.request('HEAD', '/')
        self.assertEqual(status, 200)
        self.assertEqual(head_body, b'')
        self.assertEqual(head_headers['Content-Length'], headers['Content-Length'])

    def test_scene_retry_namespace_preserves_assets_and_cannot_expose_core_or_private_files(self):
        prefix = '/__scene__/test123-1/'
        for name, content_type in module.OPTIONAL_FILES.items():
            with self.subTest(name=name):
                status, headers, body = self.request('GET', prefix + name)
                self.assertEqual((status, body), (200, self.server.assets[name]))
                self.assertEqual(headers['Content-Type'], content_type)
                self.assertEqual(headers['X-Security-Lab-SHA256'], hashlib.sha256(body).hexdigest())
                head_status, head_headers, head_body = self.request('HEAD', prefix + name)
                self.assertEqual((head_status, head_body), (200, b''))
                self.assertEqual(head_headers['Content-Length'], str(len(body)))
        for path in [prefix + 'src/app.js', prefix + 'src/labbridge.js', prefix + 'README.md',
                     prefix + 'src/../index.html', '/__scene__/bad_/src/scene3d.js']:
            self.assertEqual(self.request('GET', path)[0], 404)

    def test_startup_guard_is_authorized_by_matching_strict_csp(self):
        _, headers, body = self.request('GET', '/')
        policy = re.search(r'<meta http-equiv="Content-Security-Policy" content="([^"]+)"', body.decode()).group(1)
        self.assertEqual(headers['Content-Security-Policy'], policy + "; frame-ancestors 'none'")
        self.assertIn("'sha256-" + module.STARTUP_HASH + "'", policy)
        self.assertNotIn('unsafe-inline', policy)
        self.assertNotIn('unsafe-eval', policy)

    def test_private_files_and_traversal_denied(self):
        for path in ['/.git/config', '/README.md', '/run.py', '/src/', '/%2e%2e/index.html', '/src/../index.html',
                     '/src/%2e%2e/index.html', '/src%5capp.js', '/vendor/three/LICENSE',
                     '/assets/textures/authoring.jpg', '/scripts/vendor-three.js']:
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

    def test_required_bridge_and_entry_failure_happens_before_listener_bind(self):
        for name in ['src/labbridge.js', 'src/scene-entry.js']:
            with self.subTest(name=name), TemporaryDirectory() as directory:
                root = Path(directory)
                copy_assets(root, self.server.assets, omitted=[name])
                with patch.object(module, 'ROOT', root), patch.object(ThreadingHTTPServer, 'server_bind') as bind:
                    with self.assertRaisesRegex(OSError, re.escape(name) + ': bundled file unreadable'):
                        module.GameServer(('127.0.0.1', 0), module.GameHandler)
                    bind.assert_not_called()

    def test_optional_glb_and_modules_missing_preserve_2d_and_return_404(self):
        omitted = ['assets/models/security_lab.glb', 'src/scene3d.js',
                   'vendor/three/build/three.module.js', 'src/scene3d.css']
        with TemporaryDirectory() as directory:
            root = Path(directory)
            copy_assets(root, self.server.assets, omitted=omitted)
            with python_server(root) as server:
                self.assertTrue(server.required_assets_ready)
                self.assertEqual(set(server.optional_asset_warnings), set(omitted))
                self.assertIsInstance(server.assets, dict)
                for name in module.REQUIRED_FILES:
                    self.assertEqual(request_port(server.server_port, 'GET', '/' + name)[0], 200)
                for name in omitted:
                    with self.subTest(name=name):
                        status, headers, body = request_port(server.server_port, 'GET', '/' + name)
                        self.assertEqual((status, body), (404, b'Not found'))
                        status, head_headers, body = request_port(server.server_port, 'HEAD', '/' + name)
                        self.assertEqual((status, body), (404, b''))
                        self.assertEqual(headers['Content-Length'], head_headers['Content-Length'])

    def test_empty_and_unreadable_optional_assets_are_captured(self):
        with TemporaryDirectory() as directory:
            # Windows runners can return an 8.3 temp path; the asset loader
            # resolves it before reading, so the fault fixture must match it.
            root = Path(directory).resolve()
            copy_assets(root, self.server.assets)
            empty = 'assets/models/security_lab.glb'
            unreadable = 'src/scene3d.js'
            (root / empty).write_bytes(b'')
            original_read = Path.read_bytes

            def read_bytes(path):
                if path == root / unreadable:
                    raise PermissionError('simulated unreadable optional file')
                return original_read(path)

            with patch.object(Path, 'read_bytes', read_bytes), python_server(root) as server:
                self.assertIn('is empty', server.optional_asset_warnings[empty])
                self.assertIn('simulated unreadable', server.optional_asset_warnings[unreadable])
                self.assertEqual(request_port(server.server_port, 'GET', '/src/app.js')[0], 200)
                self.assertEqual(request_port(server.server_port, 'GET', '/' + empty)[0], 404)
                self.assertEqual(request_port(server.server_port, 'HEAD', '/' + unreadable)[0], 404)

    def test_symlinks_outside_bundle_are_not_served(self):
        with TemporaryDirectory() as directory:
            root = Path(directory) / 'game'
            root.mkdir()
            copy_assets(root, self.server.assets)
            outside = Path(directory) / 'private.js'
            outside.write_bytes(b'private outside data')
            optional = root / 'src/scene3d.js'
            optional.unlink()
            try:
                optional.symlink_to(outside)
            except OSError as error:
                self.skipTest('Symlink creation unavailable: ' + str(error))
            with python_server(root) as server:
                self.assertIn('inside the game directory', server.optional_asset_warnings['src/scene3d.js'])
                self.assertEqual(request_port(server.server_port, 'GET', '/src/scene3d.js')[0], 404)
                self.assertEqual(request_port(server.server_port, 'GET', '/')[0], 200)
            required = root / 'src/app.js'
            required.unlink()
            required.symlink_to(outside)
            with patch.object(module, 'ROOT', root):
                with self.assertRaisesRegex(OSError, 'src/app.js: bundled file unreadable'):
                    module.GameServer(('127.0.0.1', 0), module.GameHandler)


@unittest.skipUnless(shutil.which('node'), 'Node.js is unavailable')
class NodeServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.assets = module.load_game_assets()
        cls.source = module.ROOT / 'scripts/serve.js'

    def prepare_root(self, root, omitted=()):
        copy_assets(root, self.assets, omitted)
        (root / 'scripts').mkdir(exist_ok=True)
        shutil.copyfile(self.source, root / 'scripts/serve.js')
        (root / 'package.json').write_text(json.dumps({'type': 'module', 'version': module.APP_VERSION}), encoding='utf-8')

    @contextmanager
    def serve(self, root):
        process = subprocess.Popen([shutil.which('node'), 'scripts/serve.js'], cwd=root,
                                   env={**os.environ, 'PORT': '0'}, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, encoding='utf-8')
        output = queue.Queue()
        threading.Thread(target=lambda: output.put(process.stdout.readline()), daemon=True).start()
        try:
            try:
                line = output.get(timeout=10)
            except queue.Empty:
                self.fail('Node server did not become ready')
            match = re.search(r'http://localhost:(\d+)', line)
            if not match:
                _, error = process.communicate(timeout=5)
                self.fail('Node server failed before listening: ' + error)
            yield int(match.group(1))
        finally:
            if process.poll() is None:
                process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            process.stdout.close()
            process.stderr.close()

    def test_node_public_allowlist_mime_and_csp_match_python(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            self.prepare_root(root)
            with self.serve(root) as port:
                for name, content_type in module.PUBLIC_FILES.items():
                    with self.subTest(name=name):
                        status, headers, body = request_port(port, 'GET', '/' + name)
                        self.assertEqual((status, body), (200, self.assets[name]))
                        self.assertEqual(headers['Content-Type'], content_type)
                        self.assertEqual(headers['Content-Security-Policy'], module.CSP)
                        self.assertEqual(headers['Cache-Control'], 'no-store')
                        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
                        self.assertEqual(headers['X-Security-Lab-SHA256'], hashlib.sha256(body).hexdigest())
                        self.assertNotIn('unsafe-eval', headers['Content-Security-Policy'])
                status, headers, body = request_port(port, 'HEAD', '/assets/models/security_lab.glb')
                self.assertEqual((status, body), (200, b''))
                self.assertEqual(int(headers['Content-Length']), len(self.assets['assets/models/security_lab.glb']))
                for name in ['src/scene3d.js', 'vendor/three/build/three.core.js', 'src/scene3d.css']:
                    status, headers, body = request_port(port, 'GET', '/__scene__/test123-1/' + name)
                    self.assertEqual((status, body), (200, self.assets[name]))
                for path in ['/__scene__/test123-1/src/app.js', '/__scene__/bad_/src/scene3d.js', '/__scene__/test123-1/README.md']:
                    self.assertEqual(request_port(port, 'GET', path)[0], 404)
                for path in ['/src/../index.html', '/src/%2e%2e/index.html', '/%2e%2e/index.html',
                             '/run.py', '/vendor/three/LICENSE', '/assets/textures/authoring.jpg', '/%']:
                    self.assertEqual(request_port(port, 'GET', path)[0], 404, path)
                self.assertEqual(request_port(port, 'POST', '/')[0], 405)

    def test_node_optional_failures_and_escaping_symlink_preserve_2d(self):
        omitted = ['assets/models/security_lab.glb', 'src/scene3d.js']
        with TemporaryDirectory() as directory:
            root = Path(directory) / 'game'
            root.mkdir()
            self.prepare_root(root, omitted)
            (root / 'src/scene3d.css').write_bytes(b'')
            outside = Path(directory) / 'private.js'
            outside.write_bytes(b'private outside data')
            optional = root / 'src/player3d.js'
            optional.unlink()
            try:
                optional.symlink_to(outside)
            except OSError:
                # Missing optional files still exercise the fallback on systems without symlink privileges.
                pass
            with self.serve(root) as port:
                self.assertEqual(request_port(port, 'GET', '/')[0], 200)
                self.assertEqual(request_port(port, 'GET', '/src/app.js')[0], 200)
                for name in [*omitted, 'src/scene3d.css', 'src/player3d.js']:
                    self.assertEqual(request_port(port, 'GET', '/' + name)[0], 404)
                    self.assertEqual(request_port(port, 'HEAD', '/' + name)[0], 404)

    def test_node_required_missing_prevents_listener(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            self.prepare_root(root, omitted=['src/scene-entry.js'])
            result = subprocess.run([shutil.which('node'), 'scripts/serve.js'], cwd=root,
                                    env={**os.environ, 'PORT': '0'}, capture_output=True,
                                    text=True, encoding='utf-8', timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('src/scene-entry.js: required bundled file unreadable', result.stderr)
            self.assertNotIn('http://localhost:', result.stdout)
