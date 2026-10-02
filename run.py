#!/usr/bin/env python3
"""Run Security Lab using only the Python standard library."""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
PUBLIC_FILES = {
    'index.html': 'text/html; charset=utf-8',
    'src/app.js': 'text/javascript; charset=utf-8',
    'src/engine.js': 'text/javascript; charset=utf-8',
    'src/missions.js': 'text/javascript; charset=utf-8',
    'src/storage.js': 'text/javascript; charset=utf-8',
    'src/style.css': 'text/css; charset=utf-8',
}
CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; "
    "connect-src 'none'; img-src 'self' data:; object-src 'none'; "
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
)


class GameHandler(BaseHTTPRequestHandler):
    def respond(self, status, content, content_type='text/plain; charset=utf-8'):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Content-Security-Policy', CSP)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(content)

    def do_GET(self):
        relative = unquote(urlsplit(self.path).path).removeprefix('/')
        if not relative:
            relative = 'index.html'
        if relative not in PUBLIC_FILES:
            self.respond(404, b'Not found')
            return
        try:
            content = (ROOT / relative).read_bytes()
        except OSError:
            self.respond(404, b'Not found')
            return
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
        with ThreadingHTTPServer(('127.0.0.1', args.port), GameHandler) as server:
            print('Security Lab: http://localhost:%d' % args.port, flush=True)
            print('Open this URL in your browser. Stop: Ctrl+C', flush=True)
            server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped.')
    except OSError as error:
        parser.exit(1, 'Cannot start server: %s\nTry another port: python run.py --port 5174\n' % error)


if __name__ == '__main__':
    main()
