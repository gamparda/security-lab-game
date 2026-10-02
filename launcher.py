"""Standalone desktop entry point; bundled with Python and game assets."""

import sys
import threading
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

    import tkinter as tk
    from tkinter import messagebox

    root = tk.Tk()
    root.title('Security Lab')
    root.geometry('420x235')
    root.resizable(False, False)
    root.configure(bg='#111b29')
    try:
        server = start_server()
    except OSError as error:
        messagebox.showerror('Security Lab', str(error))
        root.destroy()
        return

    url = 'http://localhost:%d' % server.server_port
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    tk.Label(root, text='SECURITY LAB', font=('Arial', 22, 'bold'), fg='#79e3c2', bg='#111b29').pack(pady=(24, 12))
    tk.Label(root, text='Play in your browser. Keep this window open.', fg='#e2e9f2', bg='#111b29').pack()
    status = tk.Label(root, text=url, fg='#99a8bc', bg='#111b29')
    status.pack(pady=(7, 14))

    def open_game():
        if not webbrowser.open(url):
            status.configure(text='Open in your browser: ' + url)

    def close():
        root.destroy()
        # serve_forever runs on another thread, so shutdown cannot deadlock.
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    buttons = tk.Frame(root, bg='#111b29')
    buttons.pack()
    tk.Button(buttons, text='Open game', command=open_game, width=15, bg='#79e3c2', fg='#092c22').pack(side='left', padx=6)
    tk.Button(buttons, text='Quit', command=close, width=12).pack(side='left', padx=6)
    root.protocol('WM_DELETE_WINDOW', close)
    root.after(200, open_game)
    root.mainloop()


if __name__ == '__main__':
    main()
