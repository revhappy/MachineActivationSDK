import type {
  ActivationChatMessage,
  ActivationMessagePart,
} from '../activation/activationAdapter';

export type WireContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

export interface WireMessage {
  role: 'system' | 'user' | 'assistant';
  content: WireContent;
}

function partsToText(parts: ActivationMessagePart[]): string {
  return parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .filter(Boolean)
    .join('\n');
}

function imageUrlOf(part: ActivationMessagePart): string | undefined {
  if (part.type === 'image') return part.url;
  if (part.type === 'image_url') return part.image_url.url;
  return undefined;
}

/**
 * Convert one activation message to the OpenAI wire shape llama-server accepts.
 *
 * Two things happen here that every hand-rolled copy of this adapter got wrong
 * at least once:
 *
 * 1. **The `tool` role is folded into a user turn.** Most local chat templates
 *    have no `tool` role, and `--jinja` will reject or silently mangle it. The
 *    SDK's tool loop appends `tool`-role messages, so without this the agentic
 *    loop breaks on exactly the models it is meant to support.
 * 2. **Image parts survive only when a projector is loaded.** With no `--mmproj`
 *    the server 400s on `image_url` content, so images are dropped to text and
 *    the caller sees a text-only answer rather than an error. With a projector
 *    the parts array is forwarded intact.
 */
export function toWireMessage(
  message: ActivationChatMessage,
  supportsVision: boolean,
): WireMessage {
  const role = message.role === 'tool' ? 'user' : message.role;

  if (typeof message.content === 'string') {
    return {
      role,
      content: message.role === 'tool' ? `Tool result: ${message.content}` : message.content,
    };
  }

  const images = supportsVision
    ? message.content.map(imageUrlOf).filter((url): url is string => Boolean(url))
    : [];
  const text = partsToText(message.content);

  if (images.length === 0) {
    return {
      role,
      content: message.role === 'tool' ? `Tool result: ${text}` : text,
    };
  }

  return {
    role,
    content: [
      ...(text ? [{ type: 'text' as const, text }] : []),
      ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
    ],
  };
}

/**
 * Decode throughput measured from the first token onward.
 *
 * The first token costs a full prompt evaluation, so it is excluded from the
 * window: n tokens give n-1 decode intervals. Blending prompt eval into
 * tokens/sec makes a short generation look several times slower than the model
 * actually decodes, which is why llama.cpp reports the two separately.
 */
export function decodeRate(tokensGenerated: number, firstTokenAt: number): number {
  if (tokensGenerated < 2 || firstTokenAt === 0) return 0;
  const seconds = (Date.now() - firstTokenAt) / 1000;
  return seconds > 0 ? (tokensGenerated - 1) / seconds : 0;
}

/** Yield each `data:` payload from an SSE byte stream. */
export async function* iterateSse(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
}
