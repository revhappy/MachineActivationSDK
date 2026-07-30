"""Direct llama-server supervision: discovery, fetch layout, and no-Node use.

Run with: python -m unittest discover -s tests -t .
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from machine_activation import (  # noqa: E402
    LlamaServer,
    LlamaServerNotFound,
    MachineError,
    find_llama_server,
    supported_llama_hosts,
)
from machine_activation import llama as llama_mod  # noqa: E402


def exe_name() -> str:
    return "llama-server.exe" if sys.platform == "win32" else "llama-server"


class EnvSandbox(unittest.TestCase):
    """Isolate the env vars discovery consults, and the user cache."""

    def setUp(self) -> None:
        self._saved = {
            name: os.environ.pop(name, None)
            for name in ("MACHINE_LLAMA_SERVER", "MACHINE_HOME", "LLAMA_CPP_ASSET")
        }
        self._home = tempfile.TemporaryDirectory()
        # Point the per-user cache somewhere empty so a real one on this machine
        # cannot make these tests pass by accident.
        os.environ["MACHINE_HOME"] = self._home.name

    def tearDown(self) -> None:
        self._home.cleanup()
        for name, value in self._saved.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


class DiscoveryTests(EnvSandbox):
    def test_supported_hosts_all_resolve_a_target(self) -> None:
        self.assertIn("win32:AMD64", supported_llama_hosts())
        for host in supported_llama_hosts():
            entry = llama_mod._HOST_TARGETS[host]
            self.assertTrue(entry["slug"])
            self.assertTrue(entry["exe"].startswith("llama-server"))

    def test_an_explicit_binary_wins_over_everything(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            explicit = Path(tmp) / exe_name()
            explicit.write_text("", encoding="utf-8")
            os.environ["MACHINE_LLAMA_SERVER"] = str(explicit)
            self.assertEqual(find_llama_server(), str(explicit))

    def test_a_nonexistent_explicit_binary_is_ignored_not_returned(self) -> None:
        os.environ["MACHINE_LLAMA_SERVER"] = str(Path(tempfile.gettempdir()) / "nope-xyz")
        # Falls through rather than handing back a path that cannot be executed.
        self.assertNotEqual(find_llama_server(), os.environ["MACHINE_LLAMA_SERVER"])

    def test_the_user_cache_is_found_without_any_cwd_relationship(self) -> None:
        """The case a pip install actually has: no shared directory with the app."""
        slug = llama_mod._target()["slug"]
        cached = llama_mod.user_cache_dir() / slug / exe_name()
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_text("", encoding="utf-8")

        with tempfile.TemporaryDirectory() as unrelated:
            self.assertEqual(find_llama_server(unrelated), str(cached))

    def test_a_project_vendor_dir_still_works(self) -> None:
        """Back-compat with the layout the TypeScript runtime vendors into."""
        slug = llama_mod._target()["slug"]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve() / "My App"
            binary = root / "vendor" / "llama-cpp" / slug / exe_name()
            binary.parent.mkdir(parents=True, exist_ok=True)
            binary.write_text("", encoding="utf-8")
            self.assertEqual(find_llama_server(str(root)), str(binary))

    def test_nothing_anywhere_returns_none(self) -> None:
        real_which = llama_mod.shutil.which
        llama_mod.shutil.which = lambda _name: None
        try:
            with tempfile.TemporaryDirectory() as empty:
                self.assertIsNone(find_llama_server(empty))
        finally:
            llama_mod.shutil.which = real_which


class SupervisionTests(EnvSandbox):
    def test_a_missing_model_is_named_before_anything_is_spawned(self) -> None:
        server = LlamaServer(str(Path(tempfile.gettempdir()) / "not-a-model.gguf"))
        with self.assertRaises(MachineError) as caught:
            server.start()
        self.assertIn("not-a-model.gguf", str(caught.exception))

    def test_no_binary_and_no_auto_fetch_says_how_to_get_one(self) -> None:
        # Stub discovery itself: this box may have a vendored binary a few
        # directories above the test, which would otherwise satisfy the search.
        real_find = llama_mod.find_llama_server
        llama_mod.find_llama_server = lambda *_a: None
        try:
            with tempfile.TemporaryDirectory() as tmp:
                model = Path(tmp) / "model.gguf"
                model.write_text("", encoding="utf-8")
                server = LlamaServer(str(model), auto_fetch=False)
                with self.assertRaises(LlamaServerNotFound) as caught:
                    server.resolve_binary()
                message = str(caught.exception)
                self.assertIn("auto_fetch=True", message)
                self.assertIn("MACHINE_LLAMA_SERVER", message)
        finally:
            llama_mod.find_llama_server = real_find

    def test_base_url_reflects_host_and_port(self) -> None:
        server = LlamaServer("m.gguf", host="127.0.0.1", port=9321)
        self.assertEqual(server.base_url, "http://127.0.0.1:9321")
        self.assertEqual(server.client().base_url, "http://127.0.0.1:9321")

    def test_stop_is_safe_before_start_and_twice(self) -> None:
        server = LlamaServer("m.gguf")
        server.stop()
        server.stop()
        self.assertFalse(server.is_running)

    def test_attaching_to_a_healthy_port_does_not_spawn_or_stop_it(self) -> None:
        """Reuse must not load a second copy, nor kill a server it borrowed."""
        server = LlamaServer("m.gguf", port=9322)
        server._healthy = lambda: True  # pretend something is already serving
        server.start()
        self.assertIsNone(server._process, "attached mode must not spawn")
        self.assertTrue(server.is_running)
        server.stop()  # must be a no-op, not a kill of someone else's process
        self.assertIsNone(server._process)

    def test_serve_local_model_falls_back_when_no_node_cli_exists(self) -> None:
        from machine_activation import llama as mod
        from machine_activation import server as server_mod

        real_find = server_mod.find_machine_cli
        server_mod.find_machine_cli = lambda *_a, **_k: None
        started = {}

        class Fake(mod.LlamaServer):
            def start(self):  # type: ignore[override]
                started["direct"] = True
                return self

        real_llama = mod.LlamaServer
        mod.LlamaServer = Fake
        try:
            mod.serve_local_model("m.gguf", port=9323)
            self.assertTrue(started.get("direct"), "should use the direct path")
        finally:
            mod.LlamaServer = real_llama
            server_mod.find_machine_cli = real_find


if __name__ == "__main__":
    unittest.main()
