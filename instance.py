"""Per-user process lock and authenticated local open/focus requests."""

import json
import os
from pathlib import Path
import re
import secrets
import threading
import time
from multiprocessing.connection import Client, Listener
from multiprocessing import AuthenticationError


def state_directory():
    if os.name == 'nt':
        return Path(os.environ.get('LOCALAPPDATA', Path.home() / 'AppData' / 'Local')) / 'SecurityLab'
    return Path.home() / '.local' / 'state' / 'SecurityLab'


def preferred_port(directory):
    try:
        port = json.loads((directory / 'settings.json').read_text())['port']
        if type(port) is int and 5173 <= port <= 5183:
            return port
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return 5173


def write_json(path, data):
    temporary = path.with_name(path.name + '.' + secrets.token_hex(8) + '.tmp')
    try:
        with temporary.open('x', encoding='utf-8') as file:
            if os.name != 'nt':
                os.chmod(temporary, 0o600)
            json.dump(data, file)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


class SingleInstance:
    def __init__(self, directory, version, on_open):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.version = version
        self.on_open = on_open
        self.listener = None
        self.metadata = None
        self.closed = False
        self.file = (self.directory / 'instance.lock').open('a+b')
        if self.file.seek(0, 2) == 0:
            self.file.write(b'0')
            self.file.flush()
        self.file.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.owner = True
        except OSError:
            self.owner = False
        if self.owner:
            (self.directory / 'instance.json').unlink(missing_ok=True)

    def publish(self, url):
        if not self.owner or self.listener:
            raise RuntimeError('Instance is not ready to publish')
        nonce = secrets.token_hex(16)
        address = r'\\.\pipe\SecurityLab-' + nonce if os.name == 'nt' else str(self.directory / ('instance-' + nonce + '.sock'))
        token = secrets.token_hex(32)
        self.listener = Listener(address, family='AF_PIPE' if os.name == 'nt' else 'AF_UNIX', authkey=bytes.fromhex(token))
        self.metadata = {'address': address, 'token': token, 'version': self.version, 'pid': os.getpid(), 'url': url}
        try:
            write_json(self.directory / 'instance.json', self.metadata)
        except OSError:
            self.listener.close(); self.listener = None
            if os.name != 'nt': Path(address).unlink(missing_ok=True)
            self.metadata = None
            raise
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        while not self.closed:
            try:
                connection = self.listener.accept()
            except AuthenticationError:
                continue
            except (OSError, TypeError):
                return
            try:
                if not connection.poll(2):
                    continue
                request = json.loads(connection.recv_bytes(1024))
                if set(request) != {'action', 'version', 'openBrowser'} or request['action'] != 'open' or type(request['openBrowser']) is not bool:
                    reply = {'error': 'invalid-request'}
                elif request['version'] != self.version:
                    reply = {'error': 'version-conflict', 'version': self.version}
                else:
                    self.on_open(request['openBrowser'])
                    reply = {key: self.metadata[key] for key in ['url', 'pid', 'version']}
                    reply['reused'] = True
                connection.send_bytes(json.dumps(reply).encode())
            except (OSError, ValueError, TypeError, KeyError, EOFError):
                pass
            finally:
                connection.close()

    def reuse(self, open_browser):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                path = self.directory / 'instance.json'
                if path.stat().st_size > 16384:
                    raise ValueError('Invalid instance metadata')
                data = json.loads(path.read_text())
                address, token = data['address'], data['token']
                pattern = r'\\\\\.\\pipe\\SecurityLab-[a-f0-9]{32}' if os.name == 'nt' else re.escape(str(self.directory / 'instance-')) + r'[a-f0-9]{32}\.sock'
                if not isinstance(address, str) or not re.fullmatch(pattern, address) or not re.fullmatch(r'[a-f0-9]{64}', token):
                    raise ValueError('Invalid instance endpoint')
                with Client(address, family='AF_PIPE' if os.name == 'nt' else 'AF_UNIX', authkey=bytes.fromhex(token)) as connection:
                    connection.send_bytes(json.dumps({'action': 'open', 'version': self.version, 'openBrowser': open_browser}).encode())
                    if not connection.poll(3):
                        raise OSError('Existing launcher did not respond')
                    reply = json.loads(connection.recv_bytes(1024))
                    if 'error' not in reply:
                        if not re.fullmatch(r'http://localhost:51(?:7[3-9]|8[0-3])', reply.get('url', '')) or type(reply.get('pid')) is not int or reply.get('version') != self.version:
                            raise ValueError('Invalid instance response')
                    return reply
            except (FileNotFoundError, ConnectionRefusedError, EOFError):
                time.sleep(0.05)
        raise OSError('Existing launcher is not ready. Close it and try again.')

    def close(self):
        if self.closed:
            return
        self.closed = True
        if self.listener:
            self.listener.close()
        if self.owner and self.metadata:
            (self.directory / 'instance.json').unlink(missing_ok=True)
            if os.name != 'nt':
                Path(self.metadata['address']).unlink(missing_ok=True)
        self.file.close()
