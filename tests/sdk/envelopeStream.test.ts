import assert from 'node:assert/strict';
import { test } from '../_harness';
import { createEnvelopeStreamParser } from '../../src/sdk/toolProtocol';

/** Feed `text` in fixed-size pieces, the way a token stream arrives. */
function streamThrough(text: string, chunkSize: number): {
  visible: string;
  committed: string | undefined;
} {
  const parser = createEnvelopeStreamParser();
  let visible = '';
  for (let index = 0; index < text.length; index += chunkSize) {
    visible += parser.push(text.slice(index, index + chunkSize));
  }
  return { visible, committed: parser.committedAnswer };
}

test('envelope parser streams the answer branch as plain text', () => {
  const { visible, committed } = streamThrough('{"answer":"Hello there"}', 4);
  assert.equal(visible, 'Hello there');
  assert.equal(committed, 'Hello there');
});

test('envelope parser emits nothing for a tool call', () => {
  const { visible, committed } = streamThrough(
    '{"tool":"weather","args":{"city":"Paris"}}',
    3,
  );
  assert.equal(visible, '');
  assert.equal(committed, undefined);
});

test('envelope parser decodes escapes split across chunk boundaries', () => {
  const answer = 'line1\nline2 "quoted" café \\ done';
  const envelope = JSON.stringify({ answer });

  // Every chunk size from 1 up exercises a different set of boundaries — the
  // interesting ones fall inside a \uXXXX sequence.
  for (let size = 1; size <= 9; size += 1) {
    const { visible, committed } = streamThrough(envelope, size);
    assert.equal(visible, answer, `chunk size ${size}`);
    assert.equal(committed, answer, `chunk size ${size}`);
  }
});

test('envelope parser matches JSON.parse for awkward answers', () => {
  const answers = [
    '',
    'plain',
    'tab\there',
    'emoji \u{1F600} and more',
    'a\\\\b',
    '{"looks":"like json"}',
    'ends with backslash \\\\',
  ];
  for (const answer of answers) {
    const envelope = JSON.stringify({ answer });
    const { visible } = streamThrough(envelope, 2);
    assert.equal(visible, answer, JSON.stringify(answer));
  }
});

test('envelope parser withholds text when the model ignores the envelope', () => {
  // Prose is not something the streaming path may show: under a grammar it
  // cannot happen, and if it does the whole-turn parser is authoritative.
  const { visible, committed } = streamThrough('Sure! Here you go.', 4);
  assert.equal(visible, '');
  assert.equal(committed, undefined);
});

test('envelope parser sees through a leading code fence', () => {
  const { visible } = streamThrough('```json\n{"answer":"fenced"}\n```', 5);
  assert.equal(visible, 'fenced');
});

test('envelope parser keeps a truncated answer', () => {
  // maxTokens can cut the envelope mid-string: the JSON is unparseable but the
  // consumer has already read valid prose, so it has to survive.
  const parser = createEnvelopeStreamParser();
  let visible = '';
  visible += parser.push('{"answer":"partial ans');
  assert.equal(visible, 'partial ans');
  assert.equal(parser.committedAnswer, 'partial ans');
  assert.equal(parser.raw, '{"answer":"partial ans');
});

test('envelope parser ignores an unknown first key', () => {
  const { visible, committed } = streamThrough('{"reply":"nope"}', 4);
  assert.equal(visible, '');
  assert.equal(committed, undefined);
});
