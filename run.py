#!/usr/bin/env python3
"""Run Security Lab using only the Python standard library."""

import argparse
import base64
import hashlib
import re
import json
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
try:
    APP_VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
except (OSError, ValueError, KeyError):
    APP_VERSION = 'unknown'
REQUIRED_FILES = {
    'index.html': 'text/html; charset=utf-8',
    'src/app.js': 'text/javascript; charset=utf-8',
    'src/bootstrap.js': 'text/javascript; charset=utf-8',
    'src/engine.js': 'text/javascript; charset=utf-8',
    'src/missions.js': 'text/javascript; charset=utf-8',
    'src/storage.js': 'text/javascript; charset=utf-8',
    'src/loading.css': 'text/css; charset=utf-8',
    'src/style.css': 'text/css; charset=utf-8',
    'src/labbridge.js': 'text/javascript; charset=utf-8',
    'src/scene-entry.js': 'text/javascript; charset=utf-8',
}
OPTIONAL_FILES = {
    'assets/credits.txt': 'text/plain; charset=utf-8',
    'src/collision.js': 'text/javascript; charset=utf-8',
    'src/player3d.js': 'text/javascript; charset=utf-8',
    'src/interaction3d.js': 'text/javascript; charset=utf-8',
    'src/scene3d.js': 'text/javascript; charset=utf-8',
    'src/batch3d.js': 'text/javascript; charset=utf-8',
    'src/city3d.js': 'text/javascript; charset=utf-8',
    'src/visibility3d.js': 'text/javascript; charset=utf-8',
    'src/upscale3d.js': 'text/javascript; charset=utf-8',
    'assets/environment/city-sunset.png': 'image/png',
    'src/scene3d.css': 'text/css; charset=utf-8',
    'assets/models/security_lab.glb': 'model/gltf-binary',
    'vendor/three/build/three.module.js': 'text/javascript; charset=utf-8',
    'vendor/three/build/three.core.js': 'text/javascript; charset=utf-8',
    'vendor/three/examples/jsm/loaders/GLTFLoader.js': 'text/javascript; charset=utf-8',
    'vendor/three/examples/jsm/utils/BufferGeometryUtils.js': 'text/javascript; charset=utf-8',
    'vendor/three/examples/jsm/utils/SkeletonUtils.js': 'text/javascript; charset=utf-8',
    'vendor/three/examples/jsm/controls/PointerLockControls.js': 'text/javascript; charset=utf-8',
    'vendor/three/examples/jsm/libs/meshopt_decoder.module.js': 'text/javascript; charset=utf-8',
    'vendor/three/examples/jsm/environments/RoomEnvironment.js': 'text/javascript; charset=utf-8',
}
PUBLIC_FILES = {**REQUIRED_FILES, **OPTIONAL_FILES}
try:
    _html = (ROOT / 'index.html').read_text(encoding='utf-8')
    _guard = re.search(r'<script id="startup-guard">(.*?)</script>', _html, re.S).group(1)
except (OSError, AttributeError):
    _guard = ''  # The launcher reports unreadable assets before opening a listener.
STARTUP_HASH = base64.b64encode(hashlib.sha256(_guard.encode()).digest()).decode()
CSP = (
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-" + STARTUP_HASH + "'; style-src 'self'; "
    "connect-src 'self' blob:; img-src 'self' data: blob:; object-src 'none'; "
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
)


class GameAssets(dict):
    """Cached runtime files, retaining the loader's existing dictionary interface."""

    def __init__(self):
        super().__init__()
        self.optional_asset_warnings = {}


def load_game_assets():
    assets = GameAssets()
    root = ROOT.resolve()
    for name in PUBLIC_FILES:
        try:
            target = (root / name).resolve()
            if not target.is_relative_to(root) or not target.is_file():
                raise OSError('not a regular bundled file inside the game directory')
            content = target.read_bytes()
        except (OSError, RuntimeError) as error:
            message = name + ': bundled file unreadable (' + str(error) + ')'
            if name in REQUIRED_FILES:
                raise OSError(message) from error
            assets.optional_asset_warnings[name] = message
            continue
        if not content:
            message = name + ': bundled file is empty'
            if name in REQUIRED_FILES:
                raise OSError(message)
            assets.optional_asset_warnings[name] = message
            continue
        assets[name] = content
    return assets


class GameServer(ThreadingHTTPServer):
    # Browsers load several assets concurrently; the Python 3.12 default is 5.
    request_queue_size = 64
    allow_reuse_address = sys.platform != 'win32'

    def __init__(self, server_address, handler, bind_and_activate=True, *, assets=None):
        # Cache required files before opening the listener; 3D can fail separately.
        self.assets = load_game_assets() if assets is None else assets
        for name in REQUIRED_FILES:
            if not self.assets.get(name):
                raise OSError(name + ': required cached file missing or empty')
        self.required_assets_ready = True
        self.asset_digests = {name: hashlib.sha256(content).hexdigest() for name, content in self.assets.items()}
        self.optional_asset_warnings = dict(getattr(self.assets, 'optional_asset_warnings', {}))
        for name in OPTIONAL_FILES:
            if not self.assets.get(name):
                self.optional_asset_warnings.setdefault(name, name + ': optional cached file missing or empty')
        super().__init__(server_address, handler, bind_and_activate)

    def server_bind(self):
        if sys.platform == 'win32':
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class GameHandler(BaseHTTPRequestHandler):
    # Reuse browser connections across the local module graph instead of
    # opening a socket per file. Bound idle worker lifetime as well.
    protocol_version = 'HTTP/1.1'
    timeout = 10

    def respond(self, status, content, content_type='text/plain; charset=utf-8', digest=None):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(content)))
        if self.close_connection:
            self.send_header('Connection', 'close')
        self.send_header('Content-Security-Policy', CSP)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Security-Lab-Version', APP_VERSION)
        if digest:
            self.send_header('X-Security-Lab-SHA256', digest)
        try:
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # Reloads and failed asset retries can cancel an in-flight response.
            self.close_connection = True

    def do_GET(self):
        try:
            relative = unquote(urlsplit(self.path).path).removeprefix('/')
        except ValueError:
            self.respond(404, b'Not found')
            return
        if not relative:
            relative = 'index.html'
        if relative.startswith('__scene__/'):
            retry = re.fullmatch(r'__scene__/[a-z0-9]{1,16}-[0-9]{1,6}/(.+)', relative)
            if not retry or retry.group(1) not in OPTIONAL_FILES:
                self.respond(404, b'Not found')
                return
            relative = retry.group(1)
        if relative not in PUBLIC_FILES:
            self.respond(404, b'Not found')
            return
        content = self.server.assets.get(relative)
        if not content:
            self.respond(404, b'Not found')
            return
        self.respond(200, content, PUBLIC_FILES[relative], self.server.asset_digests[relative])

    do_HEAD = do_GET

    def reject_write(self):
        # Do not interpret an unread request body as a second request.
        self.close_connection = True
        self.respond(405, b'Method not allowed')

    do_POST = reject_write
    do_PUT = reject_write
    do_PATCH = reject_write
    do_DELETE = reject_write
    do_OPTIONS = reject_write

    def log_message(self, format, *args):
        # Game input is never part of a server request; keep console output quiet.
        pass


def main():
    parser = argparse.ArgumentParser(description='Security Lab localhost server')
    parser.add_argument('--port', type=int, default=5173, help='Local port (default: 5173)')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('Port must be between 1 and 65535.')
    try:
        with GameServer(('127.0.0.1', args.port), GameHandler) as server:
            for message in server.optional_asset_warnings.values():
                print('Optional 3D asset warning: ' + message, file=sys.stderr, flush=True)
            print('Security Lab: http://localhost:%d' % args.port, flush=True)
            print('Open this URL in your browser. Stop: Ctrl+C', flush=True)
            server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped.')
    except OSError as error:
        parser.exit(1, 'Cannot start server: %s\nTry another port: python run.py --port 5174\n' % error)


if __name__ == '__main__':
    main()
