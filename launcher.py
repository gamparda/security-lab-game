"""Standalone desktop entry point; bundled with Python and game assets."""

import sys
import argparse
import json
import os
from pathlib import Path
import threading
import traceback
import webbrowser
from run import APP_VERSION, GameHandler, GameServer, PUBLIC_FILES, ROOT, load_game_assets, main as serve


def start_server():
    assets = load_game_assets()
    # Prefer a stable origin so browser saves survive restarts.
    for port in range(5173, 5184):
        try:
            return GameServer(('127.0.0.1', port), GameHandler, assets=assets)
        except OSError:
            continue
    raise OSError('No available local port (5173–5183). Close another instance and try again.')


def main():
    if '--smoke-test' in sys.argv:
        sys.argv.remove('--smoke-test')
        serve()
        return

    parser = argparse.ArgumentParser(description='Security Lab desktop launcher')
    parser.add_argument('--no-browser', action='store_true', help='Skip browser opening during automated verification')
    parser.add_argument('--diagnostics', type=Path, help='Write startup verification to this file')
    args = parser.parse_args()
    server = None
    thread = None
    url = None
    detail = ''

    def report(data):
        if args.diagnostics:
            assets = {name: name in server.assets if server else (ROOT / name).is_file() for name in PUBLIC_FILES}
            data = {'version': APP_VERSION, 'bundled': bool(getattr(sys, 'frozen', False)), 'assets': assets, **data}
            args.diagnostics.write_text(json.dumps(data), encoding='utf-8')

    import tkinter as tk
    from tkinter import messagebox

    try:
        root = tk.Tk()
    except Exception:
        report({'error': traceback.format_exc()})
        raise
    root.title('Security Lab v' + APP_VERSION)
    root.geometry('460x290')
    root.resizable(False, False)
    root.configure(bg='#111b29')

    tk.Label(root, text='SECURITY LAB', font=('Arial', 22, 'bold'), fg='#79e3c2', bg='#111b29').pack(pady=(24, 12))
    tk.Label(root, text='게임은 브라우저에서 실행됩니다.', font=('맑은 고딕', 11), fg='#e2e9f2', bg='#111b29').pack()
    tk.Label(root, text='플레이하는 동안 이 창을 열어두세요.', font=('맑은 고딕', 10), fg='#99a8bc', bg='#111b29').pack(pady=(5, 0))
    status = tk.Label(root, text='게임 파일을 준비하고 있습니다.', fg='#99a8bc', bg='#111b29', wraplength=420)
    status.pack(pady=(7, 14))

    def open_game():
        if not webbrowser.open(url):
            status.configure(text='브라우저에서 이 주소를 열어주세요: ' + url)

    def stop_server():
        nonlocal server, thread
        if server is not None:
            if thread is not None and thread.is_alive():
                server.shutdown()
                thread.join(timeout=2)
            server.server_close()
        server = None
        thread = None

    def close():
        root.destroy()
        stop_server()

    def copy_error():
        root.clipboard_clear()
        root.clipboard_append(detail)
        copy_button.configure(text='복사 완료')

    buttons = tk.Frame(root, bg='#111b29')
    buttons.pack()
    open_button = tk.Button(buttons, text='게임 다시 열기', command=open_game, state='disabled', font=('맑은 고딕', 10), width=16, bg='#79e3c2', fg='#092c22')
    open_button.pack(side='left', padx=6)
    tk.Button(buttons, text='종료', command=close, font=('맑은 고딕', 10), width=12).pack(side='left', padx=6)
    error_buttons = tk.Frame(root, bg='#111b29')
    tk.Button(error_buttons, text='오류 정보', command=lambda: messagebox.showerror('Security Lab', detail)).pack(side='left', padx=6)
    copy_button = tk.Button(error_buttons, text='오류 복사', command=copy_error)
    copy_button.pack(side='left', padx=6)
    root.protocol('WM_DELETE_WINDOW', close)

    def prepare():
        nonlocal server, thread, url, detail
        open_button.configure(state='disabled')
        status.configure(text='게임 파일을 준비하고 있습니다.')
        error_buttons.pack_forget()
        try:
            server = start_server()
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            if not thread.is_alive():
                raise OSError('Local server stopped during startup')
            url = 'http://localhost:%d' % server.server_port
        except (OSError, RuntimeError) as error:
            stop_server()
            detail = 'Security Lab v' + APP_VERSION + '\n' + type(error).__name__ + ': ' + str(error)
            report({'error': detail})
            status.configure(text='게임을 준비하지 못했습니다.\n오류 정보를 확인하거나 다시 시도해 주세요.')
            copy_button.configure(text='오류 복사')
            error_buttons.pack(pady=8)
            open_button.configure(text='준비 다시 시도', command=prepare, state='normal')
            return
        detail = ''
        status.configure(text=url)
        open_button.configure(text='게임 다시 열기', command=open_game, state='normal')
        report({'url': url, 'pid': os.getpid(), 'windowVisible': bool(root.winfo_viewable()), 'assetsReady': True})
        if not args.no_browser:
            open_game()

    root.after(200, prepare)
    root.mainloop()


if __name__ == '__main__':
    main()
