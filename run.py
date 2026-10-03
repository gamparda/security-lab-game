#!/usr/bin/env python3
"""Run Security Lab using only the Python standard library."""

import argparse
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
PUBLIC_FILES = {
    'index.html': 'text/html; charset=utf-8',
    'src/app.js': 'text/javascript; charset=utf-8',
    'src/bootstrap.js': 'text/javascript; charset=utf-8',
    'src/engine.js': 'text/javascript; charset=utf-8',
    'src/missions.js': 'text/javascript; charset=utf-8',
    'src/storage.js': 'text/javascript; charset=utf-8',
    'src/loading.css': 'text/css; charset=utf-8',
    'src/style.css': 'text/css; charset=utf-8',
}
CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; "
    "connect-src 'none'; img-src 'self' data:; object-src 'none'; "
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
)


def load_game_assets():
    assets = {}
    for name in PUBLIC_FILES:
        try:
            content = (ROOT / name).read_bytes()
        except OSError as error:
            raise OSError(name + ': bundled file unreadable (' + str(error) + ')') from error
        if not content:
            raise OSError(name + ': bundled file is empty')
        assets[name] = content
    return assets


class GameServer(ThreadingHTTPServer):
    # Browsers load several assets concurrently; the Python 3.12 default is 5.
    request_queue_size = 64
    allow_reuse_address = sys.platform != 'win32'

    def __init__(self, server_address, handler, bind_and_activate=True, *, assets=None):
        # Read every bundled file before opening the listener.
        self.assets = load_game_assets() if assets is None else assets
        super().__init__(server_address, handler, bind_and_activate)

    def server_bind(self):
        if sys.platform == 'win32':
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class GameHandler(BaseHTTPRequestHandler):
    def respond(self, status, content, content_type='text/plain; charset=utf-8'):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Content-Security-Policy', CSP)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Security-Lab-Version', APP_VERSION)
        try:
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # Reloads and failed asset retries can cancel an in-flight response.
            pass

    def do_GET(self):
        relative = unquote(urlsplit(self.path).path).removeprefix('/')
        if not relative:
            relative = 'index.html'
        if relative not in PUBLIC_FILES:
            self.respond(404, b'Not found')
            return
        content = self.server.assets[relative]
        self.respond(200, content, PUBLIC_FILES[relative])

    do_HEAD = do_GET

    def reject_write(self):
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
            print('Security Lab: http://localhost:%d' % args.port, flush=True)
            print('Open this URL in your browser. Stop: Ctrl+C', flush=True)
            server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped.')
    except OSError as error:
        parser.exit(1, 'Cannot start server: %s\nTry another port: python run.py --port 5174\n' % error)


if __name__ == '__main__':
    main()
