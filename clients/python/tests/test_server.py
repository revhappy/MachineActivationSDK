"""Supervision tests: the lifecycle, not the inference.

Run with: python -m unittest discover -s tests -t .
"""

from __future__ import annotations

import os
import socket
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from machine_activation import MachineClient, MachineServer, ServerStartError  # noqa: E402

FAKE_CLI = [sys.executable, str(Path(__file__).with_name("fake_machine_cli.py"))]


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_for(predicate, timeout: float = 15.0, interval: float = 0.1) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return False


class SupervisionTests(unittest.TestCase):
    def test_start_reports_the_resolved_url(self) -> None:
        # port=0 means the OS picks; the supervisor can only learn it from the
        # handshake, which is the entire reason the handshake exists.
        with MachineServer("model.gguf", port=0, machine_cmd=FAKE_CLI) as server:
            self.assertTrue(server.is_running)
            self.assertRegex(server.base_url, r"^http://127\.0\.0\.1:\d+$")
            self.assertNotIn(":0", server.base_url)
            self.assertTrue(server.client().is_ready())

    def test_stop_is_idempotent_and_shuts_the_process_down(self) -> None:
        server = MachineServer("model.gguf", port=0, machine_cmd=FAKE_CLI).start()
        url = server.base_url
        server.stop()
        server.stop()  # must not raise
        self.assertFalse(server.is_running)
        self.assertTrue(
            wait_for(lambda: not MachineClient(url, timeout=1.0).is_ready(), timeout=10),
            "the server was still answering after stop()",
        )

    def test_a_startup_failure_raises_rather_than_hanging(self) -> None:
        server = MachineServer(
            "model.gguf",
            port=0,
            machine_cmd=FAKE_CLI,
            env={"FAKE_FAIL": "1"},
        )
        with self.assertRaises(ServerStartError) as caught:
            server.start()
        self.assertIn("fake failure", str(caught.exception))
        self.assertFalse(server.is_running)

    def test_ready_timeout_does_not_wait_forever(self) -> None:
        server = MachineServer(
            "model.gguf",
            port=0,
            machine_cmd=FAKE_CLI,
            env={"FAKE_HANG": "1"},
            ready_timeout=2.0,
        )
        with self.assertRaises(ServerStartError) as caught:
            server.start()
        self.assertIn("did not become ready", str(caught.exception))
        server.stop()

    def test_a_second_server_attaches_instead_of_loading_another_copy(self) -> None:
        port = free_port()
        first = MachineServer("model.gguf", port=port, machine_cmd=FAKE_CLI).start()
        try:
            second = MachineServer("model.gguf", port=port, machine_cmd=FAKE_CLI).start()
            try:
                self.assertEqual(second.base_url, first.base_url)
                self.assertIsNone(second.pid, "attaching must not spawn a process")
                # Stopping an attached server must leave the owner alone.
                second.stop()
                self.assertTrue(first.client().is_ready())
            finally:
                second.stop()
        finally:
            first.stop()

    def test_reuse_can_be_declined(self) -> None:
        port = free_port()
        first = MachineServer("model.gguf", port=port, machine_cmd=FAKE_CLI).start()
        second = MachineServer(
            "model.gguf", port=0, machine_cmd=FAKE_CLI, reuse=False
        ).start()
        try:
            self.assertNotEqual(second.base_url, first.base_url)
            self.assertIsNotNone(second.pid)
        finally:
            second.stop()
            first.stop()

    def test_an_unexpected_death_is_restarted(self) -> None:
        logs = []
        server = MachineServer(
            "model.gguf",
            port=0,
            machine_cmd=FAKE_CLI,
            env={"FAKE_EXIT_AFTER": "0.5"},
            max_restarts=1,
            on_log=logs.append,
        ).start()
        try:
            self.assertTrue(
                wait_for(lambda: server.restarts >= 1, timeout=30),
                f"the supervisor never restarted the server; log: {logs}",
            )
            self.assertTrue(
                wait_for(lambda: server.is_running, timeout=30),
                f"the server did not come back; log: {logs}",
            )
        finally:
            server.stop()

    def test_restarts_are_bounded(self) -> None:
        logs = []
        server = MachineServer(
            "model.gguf",
            port=0,
            machine_cmd=FAKE_CLI,
            env={"FAKE_EXIT_AFTER": "0.3"},
            max_restarts=1,
            on_log=logs.append,
        ).start()
        try:
            self.assertTrue(
                wait_for(
                    lambda: any("giving up" in line for line in logs),
                    timeout=40,
                ),
                f"the supervisor never gave up; log: {logs}",
            )
            self.assertEqual(server.restarts, 1)
        finally:
            server.stop()

    def test_auto_restart_can_be_switched_off(self) -> None:
        logs = []
        server = MachineServer(
            "model.gguf",
            port=0,
            machine_cmd=FAKE_CLI,
            env={"FAKE_EXIT_AFTER": "0.3"},
            auto_restart=False,
            on_log=logs.append,
        ).start()
        try:
            self.assertTrue(
                wait_for(
                    lambda: any("not restarting" in line for line in logs), timeout=20
                ),
                f"log: {logs}",
            )
            self.assertEqual(server.restarts, 0)
        finally:
            server.stop()

    def test_a_missing_cli_says_how_to_get_one(self) -> None:
        server = MachineServer(
            "model.gguf", port=0, machine_cmd=[str(Path("no-such-machine-cli"))]
        )
        with self.assertRaises(ServerStartError) as caught:
            server.start()
        self.assertIn("Could not run", str(caught.exception))


class ProxyTests(unittest.TestCase):
    def test_a_system_proxy_does_not_capture_local_traffic(self) -> None:
        # A corporate laptop with $http_proxy set would otherwise send requests
        # for 127.0.0.1 to the proxy: it has no route back to this machine, so
        # "local model" becomes a connection error — and any request that did
        # get through would carry the user's prompts somewhere they never chose.
        blackhole = "http://127.0.0.1:9"  # discard port
        previous = {
            name: os.environ.get(name)
            for name in ("http_proxy", "HTTP_PROXY", "all_proxy", "ALL_PROXY", "no_proxy")
        }
        os.environ.update(
            {"http_proxy": blackhole, "HTTP_PROXY": blackhole, "all_proxy": blackhole}
        )
        os.environ.pop("no_proxy", None)
        try:
            with MachineServer("model.gguf", port=0, machine_cmd=FAKE_CLI) as server:
                self.assertTrue(
                    server.client(timeout=10.0).is_ready(),
                    "a system proxy captured traffic meant for the local model",
                )
        finally:
            for name, value in previous.items():
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value


class DiscoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        # Discovery consults $MACHINE_CLI and PATH before node_modules, so the
        # local-install tests below have to start from a known-empty state: a
        # developer with `machine` installed globally would otherwise see it win.
        self._previous_cli = os.environ.pop("MACHINE_CLI", None)
        import types

        from machine_activation import server as server_mod

        self._server_mod = server_mod
        self._real_shutil = server_mod.shutil
        self._real_which = server_mod.shutil.which
        # Swap the module's *reference*, not `shutil.which` itself — assigning
        # through it would monkeypatch the real shutil for every other module
        # for the duration of these tests.
        server_mod.shutil = types.SimpleNamespace(
            which=lambda name: None if name == "machine" else self._real_which(name)
        )

    def tearDown(self) -> None:
        self._server_mod.shutil = self._real_shutil
        if self._previous_cli is not None:
            os.environ["MACHINE_CLI"] = self._previous_cli

    def test_machine_cli_env_override_wins(self) -> None:
        from machine_activation import find_machine_cli

        os.environ["MACHINE_CLI"] = "/somewhere/machine"
        try:
            self.assertEqual(find_machine_cli(), ["/somewhere/machine"])
        finally:
            os.environ.pop("MACHINE_CLI", None)

    def test_a_batch_shim_is_never_wrapped_in_cmd_exe(self) -> None:
        """Regression: `cmd.exe /c` truncated any path containing a space.

        cmd strips the outermost quote pair of the whole command line once a
        second quoted argument is present, so `C:\\...\\Machine AI\\...` was cut
        at the space and the launch died with "'C:\\Users\\...' is not
        recognized". Every install under a spaced folder was affected.
        """
        from machine_activation.server import _as_command

        spaced = r"C:\Users\me\Machine AI\node_modules\.bin\machine.cmd"
        self.assertEqual(_as_command(spaced), [spaced])
        for shim in (spaced, "/usr/local/bin/machine", r"C:\x\machine.bat"):
            self.assertNotIn("cmd.exe", _as_command(shim))

    def _install(self, root: Path, *, with_package: bool) -> Path:
        """Fake a local npm install under `root`; returns the .bin shim path."""
        import json as _json

        bin_dir = root / "node_modules" / ".bin"
        bin_dir.mkdir(parents=True, exist_ok=True)
        shim = bin_dir / ("machine.cmd" if os.name == "nt" else "machine")
        shim.write_text("", encoding="utf-8")
        shim.chmod(0o755)

        if with_package:
            package = root / "node_modules" / "machineai-activation"
            entry = package / "dist" / "cjs" / "bin" / "machine.js"
            entry.parent.mkdir(parents=True, exist_ok=True)
            entry.write_text("", encoding="utf-8")
            (package / "package.json").write_text(
                _json.dumps({"name": "machineai-activation",
                             "bin": {"machine": "./dist/cjs/bin/machine.js"}}),
                encoding="utf-8",
            )
        return shim

    def _project(self, tmp: str, *parts: str) -> Path:
        """A project root under `tmp`, pre-resolved.

        `find_machine_cli` resolves its start directory, and a temp dir is
        exactly where that shows: macOS hands out `/var/...` for a path that
        resolves to `/private/var/...`, and Windows can hand out an 8.3 alias
        (`C:\\Users\\RUNNER~1\\...`) for `C:\\Users\\runneradmin\\...`. Comparing
        against an unresolved path passes on Linux and fails on both others.
        """
        root = Path(tmp).resolve().joinpath(*parts)
        root.mkdir(parents=True, exist_ok=True)
        return root

    def test_a_space_in_the_install_path_still_resolves(self) -> None:
        import tempfile

        from machine_activation import find_machine_cli

        with tempfile.TemporaryDirectory() as tmp:
            root = self._project(tmp, "Machine AI", "my app")
            shim = self._install(root, with_package=False)
            command = find_machine_cli(str(root))

            self.assertIsNotNone(command)
            assert command is not None
            # One argv element holding the whole spaced path: subprocess quotes
            # it correctly, and no shell gets a chance to re-split it.
            self.assertEqual(command, [str(shim)])
            self.assertIn(" ", command[0])

    def test_the_package_entry_is_preferred_over_the_shim(self) -> None:
        import tempfile

        from machine_activation import find_machine_cli

        with tempfile.TemporaryDirectory() as tmp:
            root = self._project(tmp, "Machine AI", "my app")
            self._install(root, with_package=True)
            command = find_machine_cli(str(root))

            self.assertIsNotNone(command)
            assert command is not None
            if self._real_which("node") is None:
                self.skipTest("no node on PATH; the shim fallback is correct here")
            self.assertEqual(len(command), 2)
            self.assertTrue(command[1].endswith("machine.js"), command)
            self.assertNotIn(".bin", command[1])

    def test_a_broken_package_falls_back_to_the_shim(self) -> None:
        """A package.json we cannot read must not break discovery outright."""
        import tempfile

        from machine_activation import find_machine_cli

        with tempfile.TemporaryDirectory() as tmp:
            root = self._project(tmp, "app")
            shim = self._install(root, with_package=False)
            package = root / "node_modules" / "machineai-activation"
            package.mkdir(parents=True, exist_ok=True)
            (package / "package.json").write_text("{not json", encoding="utf-8")

            self.assertEqual(find_machine_cli(str(root)), [str(shim)])


if __name__ == "__main__":
    unittest.main()
