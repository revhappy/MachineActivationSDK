"""Spawn and supervise `machine serve` from a Python process.

Without this, "use the SDK from Python" means asking a human to open a second
terminal and keep it open. That is fine for a demo and disqualifying for a
product: an app cannot ship a local model if a person has to start the model.

    from machine_activation import MachineServer

    with MachineServer("model.gguf") as server:
        print(server.client().chat([{"role": "user", "content": "hi"}]))

`MachineServer` owns the process for real, not just at the happy path:

  * **It reuses.** A multi-gigabyte model takes seconds to load and holds that
    memory for as long as it lives, so pointing at a port that already has a
    healthy server attaches to it instead of loading a second copy. Reloading a
    dev server should not cost another 4 GB.
  * **It restarts.** llama.cpp can die — an OOM on a machine that was already
    tight, a driver fault. The supervisor notices and brings it back, with
    backoff, so one bad generation is not the end of the session.
  * **It cleans up the whole tree.** `machine serve` spawns `llama-server` as a
    *grandchild*, so killing the child alone strands the process actually
    holding the weights. Shutdown closes stdin first (letting the server take
    its own child down cleanly), then kills the group or tree if that is not
    enough. An `atexit` hook covers the app that forgets to call `stop()`.

Standard library only, like the rest of this client.
"""

from __future__ import annotations

import atexit
import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Union

from .client import DEFAULT_BASE_URL, MachineClient, MachineError

__all__ = ["MachineServer", "ServerStartError", "find_machine_cli"]

DEFAULT_PORT = 8177

Command = Union[str, Sequence[str]]
LogSink = Callable[[str], None]


class ServerStartError(MachineError):
    """`machine serve` could not be started, or never became ready."""


def find_machine_cli(start_dir: Optional[str] = None) -> Optional[List[str]]:
    """Locate the `machine` CLI, as a command list ready for `subprocess`.

    Order: ``$MACHINE_CLI``, then `machine` on PATH, then a `node_modules/.bin`
    walking up from `start_dir`. The last one matters most in practice — a
    Python sidecar shipped next to an Electron app has the SDK installed
    locally, not globally, and telling that developer to `npm i -g` is a
    packaging problem disguised as a setup step.
    """
    override = os.getenv("MACHINE_CLI")
    if override:
        return _as_command(override)

    on_path = shutil.which("machine")
    if on_path:
        return _as_command(on_path)

    directory = Path(start_dir or os.getcwd()).resolve()
    names = ["machine.cmd", "machine.exe", "machine"] if os.name == "nt" else ["machine"]
    for parent in [directory, *directory.parents]:
        for name in names:
            candidate = parent / "node_modules" / ".bin" / name
            if candidate.exists():
                return _as_command(str(candidate))

    return None


def _as_command(executable: str) -> List[str]:
    """Wrap a Windows batch shim so CreateProcess can actually run it.

    npm installs its bin shims as `.cmd` on Windows, which is not an executable
    image. The extra `cmd.exe` in the tree is exactly why shutdown kills by tree
    rather than by pid.
    """
    if os.name == "nt" and executable.lower().endswith((".cmd", ".bat")):
        return ["cmd.exe", "/c", executable]
    return [executable]


class MachineServer:
    """A supervised `machine serve` process.

    Args:
        model: path to a `.gguf`, or the id of a cartridge you have pulled.
        port: ``None`` (default) uses the standard port and attaches to a server
            already running there. A number does the same for that port. ``0``
            asks the OS for a free one, which always means a private instance.
        reuse: override the attach behavior described above.
        auto_restart: bring the server back if it dies unexpectedly.
        ready_timeout: seconds to wait for the model to load. Generous by
            default — a multi-gigabyte model on a cold page cache genuinely
            takes minutes, and a timeout that fires during a healthy load looks
            like a broken install.
        on_log: called with each line the server writes to its logs.
    """

    def __init__(
        self,
        model: str,
        *,
        port: Optional[int] = None,
        host: str = "127.0.0.1",
        ctx: Optional[int] = None,
        gpu_layers: Optional[int] = None,
        server_binary: Optional[str] = None,
        api_key: Optional[str] = None,
        cache: Optional[str] = None,
        extra_args: Sequence[str] = (),
        machine_cmd: Optional[Command] = None,
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        ready_timeout: float = 900.0,
        auto_restart: bool = True,
        max_restarts: int = 3,
        reuse: Optional[bool] = None,
        on_log: Optional[LogSink] = None,
    ) -> None:
        self.model = model
        self.host = host
        self.requested_port = DEFAULT_PORT if port is None else int(port)
        self.ctx = ctx
        self.gpu_layers = gpu_layers
        self.server_binary = server_binary
        self.api_key = api_key
        self.cache = cache
        self.extra_args = list(extra_args)
        self.cwd = cwd
        self.env = env
        self.ready_timeout = ready_timeout
        self.auto_restart = auto_restart
        self.max_restarts = max_restarts
        self.on_log = on_log
        # Port 0 means "give me a private one", so attaching to a shared server
        # would contradict the request.
        self.reuse = (self.requested_port != 0) if reuse is None else reuse

        self._machine_cmd = list(machine_cmd) if isinstance(machine_cmd, (list, tuple)) else (
            _as_command(machine_cmd) if isinstance(machine_cmd, str) else None
        )
        self._process: Optional[subprocess.Popen] = None
        self._base_url: Optional[str] = None
        self._attached = False
        self._stopping = False
        self._lock = threading.RLock()
        self._monitor: Optional[threading.Thread] = None
        self._restarts = 0
        self._atexit_registered = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> "MachineServer":
        """Start (or attach to) a server and block until the model is loaded."""
        with self._lock:
            if self.is_running:
                return self

            if self.reuse:
                existing = f"http://{self.host}:{self.requested_port}"
                if MachineClient(existing, api_key=self.api_key, timeout=5.0).is_ready():
                    self._base_url = existing
                    self._attached = True
                    self._log(f"attached to the server already running at {existing}")
                    return self

            self._spawn()
            if not self._atexit_registered:
                atexit.register(self.stop)
                self._atexit_registered = True
            return self

    def stop(self) -> None:
        """Shut the server down. Safe to call twice, and on a server we attached to."""
        with self._lock:
            self._stopping = True
            process = self._process
            self._process = None
            self._base_url = None
            if process is None or self._attached:
                # Never kill a server we did not start: another process owns it.
                self._attached = False
                self._stopping = False
                return

        _terminate_tree(process)
        with self._lock:
            self._stopping = False

    def restart(self) -> "MachineServer":
        self.stop()
        self._restarts = 0
        return self.start()

    def __enter__(self) -> "MachineServer":
        return self.start()

    def __exit__(self, *_exc: Any) -> None:
        self.stop()

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    @property
    def base_url(self) -> str:
        if not self._base_url:
            raise ServerStartError("The server is not running. Call start() first.")
        return self._base_url

    @property
    def is_running(self) -> bool:
        if self._base_url is None:
            return False
        if self._attached:
            return True
        return self._process is not None and self._process.poll() is None

    @property
    def pid(self) -> Optional[int]:
        return self._process.pid if self._process else None

    @property
    def restarts(self) -> int:
        """How many times the server had to be brought back. Non-zero is a signal."""
        return self._restarts

    def client(self, **kwargs: Any) -> MachineClient:
        """A `MachineClient` pointed at this server."""
        kwargs.setdefault("api_key", self.api_key)
        return MachineClient(self.base_url, **kwargs)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _log(self, line: str) -> None:
        if self.on_log:
            self.on_log(line)

    def _build_argv(self) -> List[str]:
        command = self._machine_cmd or find_machine_cli(self.cwd)
        if not command:
            raise ServerStartError(
                "Could not find the `machine` CLI.\n"
                "  npm install machineai-activation   (then it is in node_modules/.bin)\n"
                "or set MACHINE_CLI to its path, or pass machine_cmd=...",
            )

        argv = [*command, "serve", self.model, "--supervised", "--host", self.host]
        argv += ["--port", str(self.requested_port)]
        if self.ctx is not None:
            argv += ["--ctx", str(self.ctx)]
        if self.gpu_layers is not None:
            argv += ["--gpu-layers", str(self.gpu_layers)]
        if self.server_binary:
            argv += ["--server", self.server_binary]
        if self.api_key:
            argv += ["--api-key", self.api_key]
        if self.cache:
            argv += ["--cache", self.cache]
        argv += self.extra_args
        return argv

    def _spawn(self) -> None:
        argv = self._build_argv()
        self._log(f"starting: {' '.join(argv)}")

        popen_kwargs: Dict[str, Any] = {
            "stdin": subprocess.PIPE,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
            "cwd": self.cwd,
            "env": {**os.environ, **(self.env or {})},
            "text": True,
            "bufsize": 1,
        }
        if os.name == "nt":
            # Its own group, so a Ctrl-C in our console does not race our own
            # orderly shutdown.
            popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            # Its own session, so the whole tree can be signalled at once.
            popen_kwargs["start_new_session"] = True

        try:
            process = subprocess.Popen(argv, **popen_kwargs)
        except OSError as error:
            raise ServerStartError(f"Could not run {argv[0]}: {error}") from error

        self._process = process
        self._stopping = False

        ready: List[Dict[str, Any]] = []
        ready_event = threading.Event()

        def read_stdout() -> None:
            # stdout carries the handshake and nothing else, by contract.
            assert process.stdout is not None
            try:
                for line in process.stdout:
                    line = line.strip()
                    if not line:
                        continue
                    if not ready_event.is_set():
                        try:
                            payload = json.loads(line)
                        except json.JSONDecodeError:
                            self._log(line)
                            continue
                        if isinstance(payload, dict) and "event" in payload:
                            ready.append(payload)
                            ready_event.set()
                            continue
                    self._log(line)
            except (ValueError, OSError):
                pass  # the pipe was closed under us during shutdown

        def read_stderr() -> None:
            assert process.stderr is not None
            try:
                for line in process.stderr:
                    self._log(line.rstrip())
            except (ValueError, OSError):
                pass

        threading.Thread(target=read_stdout, daemon=True).start()
        threading.Thread(target=read_stderr, daemon=True).start()

        deadline = time.monotonic() + self.ready_timeout
        while not ready_event.wait(0.25):
            if process.poll() is not None:
                raise ServerStartError(
                    f"`machine serve` exited with code {process.returncode} before "
                    "becoming ready. Check the log output for the reason."
                )
            if time.monotonic() > deadline:
                _terminate_tree(process)
                raise ServerStartError(
                    f"`machine serve` did not become ready within {self.ready_timeout:.0f}s."
                )

        payload = ready[0]
        if payload.get("event") != "ready":
            _terminate_tree(process)
            raise ServerStartError(
                payload.get("message") or "`machine serve` reported a startup failure."
            )

        self._base_url = payload.get("url") or f"http://{self.host}:{self.requested_port}"
        self._attached = False
        self._log(f"ready at {self._base_url}")

        self._monitor = threading.Thread(target=self._watch, args=(process,), daemon=True)
        self._monitor.start()

    def _watch(self, process: subprocess.Popen) -> None:
        """Notice an unexpected exit and bring the server back."""
        process.wait()
        # A restarted server's predecessor still holds three pipes; a host that
        # runs for days would otherwise leak a set per crash.
        _close_streams(process)
        with self._lock:
            if self._stopping or self._process is not process:
                return  # We asked for this.
            self._process = None
            self._base_url = None
            if not self.auto_restart:
                self._log(f"server exited with code {process.returncode}; not restarting")
                return
            if self._restarts >= self.max_restarts:
                self._log(
                    f"server exited with code {process.returncode}; giving up after "
                    f"{self._restarts} restart(s)"
                )
                return
            self._restarts += 1
            attempt = self._restarts

        # Backoff outside the lock: a model that fails to load fails fast, and
        # restarting in a tight loop would just thrash the disk.
        delay = min(2 ** attempt, 30)
        self._log(
            f"server exited with code {process.returncode}; restarting in {delay}s "
            f"(attempt {attempt}/{self.max_restarts})"
        )
        time.sleep(delay)
        try:
            with self._lock:
                if self._stopping or self._process is not None:
                    return
                self._spawn()
        except ServerStartError as error:
            self._log(f"restart failed: {error}")


def _terminate_tree(process: subprocess.Popen) -> None:
    """Stop the server and the llama-server it spawned.

    Closing stdin first is the polite path: `machine serve --supervised` treats
    it as a shutdown request and takes its own child down cleanly. Only if that
    is ignored do we go after the tree, because killing the parent alone leaves
    `llama-server` holding the weights with nobody to stop it.
    """
    if process.poll() is not None:
        _close_streams(process)
        return

    try:
        if process.stdin:
            process.stdin.close()
    except OSError:
        pass

    try:
        process.wait(timeout=5)
        _close_streams(process)
        return
    except subprocess.TimeoutExpired:
        pass

    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(process.pid)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    else:
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass
        try:
            process.wait(timeout=5)
            return
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass

    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        print(
            f"[machine] warning: server process {process.pid} would not stop.",
            file=sys.stderr,
        )
    _close_streams(process)


def _close_streams(process: subprocess.Popen) -> None:
    """Release the pipes once the process is gone, so long-lived hosts don't leak fds."""
    for stream in (process.stdin, process.stdout, process.stderr):
        try:
            if stream:
                stream.close()
        except (OSError, ValueError):
            pass
