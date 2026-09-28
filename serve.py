import http.server, socketserver, urllib.request, urllib.error, os, sys

WORKER = "https://cfi-football-intelligence.baoanhrat112020.workers.dev"
PORT = 8080
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        sys.stderr.write("[proxy] " + (fmt % args) + "\n")

    def _proxy(self, method):
        url = WORKER + self.path
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None

        req = urllib.request.Request(url, data=body, method=method)
        req.add_header("User-Agent", UA)
        req.add_header("Accept", "application/json, text/plain, */*")
        req.add_header("Accept-Language", "vi,en;q=0.9")
        req.add_header("Origin", WORKER)
        req.add_header("Referer", WORKER + "/")
        for h in ["Content-Type"]:
            if self.headers.get(h):
                req.add_header(h, self.headers[h])
        if body and not req.get_header("Content-type"):
            req.add_header("Content-Type", "application/json")

        print("[proxy] %s %s body=%s" % (method, url, (body[:200] if body else None)))

        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            data = e.read()
            print("[proxy] HTTPError %s body=%s" % (e.code, data[:300]))
            self.send_response(e.code)
            self.send_header("Content-Type", e.headers.get("Content-Type", "application/json"))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            print("[proxy] EXC", e)
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(('{"error":"proxy: ' + str(e).replace(chr(34), chr(92)+chr(34)) + '"}').encode())

    def do_GET(self):
        if self.path.startswith("/api/") or self.path.startswith("/health"): self._proxy("GET")
        else: super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/") or self.path.startswith("/health"): self._proxy("POST")
        else: self.send_response(404); self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

class ReusableTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

print("="*60)
print(" CFI dev server: http://localhost:%d" % PORT)
print(" Serving:", ROOT)
print(" Proxy:", WORKER)
print("="*60)
with ReusableTCPServer(("", PORT), Handler) as httpd:
    httpd.serve_forever()
