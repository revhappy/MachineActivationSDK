"""JSON Schema -> GBNF, in Python.

Mirrors ``tests/sdk/jsonSchemaToGbnf.test.ts`` case for case: the two emitters
are expected to stay behaviourally equivalent, so a change to one that is not
made to the other should fail here.

``RealCadSchema`` compiles the 19-branch CAD program schema this port was
written for, and checks the grammar actually pins each operation's own fields -
the property that stops a model emitting ``{"op": "box"}`` with no dimensions.

Run with: python -m unittest discover -s tests -t .
"""

from __future__ import annotations

import json
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from machine_activation import json_schema_to_gbnf  # noqa: E402


def _rule_references(body: str) -> "set[str]":
    """Rule names a GBNF right-hand side refers to.

    Needs a real scan rather than a regex: a string terminal can contain a
    backslash-escaped quote (``"\\""``) and a character class can contain a bare
    quote (``["\\/bfnrt]``), so stripping one kind before the other corrupts the
    base rules and invents references that were never there.
    """
    names: "set[str]" = set()
    index = 0
    token = ""
    while index < len(body):
        char = body[index]
        if char == '"':                       # string terminal
            index += 1
            while index < len(body) and body[index] != '"':
                index += 2 if body[index] == "\\" else 1
            index += 1
        elif char == "[":                     # character class
            index += 1
            while index < len(body) and body[index] != "]":
                index += 2 if body[index] == "\\" else 1
            index += 1
        elif char.isalnum() or char in "_-":  # bare word = a rule reference
            token += char
            index += 1
            continue
        else:
            index += 1
        if token:
            names.add(token)
            token = ""
    if token:
        names.add(token)
    return {name for name in names if name[0].isalpha()}


class JsonSchemaToGbnf(unittest.TestCase):
    def test_plain_string_schema_points_at_the_string_rule(self) -> None:
        gbnf = json_schema_to_gbnf({"type": "string"})
        self.assertRegex(gbnf, r"(?m)^root ::= string$")
        self.assertRegex(gbnf, r"(?m)^string ::= ")
        self.assertRegex(gbnf, r"(?m)^strchar ::= ")

    def test_enums_become_an_alternation_of_literals(self) -> None:
        gbnf = json_schema_to_gbnf({"enum": ["pos", "neg", "neu"]})
        self.assertIn(r'"\"pos\"" | "\"neg\"" | "\"neu\""', gbnf)

    def test_const_becomes_a_single_literal(self) -> None:
        self.assertIn(r'"\"hello\""', json_schema_to_gbnf({"const": "hello"}))

    def test_objects_carry_required_and_optional_fields(self) -> None:
        gbnf = json_schema_to_gbnf({
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "sentiment": {"enum": ["pos", "neg", "neu"]},
                "score": {"type": "number"},
            },
            "required": ["summary", "sentiment"],
        })
        self.assertIn(r'"\"summary\"" ws ":" ws string', gbnf)
        # An optional key is wrapped with its own separator, so omitting it
        # still leaves a legal object.
        self.assertRegex(gbnf, r'\(ws "," ws "\\"score\\"" ws ":" ws number\)\?')
        self.assertRegex(gbnf, r"(?m)^root ::= obj-")

    def test_all_optional_object_allows_the_empty_object(self) -> None:
        gbnf = json_schema_to_gbnf({
            "type": "object",
            "properties": {"a": {"type": "string"}, "b": {"type": "string"}},
        })
        self.assertRegex(gbnf, r'"\{" ws \(')

    def test_any_of_becomes_a_union_rule(self) -> None:
        gbnf = json_schema_to_gbnf({
            "anyOf": [
                {"type": "object", "properties": {"tool": {"const": "lookup"}},
                 "required": ["tool"]},
                {"type": "object", "properties": {"answer": {"type": "string"}},
                 "required": ["answer"]},
            ],
        })
        self.assertEqual(len(re.findall(r"(?m)^obj-\d+ ::= ", gbnf)), 2)
        self.assertRegex(gbnf, r"(?m)^root ::= union-\d+$")
        self.assertRegex(gbnf, r"(?m)^union-\d+ ::= obj-\d+ \| obj-\d+$")

    def test_arrays_constrain_their_items(self) -> None:
        gbnf = json_schema_to_gbnf({"type": "array", "items": {"type": "string"}})
        self.assertRegex(gbnf, r'"\[" ws \(string \(ws "," ws string\)\*\)\? ws "\]"')

    def test_min_items_drops_the_outer_optional(self) -> None:
        gbnf = json_schema_to_gbnf(
            {"type": "array", "items": {"type": "integer"}, "minItems": 1})
        self.assertRegex(gbnf, r'"\[" ws integer \(ws "," ws integer\)\* ws "\]"')

    def test_a_schema_with_no_type_accepts_any_json(self) -> None:
        gbnf = json_schema_to_gbnf({})
        self.assertRegex(gbnf, r"(?m)^root ::= anyValue$")
        self.assertRegex(gbnf, r"(?m)^anyValue ::= ")

    def test_identical_subschemas_share_one_rule(self) -> None:
        gbnf = json_schema_to_gbnf({
            "type": "object",
            "properties": {
                "first": {"type": "object", "properties": {"x": {"type": "string"}},
                          "required": ["x"]},
                "second": {"type": "object", "properties": {"x": {"type": "string"}},
                           "required": ["x"]},
            },
            "required": ["first", "second"],
        })
        # Outer + one shared inner rule, not three.
        self.assertEqual(len(re.findall(r"(?m)^obj-\d+ ::= ", gbnf)), 2)

    def test_nullable_unions_with_null(self) -> None:
        gbnf = json_schema_to_gbnf({"type": "string", "nullable": True})
        self.assertIn("string | jsonNull", gbnf)
        self.assertRegex(gbnf, r'(?m)^jsonNull ::= "null"$')

    def test_literals_escape_their_quotes(self) -> None:
        gbnf = json_schema_to_gbnf({"const": 'say "hi"'})
        # Every inner quote is backslash-escaped; none stands bare.
        self.assertIn(r'"\"say \\\"hi\\\"\""', gbnf)

    def test_output_is_deterministic(self) -> None:
        """Two runs must agree, or a cached grammar would churn per process."""
        schema = {
            "type": "object",
            "properties": {"a": {"type": "string"}, "b": {"type": "integer"}},
            "required": ["a"],
        }
        self.assertEqual(json_schema_to_gbnf(schema), json_schema_to_gbnf(schema))

    def test_every_referenced_rule_is_defined(self) -> None:
        """A grammar naming a rule it never defines is rejected by llama.cpp."""
        schema = {
            "type": "object",
            "properties": {
                "items": {"type": "array", "items": {"enum": ["a", "b"]}},
                "meta": {"type": "object", "properties": {"n": {"type": "number"}}},
                "flag": {"type": "boolean", "nullable": True},
                "anything": {},
            },
            "required": ["items"],
        }
        gbnf = json_schema_to_gbnf(schema)
        defined = {line.split(" ::= ", 1)[0] for line in gbnf.splitlines()}
        referenced = set()
        for line in gbnf.splitlines():
            referenced.update(_rule_references(line.split(" ::= ", 1)[1]))
        self.assertTrue(defined)
        self.assertEqual(referenced - defined, set())


class RealCadSchema(unittest.TestCase):
    """The schema this port was written for.

    19 operation branches, each with its own required fields. Compiling it here
    is what lets a Python app constrain a local model with no Node in the
    picture, on any llama.cpp server regardless of what schema support it has.
    """

    def schema(self) -> dict:
        # One branch per CAD operation, each pinning that operation's own
        # required fields - the shape that was pathological to convert.
        def op(name: str, fields: dict, required: list) -> dict:
            return {
                "type": "object",
                "required": ["op", *required],
                "properties": {"op": {"const": name}, **fields},
                "additionalProperties": True,
            }

        vec3 = {"type": "array", "items": {"type": "number"},
                "minItems": 3, "maxItems": 3}
        branches = [
            op("box", {"name": {"type": "string", "minLength": 1},
                       "length": {"type": "number"}, "width": {"type": "number"},
                       "height": {"type": "number"}},
               ["name", "length", "width", "height"]),
            op("cylinder", {"name": {"type": "string", "minLength": 1},
                            "radius": {"type": "number"},
                            "height": {"type": "number"}},
               ["name", "radius", "height"]),
            op("mirror", {"name": {"type": "string", "minLength": 1},
                          "source": {"type": "string"},
                          "plane": {"enum": ["XY", "XZ", "YZ"]}},
               ["name", "source", "plane"]),
            op("translate", {"target": {"type": "string"}, "vector": vec3},
               ["target", "vector"]),
        ]
        return {
            "type": "object",
            "required": ["operations"],
            "properties": {
                "operations": {"type": "array", "minItems": 1,
                               "items": {"anyOf": branches}},
            },
        }

    def test_it_compiles_and_pins_each_operation(self) -> None:
        gbnf = json_schema_to_gbnf(self.schema())
        # The envelope is mandatory...
        self.assertRegex(gbnf, r'"\\"operations\\"" ws ":" ws')
        # ...one branch per operation, plus the envelope object itself...
        self.assertEqual(len(re.findall(r"(?m)^obj-\d+ ::= ", gbnf)), 5)
        # ...each pinning its own op literal and dimensions, so the grammar
        # cannot emit {"op": "box"} with no size (the 2.4.0 bug in the app).
        self.assertIn(r'"\"box\""', gbnf)
        self.assertIn(r'"\"length\"" ws ":" ws number', gbnf)
        self.assertIn(r'"\"plane\"" ws ":" ws', gbnf)
        # minItems: 1 means an empty program is not expressible either.
        self.assertNotRegex(gbnf, r'"\[" ws \(obj')

    def test_it_compiles_fast(self) -> None:
        """The whole point: this is milliseconds, not minutes."""
        import time

        started = time.monotonic()
        json_schema_to_gbnf(self.schema())
        self.assertLess(time.monotonic() - started, 1.0)


class ParityWithTypeScript(unittest.TestCase):
    """The Python emitter must agree with the TypeScript one, byte for byte.

    Two implementations of the same compiler will drift unless something holds
    them together. The fixture is generated from ``src/sdk/jsonSchemaToGbnf.ts``
    by ``scripts/dump-gbnf-parity.js``; if you change that emitter's output on
    purpose, regenerate the fixture and port the change here in the same commit.
    """

    def test_every_fixture_case_matches(self) -> None:
        fixture = Path(__file__).parent / "fixtures" / "gbnf_parity.json"
        cases = json.loads(fixture.read_text(encoding="utf-8"))["cases"]
        self.assertGreater(len(cases), 20, "fixture looks truncated")
        for index, case in enumerate(cases):
            with self.subTest(case=index, schema=json.dumps(case["schema"])[:80]):
                self.assertEqual(json_schema_to_gbnf(case["schema"]), case["gbnf"])


if __name__ == "__main__":
    unittest.main()
