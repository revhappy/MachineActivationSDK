"""Run local GGUF models from Python.

Two pieces, and most apps want both:

    from machine_activation import MachineServer

    with MachineServer("model.gguf") as server:
        m = server.client()
        print(m.activation().summary())
        print(m.chat([{"role": "user", "content": "Say hello in French."}]))

`MachineServer` starts and supervises `machine serve` for you; `MachineClient`
talks to it. Point `MachineClient` at a server someone else started if you would
rather manage the process yourself.

The SDK itself is TypeScript — what crosses the boundary is HTTP, which is why a
Python app can use it at all. See `client.py` for why this exists rather than
"just use the `openai` package".
"""

from __future__ import annotations

import sys
from typing import Sequence

from .client import (
    DEFAULT_BASE_URL,
    ActivationReport,
    MachineClient,
    MachineError,
    ModelNotReady,
    ToolCall,
)
from .server import DEFAULT_PORT, MachineServer, ServerStartError, find_machine_cli

__version__ = "0.2.0b2"

__all__ = [
    "ActivationReport",
    "DEFAULT_BASE_URL",
    "DEFAULT_PORT",
    "MachineClient",
    "MachineError",
    "MachineServer",
    "ModelNotReady",
    "ServerStartError",
    "ToolCall",
    "find_machine_cli",
    "__version__",
]


def _main(argv: Sequence[str]) -> int:
    """`machine-activation-check [model.gguf] [prompt]` — a smoke test you can eyeball.

    With a model path it starts a server, proves the whole path works, and shuts
    it down. Without one it checks a server you already have running.
    """
    args = list(argv)
    model = args.pop(0) if args and _looks_like_model(args[0]) else None

    if model:
        print(f"Starting a server for {model} …")
        try:
            with MachineServer(model, on_log=lambda line: print(f"  {line}")) as server:
                return _probe(server.client(), args)
        except (ServerStartError, KeyboardInterrupt) as error:
            print(f"Could not start a server: {error}")
            return 1

    client = MachineClient()
    if not client.is_ready():
        print(f"machine serve is not reachable at {client.base_url}.")
        print("Start one with: machine-activation-check <model.gguf>")
        print("or, in your own code: MachineServer('<model.gguf>').start()")
        return 1
    return _probe(client, args)


def _looks_like_model(token: str) -> bool:
    return token.endswith(".gguf") or token.endswith(".mcart")


def _probe(client: MachineClient, argv: Sequence[str]) -> int:
    report = client.activation()
    print(report.summary())
    for warning in report.warnings:
        print(f"  ! {warning}")

    prompt = " ".join(argv) or "Reply in one short sentence: what is a local LLM?"
    print(f"\n> {prompt}")
    for delta in client.chat_stream([{"role": "user", "content": prompt}], max_tokens=128):
        print(delta, end="", flush=True)
    print()
    return 0


def _console_main() -> int:
    """Entry point for the `machine-activation-check` console script."""
    return _main(sys.argv[1:])
