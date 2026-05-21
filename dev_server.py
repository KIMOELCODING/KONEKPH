"""Konek.PH local dev server.

Plain static file server (like `python -m http.server 8000`) with one extra
behavior: SPA fallback for the admin app. Any GET under `/admin/...` that
doesn't map to a real file is served `admin/index.html` so React Router
(BrowserRouter basename=/admin) can take over client-side.

This matches what Cloudflare / Nginx will do in production. Without it,
hard-refreshing on /admin/brokers or /admin/listings returns 404.
"""

import http.server
import os
import socketserver
import urllib.parse

PORT = 8000
ROOT = os.path.dirname(os.path.abspath(__file__))
ADMIN_INDEX_REL = "/admin/index.html"


class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 (stdlib name)
        url_path = urllib.parse.urlparse(self.path).path
        if url_path == "/admin" or url_path.startswith("/admin/"):
            disk_path = self.translate_path(self.path)
            is_missing = not os.path.exists(disk_path)
            is_dir_without_index = (
                os.path.isdir(disk_path)
                and not os.path.exists(os.path.join(disk_path, "index.html"))
            )
            if is_missing or is_dir_without_index:
                self.path = ADMIN_INDEX_REL
        return super().do_GET()


if __name__ == "__main__":
    os.chdir(ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), SPAHandler) as httpd:
        print(f"Konek.PH dev server on http://localhost:{PORT}/")
        print("SPA fallback active for /admin/* -> admin/index.html")
        httpd.serve_forever()
