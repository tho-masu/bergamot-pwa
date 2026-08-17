#!/usr/bin/env python3
"""Nagi のローカルサーバー。

WASM のマルチスレッド実行には SharedArrayBuffer が要り、
そのために COOP/COEP ヘッダーが必要です。macOS 標準の python3 だけで動きます。

    ./serve.py            # http://localhost:8787
    ./serve.py 9000       # ポートを変える
"""

import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
ROOT = os.path.dirname(os.path.abspath(__file__))


EXTRA_TYPES = {
    ".wasm": "application/wasm",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # BaseHTTPRequestHandler.__init__ はこの中でリクエストを処理しきるので、
        # MIME の追加は super().__init__ より必ず前に置く。
        self.extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **EXTRA_TYPES}
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # SharedArrayBuffer を有効にするための2点セット
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        # Service Worker と衝突しないよう、アプリ本体は毎回確認させる
        # （.css が抜けていると、HTML だけ更新されて CSS が古いままという
        #   ズレが起きるので要注意）
        if self.path.endswith((".html", ".css", ".js", "/")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "304" not in fmt % args:
            sys.stderr.write("  %s\n" % (fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address: bool = True
    daemon_threads: bool = True


if __name__ == "__main__":
    if not os.path.isdir(os.path.join(ROOT, "models")):
        print("models/ がありません。先に ./setup.sh を実行してください。")
        sys.exit(1)

    url = f"http://localhost:{PORT}"
    print(f"\n  Nagi  {url}\n  停止は Control-C\n")

    with Server(("127.0.0.1", PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  停止しました\n")
