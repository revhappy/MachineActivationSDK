"""A stand-in for the `machine` CLI, speaking the supervision handshake.

The real thing loads several gigabytes of weights, which is not something a
test suite should do on every run. What the supervisor actually depends on is
the *contract* — one JSON line on stdout, a reachable /health, and shutdown when
stdin closes — so that is what this implements.

    python fake_machine_cli.py serve <model> --supervised --port <n> [...]

Env knobs used by the tests:
    FAKE_FAIL=1      report a startup failure instead of becoming ready
    FAKE_HANG=1      never emit the handshake
    FAKE_EXIT_AFTER  seconds to live before dying unexpectedly
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        if self.path == "/health":
            body = json.dumps({"status": "ok", "model": {"id": "fake"}}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, *_args: object) -> None:
        pass  # stdout is the handshake channel; keep it clean


def main(argv: list) -> int:
    if not argv or argv[0] != "serve":
        print("fake cli: expected `serve`", file=sys.stderr)
        return 2

    port = 0
    for index, token in enumerate(argv):
        if token == "--port" and index + 1 < len(argv):
            port = int(argv[index + 1])

    if os.getenv("FAKE_FAIL"):
        print(json.dumps({"event": "error", "message": "fake failure"}), flush=True)
        return 1

    server = HTTPServer(("127.0.0.1", port), Handler)
    actual_port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()

    if os.getenv("FAKE_HANG"):
        time.sleep(600)
        return 0

    print(
        json.dumps(
            {
                "event": "ready",
                "url": f"http://127.0.0.1:{actual_port}",
                "port": actual_port,
                "host": "127.0.0.1",
                "pid": os.getpid(),
            }
        ),
        flush=True,
    )

    exit_after = os.getenv("FAKE_EXIT_AFTER")
    if exit_after:
        time.sleep(float(exit_after))
        os._exit(7)  # an unexpected death, not a clean shutdown

    # Block until the supervisor closes our stdin.
    sys.stdin.read()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
