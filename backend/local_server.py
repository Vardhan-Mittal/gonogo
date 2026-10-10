"""Run the GoNoGo API locally with an in-memory store: python local_server.py

Same routes as the deployed API Gateway + Lambda, for frontend development
without AWS. Photo reports still call Bedrock, so they need AWS credentials.
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))
os.environ.setdefault("ALLOW_REFRESH", "1")  # no EventBridge locally

from gonogo.handlers import route, run_engine  # noqa: E402
from gonogo.store import get_store  # noqa: E402

PORT = 8787


class Handler(BaseHTTPRequestHandler):
    def _handle(self, method):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        status, body = route(get_store(), method, self.path.split("?")[0], lambda: json.loads(raw), dict(self.headers))
        payload = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")


if __name__ == "__main__":
    print(json.dumps(run_engine(get_store())))
    print(f"GoNoGo API on http://localhost:{PORT}")
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
