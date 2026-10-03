"""Standalone desktop entry point; bundled with Python and game assets."""

import sys
import argparse
import json
import os
from pathlib import Path
import threading
import time
import traceback
import webbrowser
from http.client import HTTPConnection, HTTPException
from run import GameHandler, GameServer, PUBLIC_FILES, ROOT, main as serve


def start_server():
    # Prefer a stable origin so browser saves survive restarts.
    for port in range(5173, 5184):
        try:
            return GameServer(('127.0.0.1', port), GameHandler)
        except OSError:
            continue
    raise OSError('No available local port (5173–5183). Close another instance and try again.')


def check_server_assets(port, timeout=2, deadline=None):
    for name, content_type in PUBLIC_FILES.items():
        remaining = timeout if deadline is None else min(timeout, deadline - time.monotonic())
        if remaining <= 0:
            raise TimeoutError('Game asset verification timed out')
        connection = HTTPConnection('127.0.0.1', port, timeout=remaining)
        try:
            connection.request('GET', '/' + name)
            response = connection.getresponse()
            content = response.read()
            if response.status != 200 or response.getheader('Content-Type') != content_type or content != (ROOT / name).read_bytes():
                raise OSError('Game asset is not ready: ' + name)
        finally:
            connection.close()


def wait_for_server_assets(port, cancelled, timeout=30):
    deadline = time.monotonic() + timeout
    while not cancelled.is_set():
        try:
            check_server_assets(port, timeout=5, deadline=deadline)
            return
        except (OSError, ValueError, HTTPException):
            if time.monotonic() >= deadline:
                raise
            if cancelled.wait(0.3):
                return


def main():
    # Build verification uses the same packaged server and assets, without a GUI.
    if '--smoke-test' in sys.argv:
        sys.argv.remove('--smoke-test')
        serve()
        return

    parser = argparse.ArgumentParser(description='Security Lab desktop launcher')
    parser.add_argument('--no-browser', action='store_true', help='Skip browser opening during automated verification')
    parser.add_argument('--diagnostics', type=Path, help='Write startup verification to this file')
    args = parser.parse_args()

    def report(data):
        if args.diagnostics:
            args.diagnostics.write_text(json.dumps(data), encoding='utf-8')

    import tkinter as tk
    from tkinter import messagebox

    try:
        root = tk.Tk()
    except Exception:
        report({'error': traceback.format_exc()})
        raise
    root.title('Security Lab')
    root.geometry('460x270')
    root.resizable(False, False)
    root.configure(bg='#111b29')
    try:
        server = start_server()
    except OSError as error:
        report({'error': str(error)})
        messagebox.showerror('Security Lab', str(error))
        root.destroy()
        return

    url = 'http://localhost:%d' % server.server_port
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    cancelled = threading.Event()

    tk.Label(root, text='SECURITY LAB', font=('Arial', 22, 'bold'), fg='#79e3c2', bg='#111b29').pack(pady=(24, 12))
    tk.Label(root, text='게임은 브라우저에서 실행됩니다.', font=('맑은 고딕', 11), fg='#e2e9f2', bg='#111b29').pack()
    tk.Label(root, text='플레이하는 동안 이 창을 열어두세요.', font=('맑은 고딕', 10), fg='#99a8bc', bg='#111b29').pack(pady=(5, 0))
    status = tk.Label(root, text='게임 파일을 확인하고 있습니다.', fg='#99a8bc', bg='#111b29')
    status.pack(pady=(7, 14))

    def open_game():
        if not webbrowser.open(url):
            status.configure(text='브라우저에서 이 주소를 열어주세요: ' + url)

    def close():
        cancelled.set()
        root.destroy()
        # serve_forever runs on another thread, so shutdown cannot deadlock.
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    buttons = tk.Frame(root, bg='#111b29')
    buttons.pack()
    open_button = tk.Button(buttons, text='게임 다시 열기', command=open_game, state='disabled', font=('맑은 고딕', 10), width=16, bg='#79e3c2', fg='#092c22')
    open_button.pack(side='left', padx=6)
    tk.Button(buttons, text='종료', command=close, font=('맑은 고딕', 10), width=12).pack(side='left', padx=6)
    root.protocol('WM_DELETE_WINDOW', close)
    def ready(error=None):
        if error is not None:
            report({'error': str(error)})
            reason = '로컬 서버 응답이 늦습니다.' if isinstance(error, TimeoutError) else '로컬 서버의 게임 파일을 확인하지 못했습니다.'
            status.configure(text=reason + '\n준비 다시 시도를 눌러주세요.')
            open_button.configure(text='준비 다시 시도', command=prepare, state='normal')
            return
        status.configure(text=url)
        open_button.configure(text='게임 다시 열기', command=open_game, state='normal')
        report({'url': url, 'pid': os.getpid(), 'windowVisible': bool(root.winfo_viewable()), 'assetsReady': True})
        if not args.no_browser:
            open_game()

    pending = []

    def prepare():
        status.configure(text='게임 파일을 확인하고 있습니다. 잠시 기다려주세요.')
        open_button.configure(state='disabled')
        def check():
            try:
                wait_for_server_assets(server.server_port, cancelled)
                pending.append(None)
            except (OSError, ValueError, HTTPException) as error:
                pending.append(error)
        threading.Thread(target=check, daemon=True).start()
        root.after(100, poll)

    def poll():
        if cancelled.is_set():
            return
        if pending:
            ready(pending.pop())
        else:
            root.after(100, poll)

    root.after(200, prepare)
    root.mainloop()


if __name__ == '__main__':
    main()
