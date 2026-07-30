"""Run a local model from Python with no Node.js in the picture.

`MachineServer` supervises the `machine` CLI, which is a Node program. That is
fine for a JS app and a hard stop for everyone else: a Python desktop app — a
FreeCAD addon, a Blender plugin, a Django worker — would have to make its users
install Node and run `npm install` before they could load a model on their own
machine. "Plug a local model into any app" cannot come with a JavaScript
toolchain attached.

So this module talks to `llama-server` directly:

    from machine_activation import LlamaServer

    with LlamaServer("model.gguf") as server:
        print(server.client().chat([{"role": "user", "content": "hi"}]))

`llama-server` already speaks the endpoints :class:`MachineClient` uses —
`/health`, `/v1/models`, `/v1/chat/completions` including `response_format`, so
grammar-constrained JSON still works. What you give up versus `machine serve` is
`/machine/activation`: the contract report is the CLI's own synthesis, and
:meth:`MachineClient.activation` will fail against a bare llama-server. Use
:func:`serve_local_model` to prefer the CLI when it is present and fall back to
here when it is not.

:func:`fetch_llama_server` gets the binary, so obtaining a backend does not need
Node either. Extraction uses the standard library's `zipfile` rather than
shelling out to PowerShell or `unzip`.

Standard library only, like the rest of this client.
"""

from __future__ import annotations

import json
import os
import platform
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .client import MachineClient, MachineError

__all__ = [
    "LlamaServer",
    "LlamaServerNotFound",
    "fetch_llama_server",
    "find_llama_server",
    "serve_local_model",
    "supported_llama_hosts",
]

_REPO = "ggml-org/llama.cpp"
_USER_AGENT = "machine-activation-python"

# Mirrors the TypeScript side's HOST_TARGETS and the vendor/ layout the Node
# runtime discovers, so a project that fetched with either tool works with both.
_HOST_TARGETS: Dict[str, Dict[str, Any]] = {
    "win32:AMD64": {
        "slug": "win-x64",
        "pattern": r"^llama-b(\d+)-bin-win-cpu-x64\.zip$",
        "exe": "llama-server.exe",
        "acceleration": "cpu",
    },
    "darwin:arm64": {
        "slug": "macos-arm64",
        "pattern": r"^llama-b(\d+)-bin-macos-arm64\.zip$",
        "exe": "llama-server",
        "acceleration": "gpu",
    },
    "darwin:x86_64": {
        "slug": "macos-x64",
        "pattern": r"^llama-b(\d+)-bin-macos-x64\.zip$",
        "exe": "llama-server",
        "acceleration": "gpu",
    },
    "linux:x86_64": {
        "slug": "linux-x64",
        "pattern": r"^llama-b(\d+)-bin-ubuntu-x64\.zip$",
        "exe": "llama-server",
        "acceleration": "cpu",
    },
}

# Windows reports AMD64; normalise the common aliases so a host key resolves.
_ARCH_ALIASES = {"x64": "x86_64", "amd64": "AMD64", "aarch64": "arm64"}


class LlamaServerNotFound(MachineError):
    """No `llama-server` binary could be located."""


def supported_llama_hosts() -> List[str]:
    return sorted(_HOST_TARGETS)


def _host_key() -> str:
    machine = platform.machine()
    if sys.platform == "win32":
        return f"win32:{_ARCH_ALIASES.get(machine.lower(), machine)}"
    return f"{sys.platform}:{_ARCH_ALIASES.get(machine.lower(), machine)}"


def _target() -> Dict[str, Any]:
    key = _host_key()
    target = _HOST_TARGETS.get(key)
    if target is None:
        raise LlamaServerNotFound(
            f"No prebuilt llama-server is published for {key}. "
            f"Supported: {', '.join(supported_llama_hosts())}. Build one yourself "
            "and set MACHINE_LLAMA_SERVER to its path."
        )
    return target


def _exe_name() -> str:
    return "llama-server.exe" if sys.platform == "win32" else "llama-server"


def user_cache_dir() -> Path:
    """Where a llama-server is kept for *this user*, shared by every app.

    A per-project `vendor/` made sense for one Electron app that ships its own
    binary. It is the wrong default for a pip-installed library: an addon inside
    FreeCAD, a Blender plugin and a script in ~/work have no directory in common,
    so each would download its own ~100 MB copy of the same file - and a package
    installed into site-packages has no relationship to the process's cwd at all.
    One per user, next to the cartridge cache, is fetched once and found by all.

    `$MACHINE_HOME` relocates it (useful for a sandbox or a shared image).
    """
    home = os.environ.get("MACHINE_HOME")
    return (Path(home) if home else Path.home() / ".machine") / "llama-cpp"


def find_llama_server(*start_dirs: str) -> Optional[str]:
    """Locate `llama-server`, in the order that respects explicit choices first.

    1. `$MACHINE_LLAMA_SERVER` - an operator said exactly which binary to use.
    2. The per-user cache, which :func:`fetch_llama_server` fills by default.
    3. A project-local `vendor/llama-cpp/<slug>/`, walking up from `start_dirs`.
       This is the layout the TypeScript runtime uses, so a project that vendored
       its own copy keeps working and the two clients agree.
    4. `PATH`, for a system-wide build.
    """
    from_env = os.environ.get("MACHINE_LLAMA_SERVER")
    if from_env and os.path.isfile(from_env):
        return from_env

    exe = _exe_name()
    slugs = [entry["slug"] for entry in _HOST_TARGETS.values()]
    try:
        slugs.insert(0, _target()["slug"])
    except LlamaServerNotFound:
        pass

    for slug in slugs:
        cached = user_cache_dir() / slug / exe
        if cached.is_file():
            return str(cached)

    for start in (start_dirs or (os.getcwd(),)):
        try:
            directory = Path(start).resolve()
        except OSError:
            continue
        for parent in [directory, *directory.parents][:6]:
            for root in ("vendor", "."):
                for slug in slugs:
                    candidate = parent / root / "llama-cpp" / slug / exe
                    if candidate.is_file():
                        return str(candidate)

    return shutil.which(exe)


def fetch_llama_server(
    root_dir: Optional[str] = None,
    *,
    asset: Optional[str] = None,
    force: bool = False,
    on_log: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """Download a `llama-server` prebuilt and return where it landed.

    By default it goes in the per-user cache (see :func:`user_cache_dir`), so it
    is fetched once and every app on the machine finds it. Pass ``root_dir`` to
    vendor into a specific project instead (``<root_dir>/vendor/llama-cpp/``),
    which is what an app shipping its own copy wants.

    Cached and idempotent: re-downloads only when upstream has a newer build, or
    when ``force``. ``asset`` (or ``$LLAMA_CPP_ASSET``) is a regex selecting a
    different archive - that is how you get a CUDA or Vulkan build.
    """
    log = on_log or (lambda _line: None)
    target = _target()
    pattern = re.compile(asset or os.environ.get("LLAMA_CPP_ASSET") or target["pattern"])
    overridden = pattern.pattern != target["pattern"]

    llama_dir = Path(root_dir) / "vendor" / "llama-cpp" if root_dir else user_cache_dir()
    vendor_dir = llama_dir / target["slug"]
    binary = vendor_dir / target["exe"]

    log(f"host {_host_key()} -> {target['slug']}" + (" (asset override)" if overridden else ""))
    release = _get_json(f"https://api.github.com/repos/{_REPO}/releases/latest")
    assets = release.get("assets", [])
    chosen = next((a for a in assets if pattern.search(a.get("name", ""))), None)
    if chosen is None:
        names = "\n  ".join(a.get("name", "?") for a in assets)
        raise MachineError(
            f"No asset matching {pattern.pattern} in release "
            f"{release.get('tag_name')}.\nAvailable:\n  {names}\n"
            "Set LLAMA_CPP_ASSET to a regex matching one of these."
        )

    match = re.search(r"-b(\d+)-", chosen["name"])
    build = f"b{match.group(1)}" if match else str(release.get("tag_name"))

    if not force and binary.is_file() and _cached_build(vendor_dir) == build:
        log(f"up to date ({build}); nothing to download")
        return {"binary": str(binary), "build": build, "cached": True,
                "slug": target["slug"], "acceleration": target["acceleration"],
                "asset": chosen["name"]}

    llama_dir.mkdir(parents=True, exist_ok=True)
    archive = llama_dir / "_download.zip"
    log(f"downloading {chosen['name']} ({chosen.get('size', 0) / 1e6:.1f} MB)")
    _download(chosen["browser_download_url"], archive)

    log("extracting")
    if vendor_dir.exists():
        shutil.rmtree(vendor_dir, ignore_errors=True)
    vendor_dir.mkdir(parents=True, exist_ok=True)
    try:
        # zipfile means no PowerShell, no `unzip`, nothing to install.
        with zipfile.ZipFile(archive) as bundle:
            bundle.extractall(vendor_dir)
    except zipfile.BadZipFile as error:
        raise MachineError(f"Downloaded archive is not a valid zip: {error}") from error
    finally:
        archive.unlink(missing_ok=True)

    _flatten(vendor_dir, target["exe"])
    if not binary.is_file():
        raise MachineError(
            f"Extraction finished but {target['exe']} is not at {binary}. "
            f"Contents: {', '.join(p.name for p in vendor_dir.iterdir()) or '(empty)'}"
        )
    if sys.platform != "win32":
        for path in vendor_dir.iterdir():
            if path.is_file():
                path.chmod(0o755)

    metadata = {"build": build, "tag": release.get("tag_name"), "asset": chosen["name"],
                "platform": target["slug"], "exe": target["exe"],
                "acceleration": target["acceleration"]}
    (vendor_dir / "version.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    log(f"vendored llama.cpp {build} -> {vendor_dir}")
    return {"binary": str(binary), "build": build, "cached": False,
            "slug": target["slug"], "acceleration": target["acceleration"],
            "asset": chosen["name"]}


def _cached_build(vendor_dir: Path) -> Optional[str]:
    try:
        data = json.loads((vendor_dir / "version.json").read_text(encoding="utf-8"))
        return data.get("build")
    except (OSError, ValueError):
        return None


def _flatten(directory: Path, exe: str) -> None:
    """llama.cpp archives sometimes nest everything under `build/bin/`."""
    if (directory / exe).is_file():
        return
    for candidate in list(directory.rglob(exe)):
        source = candidate.parent
        for item in list(source.iterdir()):
            shutil.move(str(item), str(directory / item.name))
        return


def _get_json(url: str) -> Dict[str, Any]:
    request = urllib.request.Request(
        url, headers={"User-Agent": _USER_AGENT, "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as error:
        raise MachineError(f"Could not reach GitHub to look up a release: {error}") from error


def _download(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=600) as response, \
                open(destination, "wb") as handle:
            shutil.copyfileobj(response, handle)
    except urllib.error.URLError as error:
        raise MachineError(f"Download failed: {error}") from error


class LlamaServer:
    """A supervised `llama-server` process, no Node required.

    Reuses a healthy server already listening on the port rather than loading a
    second copy of a multi-gigabyte model, and takes the process tree down on
    exit even if the caller forgets - the same guarantees `MachineServer` makes.
    """

    def __init__(
        self,
        model: str,
        *,
        host: str = "127.0.0.1",
        port: int = 8177,
        ctx: Optional[int] = None,
        gpu_layers: Optional[int] = None,
        server_binary: Optional[str] = None,
        extra_args: Optional[List[str]] = None,
        ready_timeout: float = 900.0,
        auto_fetch: bool = False,
        on_log: Optional[Callable[[str], None]] = None,
    ) -> None:
        self.model = model
        self.host = host
        self.port = int(port)
        self.ctx = ctx
        self.gpu_layers = gpu_layers
        self.server_binary = server_binary
        self.extra_args = list(extra_args or [])
        self.ready_timeout = ready_timeout
        self.auto_fetch = auto_fetch
        self.on_log = on_log
        self._process: Optional[subprocess.Popen] = None
        self._attached = False

    # ------------------------------------------------------------------ #
    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"

    def client(self, **kwargs: Any) -> MachineClient:
        return MachineClient(base_url=self.base_url, **kwargs)

    def __enter__(self) -> "LlamaServer":
        return self.start()

    def __exit__(self, *_exc: Any) -> None:
        self.stop()

    # ------------------------------------------------------------------ #
    def resolve_binary(self) -> str:
        """The llama-server to run, fetching one if allowed and none is present."""
        if self.server_binary and os.path.isfile(self.server_binary):
            return self.server_binary
        found = find_llama_server(os.path.dirname(os.path.abspath(self.model)), os.getcwd())
        if found:
            return found
        if self.auto_fetch:
            self._log("no llama-server found; fetching one")
            return str(fetch_llama_server(on_log=self._log)["binary"])
        raise LlamaServerNotFound(
            "No llama-server binary found.\n\n"
            "Let this fetch one automatically with auto_fetch=True, call "
            "fetch_llama_server(), or set MACHINE_LLAMA_SERVER to a binary you "
            "already have."
        )

    def start(self) -> "LlamaServer":
        if self._process is not None:
            return self
        if self._healthy():
            # Something already serves this port: attach instead of paying the
            # load cost and the memory a second time.
            self._attached = True
            self._log(f"attached to the server already on {self.base_url}")
            return self
        if not os.path.isfile(self.model):
            raise MachineError(f"Model file not found: {self.model}")

        binary = self.resolve_binary()
        argv = [binary, "-m", self.model, "--host", self.host, "--port", str(self.port)]
        if self.ctx is not None:
            argv += ["--ctx-size", str(self.ctx)]
        if self.gpu_layers is not None:
            argv += ["--n-gpu-layers", str(self.gpu_layers)]
        argv += self.extra_args

        self._log(f"starting {os.path.basename(binary)} on {self.base_url}")
        kwargs: Dict[str, Any] = {
            "stdout": subprocess.PIPE,
            "stderr": subprocess.STDOUT,
            "stdin": subprocess.DEVNULL,
            "text": True,
            "bufsize": 1,
        }
        if sys.platform == "win32":
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            kwargs["start_new_session"] = True
        try:
            self._process = subprocess.Popen(argv, **kwargs)
        except OSError as error:
            raise MachineError(f"Could not run {binary}: {error}") from error

        self._drain_output()
        self._await_ready()
        return self

    def stop(self) -> None:
        if self._attached:
            self._attached = False  # Not ours to stop.
            return
        process = self._process
        self._process = None
        if process is None or process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=10)
            return
        except subprocess.TimeoutExpired:
            pass
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(process.pid)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           check=False)
        else:
            process.kill()

    @property
    def is_running(self) -> bool:
        if self._attached:
            return self._healthy()
        return self._process is not None and self._process.poll() is None

    # ------------------------------------------------------------------ #
    def _await_ready(self) -> None:
        deadline = time.monotonic() + self.ready_timeout
        while time.monotonic() < deadline:
            process = self._process
            if process is not None and process.poll() is not None:
                raise MachineError(
                    f"llama-server exited with code {process.returncode} before "
                    "becoming ready. Its output is above; a wrong or corrupt "
                    ".gguf is the usual cause."
                )
            if self._healthy():
                self._log(f"ready at {self.base_url}")
                return
            time.sleep(0.5)
        self.stop()
        raise MachineError(
            f"llama-server did not become ready within {self.ready_timeout:.0f}s."
        )

    def _healthy(self) -> bool:
        # Never via the system proxy: see client.py for why local stays local.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(f"{self.base_url}/health", timeout=3) as response:
                return json.loads(response.read().decode("utf-8")).get("status") == "ok"
        except Exception:  # noqa: BLE001 - not up yet, still loading, or not ours
            return False

    def _drain_output(self) -> None:
        """Pump the child's output to `on_log` so a full pipe cannot block it."""
        import threading

        process = self._process
        if process is None or process.stdout is None:
            return

        def pump() -> None:
            try:
                for line in process.stdout:  # type: ignore[union-attr]
                    self._log(line.rstrip())
            except (ValueError, OSError):
                pass

        threading.Thread(target=pump, daemon=True).start()

    def _log(self, line: str) -> None:
        if self.on_log:
            self.on_log(line)


def serve_local_model(model: str, **kwargs: Any):
    """Serve ``model``, preferring `machine serve` and falling back to llama-server.

    Use this when you want the activation contract if it is available but must
    still work on a machine with no Node.js. Returns a started
    :class:`MachineServer` or :class:`LlamaServer`; both expose ``base_url``,
    ``client()``, ``stop()`` and the context-manager protocol.
    """
    from .server import MachineServer, find_machine_cli

    if find_machine_cli() is not None:
        supported = {"host", "port", "ctx", "gpu_layers", "server_binary",
                     "ready_timeout", "on_log", "extra_args", "api_key", "cache"}
        return MachineServer(model, **{k: v for k, v in kwargs.items()
                                       if k in supported}).start()
    kwargs.pop("api_key", None)
    kwargs.pop("cache", None)
    return LlamaServer(model, **kwargs).start()
