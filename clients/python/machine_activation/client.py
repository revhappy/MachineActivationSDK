"""Python client for `machine serve` — plug a local model into a Python app.

The SDK itself is TypeScript. This is the other half of the story: a dependency
-free client for the HTTP surface `machine serve` exposes, so an app whose AI
layer is Python (or Go, or Ruby — the wire format is the contract) gets local
models without a rewrite.

    from machine_activation import MachineClient

    m = MachineClient()      # a server someone else started
    print(m.chat([{"role": "user", "content": "Say hello in French."}]))

Use `MachineServer` (see server.py) when your app should own the server process
rather than expect a human to have started one.

Why this exists rather than "just use the `openai` package":

  * You *can* use `openai` — point `base_url` at the server and it works. This
    client is here so a local-first app needs no cloud SDK on its dependency
    list at all, and because `openai` has no vocabulary for the things that
    actually matter locally: whether the model fits, how long it took to load,
    what acceleration is live, what is degraded. Those come from
    `activation()`, which is not an OpenAI-shaped endpoint.
  * Structured output is grammar-constrained, not prompt-coaxed. `chat_json()`
    compiles your JSON Schema to a GBNF grammar server-side, and llama.cpp
    enforces it in the sampler — the model is unable to emit invalid JSON. That
    is a materially stronger guarantee than "please reply with JSON", which is
    what small local models routinely fail at.

Standard library only: urllib + json. Python 3.9+.
"""

from __future__ import annotations

import base64
import json
import mimetypes
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Iterable, Iterator, List, Optional, Sequence, Union

__all__ = [
    "MachineClient",
    "MachineError",
    "ModelNotReady",
    "ActivationReport",
    "ToolCall",
]

DEFAULT_BASE_URL = "http://127.0.0.1:8177"

Message = Dict[str, Any]


class MachineError(RuntimeError):
    """The server returned an error, or could not be reached."""


class ModelNotReady(MachineError):
    """`machine serve` is not running, or has not finished loading the model."""


@dataclass
class ToolCall:
    """A tool the model wants run, with arguments already parsed."""

    id: str
    name: str
    args: Dict[str, Any]


@dataclass
class ActivationReport:
    """What the activation contract says about running this model here.

    None of this exists in a cloud API, which is the point: a cloud model has no
    load time, always fits, and never runs degraded.
    """

    model_id: str
    context_window_tokens: Optional[int]
    backend_id: str
    acceleration: str
    compatible: bool
    degraded: bool
    warnings: List[str]
    reasons: List[str]
    raw: Dict[str, Any]

    @property
    def usable(self) -> bool:
        """True when the model can run, even if some capability is degraded.

        Degraded is not a failure. A model that fits but has no GPU, or whose
        memory headroom is unknown, still runs — treating advisories as gates is
        what made an earlier version of this stack feel hostile to use.
        """
        return self.compatible

    def summary(self) -> str:
        state = "ready" if self.compatible and not self.degraded else (
            "degraded" if self.compatible else "incompatible"
        )
        return (
            f"{self.model_id} — {state} on {self.backend_id} "
            f"({self.acceleration}, ctx {self.context_window_tokens or 'unknown'})"
        )


class MachineClient:
    """A local model, reachable over HTTP.

    Args:
        base_url: where `machine serve` is listening.
        api_key: required only if the server was started with ``--api-key``.
        timeout: per-request timeout in seconds. Generous by default — a CPU-only
            model on a laptop can take a while to answer, and a timeout that
            fires mid-generation looks like a broken model rather than a slow one.
    """

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        api_key: Optional[str] = None,
        timeout: float = 600.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        # Never consult the system proxy. `urllib` would otherwise route
        # http://127.0.0.1 through $http_proxy, and on a corporate laptop that
        # is both broken and wrong: the proxy has no route back to your own
        # machine, and anything that *did* get through would send prompts
        # somewhere you did not choose. `no_proxy` usually saves you, but it is
        # a setting people forget, and a local-first client should not depend on
        # remembering it. Local traffic stays local.
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    def health(self) -> Dict[str, Any]:
        """Liveness plus which model is loaded. Raises ModelNotReady if down."""
        return self._get("/health")

    def is_ready(self) -> bool:
        """True when the server is up and has a model loaded. Never raises."""
        try:
            return self.health().get("status") == "ok"
        except MachineError:
            return False

    def models(self) -> List[str]:
        payload = self._get("/v1/models")
        return [entry["id"] for entry in payload.get("data", [])]

    def activation(self) -> ActivationReport:
        """Fetch the activation contract: fit, acceleration, what's degraded.

        Call this at startup and show it to the user. A local-model app that
        cannot explain why it is slow, or why a feature is unavailable on this
        machine, pushes that confusion onto the person using it.
        """
        payload = self._get("/machine/activation")
        contract = payload.get("contract", {})
        capabilities = contract.get("resolvedCapabilities", {})
        return ActivationReport(
            model_id=payload.get("model", {}).get("id", "unknown"),
            context_window_tokens=payload.get("model", {}).get("contextWindowTokens"),
            backend_id=payload.get("backend", {}).get("backendId", "unknown"),
            acceleration=capabilities.get("accelerationMode", "unknown"),
            compatible=bool(contract.get("compatible")),
            degraded=bool(contract.get("degraded")),
            warnings=list(contract.get("warnings", [])),
            reasons=list(contract.get("reasons", [])),
            raw=payload,
        )

    # ------------------------------------------------------------------
    # Generation
    # ------------------------------------------------------------------

    def chat(
        self,
        messages: Sequence[Message],
        *,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
        stop: Optional[Sequence[str]] = None,
        grammar: Optional[str] = None,
    ) -> str:
        """Run a chat turn and return the assistant's text."""
        payload = self._post(
            "/v1/chat/completions",
            self._chat_body(
                messages,
                stream=False,
                max_tokens=max_tokens,
                temperature=temperature,
                stop=stop,
                grammar=grammar,
            ),
        )
        choices = payload.get("choices") or []
        if not choices:
            return ""
        return choices[0].get("message", {}).get("content", "") or ""

    def chat_stream(
        self,
        messages: Sequence[Message],
        *,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
        stop: Optional[Sequence[str]] = None,
        grammar: Optional[str] = None,
    ) -> Iterator[str]:
        """Yield text deltas as they are generated.

        On a CPU-only machine a model may decode at a handful of tokens per
        second, so streaming is not a nicety — it is the difference between an
        app that feels alive and one that appears hung.
        """
        body = self._chat_body(
            messages,
            stream=True,
            max_tokens=max_tokens,
            temperature=temperature,
            stop=stop,
            grammar=grammar,
        )
        request = self._request("/v1/chat/completions", body)
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                for raw_line in response:
                    line = raw_line.decode("utf-8").strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        return
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if "error" in chunk:
                        raise MachineError(chunk["error"].get("message", "stream failed"))
                    for choice in chunk.get("choices", []):
                        delta = choice.get("delta", {}).get("content")
                        if delta:
                            yield delta
        except urllib.error.URLError as error:
            raise self._connection_error(error) from error

    def chat_json(
        self,
        messages: Sequence[Message],
        schema: Dict[str, Any],
        *,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> Any:
        """Run a chat turn constrained to `schema` and return parsed JSON.

        The schema is compiled to a GBNF grammar and enforced by llama.cpp's
        sampler, so the model cannot emit text that violates it. This replaces
        the usual local-model dance of asking for JSON, getting prose, and
        writing a tolerant parser.
        """
        payload = self._post(
            "/v1/chat/completions",
            {
                **self._chat_body(
                    messages,
                    stream=False,
                    max_tokens=max_tokens,
                    temperature=temperature,
                ),
                "response_format": {"type": "json_schema", "json_schema": {"schema": schema}},
            },
        )
        choices = payload.get("choices") or []
        text = choices[0].get("message", {}).get("content", "") if choices else ""
        if not text:
            raise MachineError("The model returned no content for a JSON-constrained request.")
        try:
            return json.loads(text)
        except json.JSONDecodeError as error:
            # Should be unreachable while a grammar is enforced; if it happens,
            # the caller needs the raw text to understand why.
            raise MachineError(f"Constrained output was not valid JSON: {text[:300]}") from error

    def chat_tools(
        self,
        messages: Sequence[Message],
        tools: Sequence[Dict[str, Any]],
        *,
        tool_choice: Optional[Any] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> Union["ToolCall", str]:
        """Run one agent step: either the model calls a tool, or it answers.

        Returns a `ToolCall` when the model wants a tool run, or a `str` when it
        answered. You execute the tool in your own process and call again with a
        `{"role": "tool", ...}` message appended — the standard OpenAI loop.

        `tools` is OpenAI's shape::

            [{"type": "function", "function": {
                "name": "weather",
                "description": "Look up the weather.",
                "parameters": {"type": "object",
                               "properties": {"city": {"type": "string"}},
                               "required": ["city"]}}}]

        The envelope is grammar-constrained server-side, so the model cannot
        answer with prose where a tool call belongs. That matters far more
        locally than in the cloud: an unconstrained 2-4B model asked to emit a
        tool call is where agent behavior usually falls apart.
        """
        body: Dict[str, Any] = {
            **self._chat_body(messages, stream=False, max_tokens=max_tokens,
                              temperature=temperature),
            "tools": list(tools),
        }
        if tool_choice is not None:
            body["tool_choice"] = tool_choice

        payload = self._post("/v1/chat/completions", body)
        choices = payload.get("choices") or []
        if not choices:
            return ""

        message = choices[0].get("message", {})
        calls = message.get("tool_calls") or []
        if calls:
            call = calls[0]
            function = call.get("function", {})
            raw_args = function.get("arguments") or "{}"
            try:
                # OpenAI sends arguments as a JSON *string*, not an object.
                args = json.loads(raw_args)
            except json.JSONDecodeError:
                args = {}
            return ToolCall(id=call.get("id", ""), name=function.get("name", ""), args=args)

        return message.get("content") or ""

    @staticmethod
    def tool_result_message(call: "ToolCall", result: Any) -> Message:
        """Build the `tool` message that feeds a tool's output back to the model."""
        return {
            "role": "tool",
            "tool_call_id": call.id,
            "content": result if isinstance(result, str) else json.dumps(result),
        }

    @staticmethod
    def assistant_tool_call_message(call: "ToolCall") -> Message:
        """Build the assistant turn that records the call, for the next request.

        The model needs to see its own call alongside the result, or the second
        turn reads as an unexplained tool output.
        """
        return {
            "role": "assistant",
            "content": json.dumps({"tool": call.name, "args": call.args}),
        }

    def complete(self, prompt: str, *, max_tokens: Optional[int] = None) -> str:
        """Legacy prompt completion, for code that has no notion of messages."""
        payload = self._post(
            "/v1/completions",
            {"prompt": prompt, **({"max_tokens": max_tokens} if max_tokens else {})},
        )
        choices = payload.get("choices") or []
        return choices[0].get("text", "") if choices else ""

    # ------------------------------------------------------------------
    # Vision
    # ------------------------------------------------------------------

    @staticmethod
    def image_part(image: Union[str, bytes], mime_type: Optional[str] = None) -> Dict[str, Any]:
        """Build an image content part from a file path or raw bytes.

        Images are inlined as data URIs. The server has to be running a model
        with a projector loaded (`--mmproj`) or image parts are dropped to text —
        check `activation().raw["contract"]["resolvedCapabilities"]`
        ``["visionImageInput"]`` before relying on them.
        """
        if isinstance(image, bytes):
            data = image
            mime = mime_type or "image/png"
        else:
            with open(image, "rb") as handle:
                data = handle.read()
            mime = mime_type or mimetypes.guess_type(image)[0] or "image/png"

        encoded = base64.b64encode(data).decode("ascii")
        return {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}}

    def describe_image(
        self,
        image: Union[str, bytes],
        prompt: str = "Describe this image.",
        *,
        mime_type: Optional[str] = None,
        max_tokens: Optional[int] = None,
    ) -> str:
        return self.chat(
            [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        self.image_part(image, mime_type),
                    ],
                }
            ],
            max_tokens=max_tokens,
        )

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _chat_body(
        self,
        messages: Sequence[Message],
        *,
        stream: bool,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
        stop: Optional[Sequence[str]] = None,
        grammar: Optional[str] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"messages": list(messages), "stream": stream}
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        if temperature is not None:
            body["temperature"] = temperature
        if stop:
            body["stop"] = list(stop)
        if grammar:
            body["grammar"] = grammar
        return body

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _request(self, path: str, body: Optional[Dict[str, Any]] = None) -> urllib.request.Request:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        return urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            headers=self._headers(),
            method="POST" if data is not None else "GET",
        )

    def _get(self, path: str) -> Dict[str, Any]:
        return self._send(self._request(path))

    def _post(self, path: str, body: Dict[str, Any]) -> Dict[str, Any]:
        return self._send(self._request(path, body))

    def _send(self, request: urllib.request.Request) -> Dict[str, Any]:
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            try:
                message = json.loads(detail)["error"]["message"]
            except Exception:
                message = detail[:300] or error.reason
            raise MachineError(f"machine serve returned {error.code}: {message}") from error
        except urllib.error.URLError as error:
            raise self._connection_error(error) from error

    def _connection_error(self, error: urllib.error.URLError) -> MachineError:
        return ModelNotReady(
            f"Could not reach machine serve at {self.base_url} ({error.reason}). "
            "Start it with `machine serve <model.gguf>`."
        )


