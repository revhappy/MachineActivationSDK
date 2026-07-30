"""Compile a JSON Schema into a llama.cpp GBNF grammar, in pure Python.

This is a port of ``src/sdk/jsonSchemaToGbnf.ts``. It exists because the SDK's
headline capability - a small local model that *cannot* emit malformed output -
was otherwise reachable only through a Node process: the schema-to-grammar
compiler lived in TypeScript, so "plug a local model into your Python app"
quietly meant "also ship Node.js". Compiling here closes that gap. The client
sends a ready ``grammar`` string, which every llama.cpp server accepts and
applies in its sampler, so the Python client is a peer of the TS one rather
than a client of a Node server.

Sending a schema and letting the server convert it also works on a current
llama.cpp (measured on b10182: the 19-branch CAD schema converts in ~190 ms of
per-request overhead, against ~60 ms to parse the equivalent precompiled
grammar, which we compile once in ~6 ms). Compiling locally is the better
default anyway - it costs less per request, the result is cacheable, it behaves
the same on servers whose schema support differs or is absent, and it removes
the need to guess which of two ``response_format`` spellings a given server
understands.

Keep this file behaviourally in step with the TypeScript emitter - the two are
expected to produce equivalent grammars for the same schema, and
``tests/test_gbnf.py`` mirrors ``tests/sdk/jsonSchemaToGbnf.test.ts`` case for
case.

Supported subset (anything else degrades to "any valid JSON" for that subtree):
``type`` (including a list of types), ``properties``/``required``,
``items``/``minItems``, ``enum``, ``const``, ``anyOf``/``oneOf``, single-element
``allOf``, and ``nullable``.

Standard library only. Python 3.9+.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

__all__ = ["json_schema_to_gbnf"]

JsonSchema = Dict[str, Any]

# `null` is emitted as `jsonNull`: "null" is used as a literal inside anyValue,
# and a rule of that name reads ambiguously in the generated grammar.
_BASE_RULE_DEFS: Dict[str, str] = {
    "ws": r"[ \t\n\r]*",
    "string": r'"\"" strchar* "\""',
    "strchar": r'[^"\\] | "\\" escape',
    "escape": r'["\\/bfnrt] | "u" hex hex hex hex',
    "hex": r"[0-9a-fA-F]",
    "number": r'"-"? ("0" | [1-9] [0-9]*) ("." [0-9]+)? ([eE] [-+]? [0-9]+)?',
    "integer": r'"-"? ("0" | [1-9] [0-9]*)',
    "boolean": r'"true" | "false"',
    "jsonNull": r'"null"',
    "anyValue": "string | number | boolean | jsonNull | anyArray | anyObject",
    "anyArray": r'"[" ws (anyValue (ws "," ws anyValue)*)? ws "]"',
    "anyObject": (
        r'"{" ws (string ws ":" ws anyValue '
        r'(ws "," ws string ws ":" ws anyValue)*)? ws "}"'
    ),
}

_BASE_RULE_DEPS: Dict[str, List[str]] = {
    "string": ["strchar"],
    "strchar": ["escape"],
    "escape": ["hex"],
    "anyValue": ["string", "number", "boolean", "jsonNull", "anyArray", "anyObject"],
    "anyArray": ["ws", "anyValue"],
    "anyObject": ["ws", "string", "anyValue"],
}

# Base rules are emitted in this order so the grammar reads top-down and two
# runs over the same schema produce byte-identical output.
_BASE_RULE_EMIT_ORDER: List[str] = [
    "ws", "string", "strchar", "escape", "hex", "number", "integer",
    "boolean", "jsonNull", "anyValue", "anyArray", "anyObject",
]

_PRIMITIVE_TO_BASE_RULE: Dict[str, str] = {
    "string": "string",
    "number": "number",
    "integer": "integer",
    "boolean": "boolean",
    "null": "jsonNull",
}


def json_schema_to_gbnf(schema: JsonSchema) -> str:
    """Return a GBNF grammar matching exactly the JSON values ``schema`` allows.

    >>> print(json_schema_to_gbnf({"type": "string"}).splitlines()[0])
    root ::= string
    """
    emitter = _GbnfEmitter()
    root_ref = emitter.resolve_rule(schema)
    return emitter.build(root_ref)


class _GbnfEmitter:
    def __init__(self) -> None:
        self._rules: "Dict[str, str]" = {}   # insertion-ordered, like the TS Map
        self._next_id = 0
        self._used_base: "set[str]" = set()
        self._cache: Dict[str, str] = {}

    # ------------------------------------------------------------------ #
    def resolve_rule(self, schema: JsonSchema) -> str:
        """Name of the rule matching ``schema``, synthesising one if needed."""
        signature = _canonicalize(schema)
        cached = self._cache.get(signature)
        if cached:
            return cached

        # A plain primitive needs no rule of its own - point at the base rule.
        if _is_plain_primitive(schema):
            base_name = _PRIMITIVE_TO_BASE_RULE[schema["type"]]
            self._use_base(base_name)
            self._cache[signature] = base_name
            return base_name

        # Nothing to constrain on: accept any JSON value here.
        if _is_effectively_any(schema):
            self._use_base("anyValue")
            self._cache[signature] = "anyValue"
            return "anyValue"

        name = self._alloc_name(_hint_for(schema))
        # Cache and reserve the name *before* building the body, so a schema
        # that refers back to this shape reuses the rule instead of recursing.
        self._cache[signature] = name
        self._rules[name] = ""
        self._rules[name] = self._build_body(schema)
        return name

    # ------------------------------------------------------------------ #
    def _build_body(self, schema: JsonSchema) -> str:
        if schema.get("const") is not None or "const" in schema:
            return _gbnf_string_literal(json.dumps(schema["const"]))

        enum_values = schema.get("enum")
        if enum_values:
            return " | ".join(
                _gbnf_string_literal(json.dumps(value)) for value in enum_values)

        union = schema.get("anyOf") or schema.get("oneOf")
        if union:
            return " | ".join(self.resolve_rule(sub) for sub in union)

        all_of = schema.get("allOf")
        if all_of and len(all_of) == 1:
            return self.resolve_rule(all_of[0])

        if schema.get("nullable") is True:
            stripped = dict(schema, nullable=False)
            inner = self.resolve_rule(stripped)
            null_ref = self.resolve_rule({"type": "null"})
            return f"{inner} | {null_ref}"

        schema_type = schema.get("type")
        if isinstance(schema_type, list):
            return " | ".join(
                self.resolve_rule(dict(schema, type=t)) for t in schema_type)

        if schema_type == "object":
            return self._emit_object_body(schema)
        if schema_type == "array":
            return self._emit_array_body(schema)
        if schema_type in _PRIMITIVE_TO_BASE_RULE:
            base_name = _PRIMITIVE_TO_BASE_RULE[schema_type]
            self._use_base(base_name)
            return base_name

        self._use_base("anyValue")
        return "anyValue"

    def _emit_object_body(self, schema: JsonSchema) -> str:
        properties = schema.get("properties") or {}
        keys = list(properties.keys())
        self._use_base("ws")

        if not keys:
            if schema.get("additionalProperties") is False:
                return '"{" ws "}"'
            self._use_base("anyObject")
            return "anyObject"

        required = set(schema.get("required") or [])
        # Build right-to-left: each key carries the separator that precedes it,
        # so an optional key can be wrapped together with its own comma and the
        # whole remaining tail - which is what keeps `{"a":1}` legal when only
        # `b` was omitted, and `{}` legal when every key is optional.
        tail = ""
        for index in range(len(keys) - 1, -1, -1):
            key = keys[index]
            rule_name = self.resolve_rule(properties[key])
            key_literal = _gbnf_string_literal(json.dumps(key))
            pair = f'{key_literal} ws ":" ws {rule_name}'
            if index == 0:
                segment = f"{pair} {tail}" if tail else pair
            else:
                segment = (f'ws "," ws {pair} {tail}' if tail
                           else f'ws "," ws {pair}')
            if key not in required:
                segment = f"({segment})?"
            tail = segment
        return f'"{{" ws {tail} ws "}}"'

    def _emit_array_body(self, schema: JsonSchema) -> str:
        self._use_base("ws")
        items = schema.get("items")
        if not items:
            self._use_base("anyValue")
            return '"[" ws (anyValue (ws "," ws anyValue)*)? ws "]"'
        item_rule = self.resolve_rule(items)
        min_items = schema.get("minItems")
        if isinstance(min_items, int) and min_items >= 1:
            return f'"[" ws {item_rule} (ws "," ws {item_rule})* ws "]"'
        return f'"[" ws ({item_rule} (ws "," ws {item_rule})*)? ws "]"'

    # ------------------------------------------------------------------ #
    def _use_base(self, name: str) -> None:
        """Mark a base rule (and everything it needs) for emission."""
        if name in self._used_base:
            return
        self._used_base.add(name)
        for dependency in _BASE_RULE_DEPS.get(name, []):
            self._use_base(dependency)

    def _alloc_name(self, hint: str) -> str:
        name = f"{hint}-{self._next_id}"
        self._next_id += 1
        return name

    def build(self, root_ref: str) -> str:
        lines = [f"root ::= {root_ref}"]
        lines.extend(f"{name} ::= {body}" for name, body in self._rules.items())
        lines.extend(f"{name} ::= {_BASE_RULE_DEFS[name]}"
                     for name in _BASE_RULE_EMIT_ORDER if name in self._used_base)
        return "\n".join(lines)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _is_plain_primitive(schema: JsonSchema) -> bool:
    schema_type = schema.get("type")
    if not isinstance(schema_type, str):
        return False
    if schema_type in ("object", "array"):
        return False
    if schema.get("enum") or "const" in schema:
        return False
    if schema.get("anyOf") or schema.get("oneOf") or schema.get("allOf"):
        return False
    if schema.get("nullable"):
        return False
    return True


def _is_effectively_any(schema: JsonSchema) -> bool:
    return (
        schema.get("type") is None
        and schema.get("enum") is None
        and "const" not in schema
        and not schema.get("anyOf")
        and not schema.get("oneOf")
        and not schema.get("allOf")
        and not schema.get("nullable")
    )


def _hint_for(schema: JsonSchema) -> str:
    """Readable prefix for a synthesised rule name, so grammars stay debuggable."""
    schema_type = schema.get("type")
    if schema_type == "object":
        return "obj"
    if schema_type == "array":
        return "arr"
    if schema.get("enum"):
        return "enumv"
    if "const" in schema:
        return "constv"
    if schema.get("anyOf") or schema.get("oneOf"):
        return "union"
    if schema.get("allOf"):
        return "allof"
    return "rule"


def _gbnf_string_literal(literal: str) -> str:
    """Wrap a JSON literal as a GBNF terminal, escaping what GBNF reserves."""
    escaped = literal.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _canonicalize(value: Any) -> str:
    """Order-independent signature of a schema, used to dedupe identical rules."""
    if value is None or not isinstance(value, (dict, list)):
        return json.dumps(value)
    if isinstance(value, list):
        return "[" + ",".join(_canonicalize(item) for item in value) + "]"
    return "{" + ",".join(
        f"{json.dumps(key)}:{_canonicalize(value[key])}"
        for key in sorted(value)) + "}"
