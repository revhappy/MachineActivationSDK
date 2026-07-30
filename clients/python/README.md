# machine-activation (Python)

Run a local GGUF model from any Python app.

```bash
pip install machine-activation
```

The [Machine Activation SDK](https://github.com/revhappy/MachineActivationSDK) is
TypeScript. This is the other half: a **dependency-free** client for the HTTP
surface `machine serve` exposes, so a Python app gets local models without a
rewrite and without taking on a cloud SDK's dependency tree.

## Your app starts the model

```bash
npm i machineai-activation      # puts `machine` in node_modules/.bin
```

```python
from machine_activation import MachineServer

with MachineServer("./models/your-model.gguf") as server:
    m = server.client()
    print(m.activation().summary())
    # gemma-4-E4B-it-qat.gguf — degraded on llama-server (cpu, ctx 4096)

    for delta in m.chat_stream([{"role": "user", "content": "Say hello in French."}]):
        print(delta, end="", flush=True)
```

`MachineServer` finds the `machine` CLI (`$MACHINE_CLI`, then PATH, then an npm
install above you — where it runs the package's own entry point with `node`
rather than npm's platform shim), starts it, waits for the weights to load, and
shuts the whole process tree down on exit. No second terminal, and nothing for
your user to start. Install paths containing spaces (`Program Files`,
`My Documents`, anything with a space) work — worth stating because before
`0.2.0b3` they did not.

It also **reuses**: point two `MachineServer`s at the same port and the second
attaches to the first instead of loading another copy of a 4 GB model. Pass
`port=0` when you want a private instance, and `auto_restart=False` if you would
rather see a crash than have it quietly recover.

```python
server = MachineServer(
    "model.gguf",
    ctx=8192,
    gpu_layers=999,          # offload everything the build supports
    on_log=print,            # llama.cpp's startup lines, including device detection
).start()
...
server.stop()
```

### Or connect to one someone else started

```bash
machine serve ./models/your-model.gguf
```

```python
from machine_activation import MachineClient

m = MachineClient()          # http://127.0.0.1:8177
```

## Structured output that cannot be malformed

```python
schema = {
    "type": "object",
    "properties": {"app": {"type": "string"}, "is_work": {"type": "boolean"}},
    "required": ["app", "is_work"],
}
data = m.chat_json([{"role": "user", "content": "..."}], schema)
assert isinstance(data["is_work"], bool)
```

Your schema is compiled to a GBNF grammar and enforced inside llama.cpp's
sampler, so the model is *unable* to emit JSON that violates it. This is not the
same thing as asking nicely for JSON — small local models fail that constantly,
and they cannot fail this.

## Tools — the agent loop

```python
tools = [{
    "type": "function",
    "function": {
        "name": "weather",
        "description": "Look up the weather for a city.",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
    },
}]

messages = [{"role": "user", "content": "What's the weather in Paris?"}]

while True:
    step = m.chat_tools(messages, tools)
    if isinstance(step, str):
        print(step)
        break
    result = run_my_tool(step.name, step.args)      # you execute it
    messages.append(m.assistant_tool_call_message(step))
    messages.append(m.tool_result_message(step, result))
```

The tool envelope is grammar-constrained server-side, so the model cannot answer
with prose where a call belongs. That guarantee is the difference between an
agent that works on a 4B local model and one that doesn't.

## Vision

```python
print(m.describe_image("screenshot.png", "What is on this screen?"))
```

Needs a projector: start the server with `--mmproj`. Check first —

```python
if m.activation().raw["contract"]["resolvedCapabilities"]["visionImageInput"]:
    ...
```

— because without one, image parts are dropped to text rather than erroring.

## Check what this machine can actually do

```python
report = m.activation()
report.usable       # can it run at all
report.degraded     # running, but with advisories
report.acceleration # 'cpu' | 'gpu' | 'npu'
report.warnings     # e.g. memory headroom unknown
```

`degraded` is not a failure. Unknown memory, CPU fallback and unverified
capabilities are advisories — only a hard incompatibility makes `usable` false.

There is no `openai` dependency here, but you can use that package instead if you
already depend on it: point `base_url` at `http://127.0.0.1:8177/v1`. You lose
`activation()`, which has no OpenAI equivalent.

## Also

```bash
machine-activation-check ./models/your-model.gguf     # starts a server, proves the path, stops it
machine-activation-check "what is a local LLM?"       # uses a server you already have
```

A smoke test: prints the activation report, then streams an answer.

Requires Python 3.9+. Standard library only — `urllib`, `json`, `subprocess`,
`threading`.

**Your proxy is never used.** `urllib` would otherwise route `http://127.0.0.1`
through `$http_proxy`, which on a corporate laptop breaks local inference and, if
it did connect, would send prompts through a host you never chose. This client
bypasses the system proxy for its own traffic and does not rely on you having set
`no_proxy`.

MIT.
