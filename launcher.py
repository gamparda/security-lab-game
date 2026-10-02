"""Standalone desktop entry point; bundled with Python and game assets."""

import sys
import argparse
import json
import os
from pathlib import Path
import threading
import traceback
import webbrowser
from http.server import ThreadingHTTPServer

from run import GameHandler, main as serve


def start_server():
    # Prefer a stable origin so browser saves survive restarts.
    for port in range(5173, 5184):
        try:
            return ThreadingHTTPServer(('127.0.0.1', port), GameHandler)
        except OSError:
            continue
    raise OSError('No available local port (5173–5183). Close another instance and try again.')


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

    tk.Label(root, text='SECURITY LAB', font=('Arial', 22, 'bold'), fg='#79e3c2', bg='#111b29').pack(pady=(24, 12))
    tk.Label(root, text='게임은 브라우저에서 실행됩니다.', font=('맑은 고딕', 11), fg='#e2e9f2', bg='#111b29').pack()
    tk.Label(root, text='플레이하는 동안 이 창을 열어두세요.', font=('맑은 고딕', 10), fg='#99a8bc', bg='#111b29').pack(pady=(5, 0))
    status = tk.Label(root, text=url, fg='#99a8bc', bg='#111b29')
    status.pack(pady=(7, 14))

    def open_game():
        if not webbrowser.open(url):
            status.configure(text='브라우저에서 이 주소를 열어주세요: ' + url)

    def close():
        root.destroy()
        # serve_forever runs on another thread, so shutdown cannot deadlock.
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    buttons = tk.Frame(root, bg='#111b29')
    buttons.pack()
    tk.Button(buttons, text='게임 다시 열기', command=open_game, font=('맑은 고딕', 10), width=16, bg='#79e3c2', fg='#092c22').pack(side='left', padx=6)
    tk.Button(buttons, text='종료', command=close, font=('맑은 고딕', 10), width=12).pack(side='left', padx=6)
    root.protocol('WM_DELETE_WINDOW', close)
    def ready():
        report({'url': url, 'pid': os.getpid(), 'windowVisible': bool(root.winfo_viewable())})
        if not args.no_browser:
            open_game()

    root.after(200, ready)
    root.mainloop()


if __name__ == '__main__':
    main()
