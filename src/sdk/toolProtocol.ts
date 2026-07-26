// The tool-calling wire protocol, independent of who is driving the loop.
//
// Two consumers need exactly the same envelope, grammar and parser:
//
//   * `generateText({ tools })` — runs the loop in-process and executes tools
//     itself.
//   * `machine serve` — cannot execute anything (the tools live in the caller's
//     process, in a language we do not run), so it returns the parsed call as
//     OpenAI `tool_calls` and lets the client execute and come back.
//
// Those are different control flows over an identical contract. Keeping the
// protocol here means a non-JS caller gets the *same* grammar-constrained
// reliability as a TypeScript one — which is the whole point, since a 2–4B local
// model that is asked to produce a tool call unconstrained is exactly where
// agentic behavior falls apart.

import { jsonSchemaToGbnf } from './jsonSchemaToGbnf';
import type { JsonSchema } from './jsonSchema';

/**
 * A tool, reduced to what the protocol needs.
 *
 * Deliberately not `ToolDefinition`: that carries an `execute` function, which
 * a tool arriving over HTTP does not have and never will.
 */
export interface ToolDescriptor {
  name: string;
  description?: string;
  /** JSON Schema for `args`, or null when the tool cannot describe itself. */
  jsonSchema: JsonSchema | null;
}

/** Fallback `args` shape for a tool whose schema can't describe itself: any
 *  JSON object. Still far stronger than dropping the grammar — the model can
 *  only emit an object there, and the envelope around it stays locked. */
export const ANY_TOOL_ARGS: JsonSchema = { type: 'object' };

export function buildToolSystemPrompt(
  tools: ToolDescriptor[],
  existingSystem?: string,
  forcedToolName?: string,
): string {
  const toolList = tools
    .map((tool) => `- ${tool.name}: ${tool.description ?? ''}`)
    .join('\n');

  return [
    existingSystem?.trim(),
    'You have access to the following tools:',
    toolList,
    '',
    'When you need to call a tool, respond with exactly:',
    '{"tool":"<tool_name>","args":{...}}',
    '',
    'When you are done and have a final answer, respond with exactly:',
    '{"answer":"<your final answer>"}',
    '',
    'Respond only with JSON in one of these two shapes.',
    forcedToolName ? `Start by calling the ${forcedToolName} tool.` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Build the GBNF for the tool-loop envelope:
 * `{"answer": string} | {"tool": "<name>", "args": {...}}`.
 *
 * A tool whose schema can't describe itself degrades to `ANY_TOOL_ARGS` for
 * *that tool's args only*. It used to sink the whole grammar — one unschema'd
 * tool and the entire loop, envelope included, ran unconstrained. On 2–4B local
 * models an unconstrained ReAct loop is exactly where reliability collapses, so
 * the envelope is the last thing to give up.
 *
 * `forcedToolName` narrows the union to that single tool (no `answer` branch),
 * which is how `toolChoice` / `tool_choice` is enforced.
 */
export function buildToolLoopGrammar(
  tools: ToolDescriptor[],
  forcedToolName?: string,
): string | undefined {
  const branches: JsonSchema[] = [];

  if (!forcedToolName) {
    branches.push({
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
    });
  }

  for (const tool of tools) {
    if (forcedToolName && tool.name !== forcedToolName) continue;
    branches.push({
      type: 'object',
      properties: {
        tool: { const: tool.name },
        args: tool.jsonSchema ?? ANY_TOOL_ARGS,
      },
      required: ['tool', 'args'],
    });
  }

  if (branches.length === 0) return undefined;
  return jsonSchemaToGbnf(branches.length === 1 ? branches[0] : { anyOf: branches });
}

export type ToolEnvelope =
  | { kind: 'tool'; name: string; args: Record<string, unknown> }
  | { kind: 'answer'; answer: string }
  | { kind: 'text'; text: string };

/**
 * Interpret a model turn as a tool-loop envelope.
 *
 * Falls back to `text` rather than failing: a model that ignored the envelope
 * has still said something, and treating that as an error would turn a
 * mediocre response into a broken request.
 */
export function parseToolEnvelope(text: string, knownTools: string[]): ToolEnvelope {
  const parsed = tryParseToolJson(text);
  if (!parsed) return { kind: 'text', text };

  if (typeof parsed.answer === 'string') {
    return { kind: 'answer', answer: parsed.answer };
  }

  if (typeof parsed.tool === 'string' && knownTools.includes(parsed.tool)) {
    const args =
      parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args)
        ? (parsed.args as Record<string, unknown>)
        : {};
    return { kind: 'tool', name: parsed.tool, args };
  }

  return { kind: 'text', text };
}

// ---------------------------------------------------------------------------
// Incremental parsing, for drivers that stream
// ---------------------------------------------------------------------------

/**
 * Reads the envelope as it arrives and reports the part a user may see now.
 *
 * A tool loop generates a grammar-constrained JSON envelope, which is why
 * streaming an agentic loop looked impossible: forwarding raw deltas would
 * render `{"answer":"Par` into someone's chat window. But the envelope is a
 * locked union, so the *first key* settles which branch this turn took long
 * before the turn ends — and on the `answer` branch every byte after the
 * opening quote is answer text that only needs unescaping.
 *
 * So this decodes exactly one thing: the `answer` string of a well-formed
 * envelope, character by character. Everything else — a tool call, a truncated
 * turn, a model that ignored the grammar — buffers silently and is settled at
 * the end by `tryParseToolJson`, the same way `generateText` settles it.
 *
 * That asymmetry is deliberate rather than lazy. Text shown to a user cannot be
 * withdrawn, so the streaming path may only emit what it is *certain* about;
 * anything ambiguous has to wait for the whole turn, where the non-streaming
 * parser is authoritative and the two drivers cannot drift apart.
 */
export interface EnvelopeStreamParser {
  /** Feed the next delta. Returns text that is safe to show immediately. */
  push(delta: string): string;
  /**
   * The decoded `answer` so far, once this turn has committed to that branch.
   * `undefined` while undecided or on any other branch.
   *
   * A turn that commits and is then cut off by `maxTokens` leaves valid partial
   * text here but unparseable JSON in `raw` — the caller should prefer this,
   * since it is what the consumer already saw.
   */
  readonly committedAnswer: string | undefined;
  /** Everything fed in, verbatim. */
  readonly raw: string;
}

type EnvelopePhase = 'start' | 'key' | 'answer' | 'buffer' | 'done';

/** How much to inspect before giving up on recognising the envelope. */
const PROBE_LIMIT = 64;

export function createEnvelopeStreamParser(): EnvelopeStreamParser {
  let phase: EnvelopePhase = 'start';
  let probe = '';
  let answer = '';
  let committed = false;
  let raw = '';
  // A `\uXXXX` escape can straddle a chunk boundary, so a partial one is held
  // here rather than decoded early.
  let escape: string | null = null;

  /** Consume `input` in the `answer` phase, returning newly decoded text. */
  function decodeAnswer(input: string): string {
    let out = '';
    for (let index = 0; index < input.length; index += 1) {
      const char = input[index];

      if (escape !== null) {
        escape += char;
        const decoded = decodeEscape(escape);
        if (decoded === INCOMPLETE_ESCAPE) continue;
        escape = null;
        // An escape we cannot decode is passed through verbatim: a malformed
        // sequence is not worth dropping the surrounding sentence over.
        out += decoded;
        continue;
      }

      if (char === '\\') {
        escape = '\\';
        continue;
      }
      if (char === '"') {
        phase = 'done';
        break;
      }
      out += char;
    }
    answer += out;
    return out;
  }

  function advance(input: string): string {
    if (phase === 'done' || phase === 'buffer') return '';
    if (phase === 'answer') return decodeAnswer(input);

    probe += input;

    if (phase === 'start') {
      const leading = probe.replace(/^\s+/, '');
      if (leading === '') return '';

      if (leading.startsWith('`')) {
        // A fenced envelope still holds a valid one. Strip the fence line if we
        // can see all of it; wait if it might still be arriving.
        const fence = leading.match(/^```[a-zA-Z]*\r?\n/);
        if (!fence) {
          if (leading.length < 16) return '';
          phase = 'buffer';
          return '';
        }
        probe = leading.slice(fence[0].length);
        return advance('');
      }

      if (leading[0] !== '{') {
        phase = 'buffer';
        return '';
      }
      phase = 'key';
      probe = leading;
    }

    // phase === 'key': wait for the first key, which decides the branch.
    const opening = probe.match(/^\{\s*"answer"\s*:\s*"/);
    if (opening) {
      phase = 'answer';
      committed = true;
      const rest = probe.slice(opening[0].length);
      probe = '';
      return decodeAnswer(rest);
    }

    // `tool`, or something unrecognised — nothing a user should see mid-flight.
    // A key of `answer` is *not* decisive here: the probe reaches `{"answer":`
    // one character before the value's opening quote, and bailing out there
    // would withhold every answer that arrived a byte at a time.
    const firstKey = probe.match(/^\{\s*"([^"]*)"\s*:/);
    if ((firstKey && firstKey[1] !== 'answer') || probe.length > PROBE_LIMIT) {
      phase = 'buffer';
    }
    return '';
  }

  return {
    push(delta: string): string {
      raw += delta;
      return advance(delta);
    },
    get committedAnswer(): string | undefined {
      return committed ? answer : undefined;
    },
    get raw(): string {
      return raw;
    },
  };
}

const INCOMPLETE_ESCAPE = Symbol('incomplete escape');

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

/**
 * Decode one JSON escape sequence, or report that more characters are needed.
 *
 * Surrogate pairs need no special handling: `😀` decodes as two
 * separate code units that concatenate back into the original character.
 */
function decodeEscape(sequence: string): string | typeof INCOMPLETE_ESCAPE {
  const body = sequence.slice(1);
  if (body === '') return INCOMPLETE_ESCAPE;

  if (body[0] === 'u') {
    if (body.length < 5) return INCOMPLETE_ESCAPE;
    const hex = body.slice(1, 5);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) return sequence;
    return String.fromCharCode(parseInt(hex, 16));
  }

  return SIMPLE_ESCAPES[body[0]] ?? sequence;
}

export function tryParseToolJson(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const direct = safeJsonParse(trimmed);
  if (direct) return direct;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = safeJsonParse(fenced[1].trim());
    if (parsed) return parsed;
  }

  const bracketed = trimmed.match(/\{[\s\S]*\}/);
  if (bracketed) {
    const parsed = safeJsonParse(bracketed[0]);
    if (parsed) return parsed;
  }

  return null;
}

function safeJsonParse(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
