/**
 * Build a valid little GGUF file in memory so the parser tests don't need a
 * multi-GB binary fixture checked into the repo.
 *
 * Mirrors the GGUF v3 layout: magic, version, counts, KV pairs, tensor info.
 */

const GGUF_MAGIC = 0x46554747;

export const GGUF_TYPE = {
  UINT32: 4,
  FLOAT32: 6,
  BOOL: 7,
  STRING: 8,
  ARRAY: 9,
  UINT64: 10,
} as const;

export type FixtureValue =
  | { type: typeof GGUF_TYPE.UINT32; value: number }
  | { type: typeof GGUF_TYPE.FLOAT32; value: number }
  | { type: typeof GGUF_TYPE.BOOL; value: boolean }
  | { type: typeof GGUF_TYPE.STRING; value: string }
  | { type: typeof GGUF_TYPE.UINT64; value: number }
  | { type: typeof GGUF_TYPE.ARRAY; elementType: number; values: FixtureValue[] };

export interface FixtureTensor {
  name: string;
  dims: number[];
  type?: number;
}

export interface BuildGgufOptions {
  version?: number;
  kv: Array<[string, FixtureValue]>;
  tensors?: FixtureTensor[];
  /** Bytes of filler appended after the header, standing in for weights. */
  trailingBytes?: number;
}

class Writer {
  private chunks: Buffer[] = [];

  u32(value: number): this {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(value >>> 0, 0);
    this.chunks.push(b);
    return this;
  }

  f32(value: number): this {
    const b = Buffer.alloc(4);
    b.writeFloatLE(value, 0);
    this.chunks.push(b);
    return this;
  }

  u64(value: number): this {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(value), 0);
    this.chunks.push(b);
    return this;
  }

  u8(value: number): this {
    this.chunks.push(Buffer.from([value & 0xff]));
    return this;
  }

  string(value: string): this {
    const bytes = Buffer.from(value, 'utf8');
    this.u64(bytes.length);
    this.chunks.push(bytes);
    return this;
  }

  raw(buffer: Buffer): this {
    this.chunks.push(buffer);
    return this;
  }

  done(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

function writeValue(w: Writer, value: FixtureValue): void {
  switch (value.type) {
    case GGUF_TYPE.UINT32:
      w.u32(value.value);
      return;
    case GGUF_TYPE.FLOAT32:
      w.f32(value.value);
      return;
    case GGUF_TYPE.BOOL:
      w.u8(value.value ? 1 : 0);
      return;
    case GGUF_TYPE.STRING:
      w.string(value.value);
      return;
    case GGUF_TYPE.UINT64:
      w.u64(value.value);
      return;
    case GGUF_TYPE.ARRAY:
      w.u32(value.elementType);
      w.u64(value.values.length);
      for (const item of value.values) writeValue(w, item);
      return;
    default: {
      const exhaustive: never = value;
      throw new Error(`unhandled fixture value ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function buildGguf(options: BuildGgufOptions): Buffer {
  const tensors = options.tensors ?? [];
  const w = new Writer();

  w.u32(GGUF_MAGIC);
  w.u32(options.version ?? 3);
  w.u64(tensors.length);
  w.u64(options.kv.length);

  for (const [key, value] of options.kv) {
    w.string(key);
    w.u32(value.type);
    writeValue(w, value);
  }

  for (const tensor of tensors) {
    w.string(tensor.name);
    w.u32(tensor.dims.length);
    for (const dim of tensor.dims) w.u64(dim);
    w.u32(tensor.type ?? 15); // 15 ~ Q4_K in ggml's type enum
    w.u64(0); // offset
  }

  if (options.trailingBytes) {
    w.raw(Buffer.alloc(options.trailingBytes, 0x7a));
  }

  return w.done();
}

/** A small but complete instruct-model-shaped fixture. */
export function buildQwenLikeGguf(overrides: Partial<BuildGgufOptions> = {}): Buffer {
  return buildGguf({
    kv: [
      ['general.architecture', { type: GGUF_TYPE.STRING, value: 'qwen2' }],
      ['general.name', { type: GGUF_TYPE.STRING, value: 'Test Mini Instruct' }],
      ['general.file_type', { type: GGUF_TYPE.UINT32, value: 15 }], // Q4_K_M
      ['qwen2.context_length', { type: GGUF_TYPE.UINT32, value: 32768 }],
      ['qwen2.embedding_length', { type: GGUF_TYPE.UINT32, value: 896 }],
      ['qwen2.block_count', { type: GGUF_TYPE.UINT32, value: 24 }],
      ['qwen2.attention.head_count', { type: GGUF_TYPE.UINT32, value: 14 }],
      ['qwen2.attention.head_count_kv', { type: GGUF_TYPE.UINT32, value: 2 }],
      [
        'tokenizer.chat_template',
        { type: GGUF_TYPE.STRING, value: '{% for m in messages %}{{ m.content }}{% endfor %}' },
      ],
      [
        'tokenizer.ggml.tokens',
        {
          type: GGUF_TYPE.ARRAY,
          elementType: GGUF_TYPE.STRING,
          values: ['<pad>', 'hello', 'world'].map((value) => ({
            type: GGUF_TYPE.STRING as typeof GGUF_TYPE.STRING,
            value,
          })),
        },
      ],
    ],
    tensors: [
      { name: 'token_embd.weight', dims: [896, 1000] },
      { name: 'blk.0.attn_q.weight', dims: [896, 896] },
      { name: 'output_norm.weight', dims: [896] },
    ],
    ...overrides,
  });
}
