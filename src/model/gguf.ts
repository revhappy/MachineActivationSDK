/**
 * Portable GGUF header parser.
 *
 * `machine doctor` has to answer "what IS this file" before it can answer
 * "will it run here" — architecture, quantization, context window, parameter
 * count. All of that lives in the GGUF header, so we read it directly rather
 * than making the developer install a runtime just to look at a file.
 *
 * No `node:*` imports: this operates on bytes so it stays usable from React
 * Native and the browser. `src/model/nodeGguf.ts` supplies the file reading.
 *
 * Format reference (GGUF v2/v3), little-endian throughout:
 *   magic     u32   'GGUF'
 *   version   u32
 *   nTensors  u64
 *   nKv       u64
 *   kv[]      { key: string, type: u32, value }
 *   tensors[] { name: string, nDims: u32, dims: u64[], type: u32, offset: u64 }
 */

export const GGUF_MAGIC = 0x46554747; // 'GGUF' little-endian

export type GgufValue =
  | string
  | number
  | bigint
  | boolean
  | GgufValue[];

export interface GgufTensorInfo {
  name: string;
  dims: number[];
  /** ggml type id; see GGML_TYPE_NAMES. */
  type: number;
}

export interface GgufMetadata {
  version: number;
  tensorCount: number;
  kv: Record<string, GgufValue>;
  tensors: GgufTensorInfo[];
}

/** Thrown when the prefix handed to the parser ends mid-structure. */
export class GgufTruncatedError extends Error {
  constructor(needed: number, available: number) {
    super(`GGUF header extends past the supplied buffer (needed ${needed}, have ${available}).`);
    this.name = 'GgufTruncatedError';
  }
}

export class GgufParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GgufParseError';
  }
}

enum GgufType {
  UINT8 = 0,
  INT8 = 1,
  UINT16 = 2,
  INT16 = 3,
  UINT32 = 4,
  INT32 = 5,
  FLOAT32 = 6,
  BOOL = 7,
  STRING = 8,
  ARRAY = 9,
  UINT64 = 10,
  INT64 = 11,
  FLOAT64 = 12,
}

class Cursor {
  offset = 0;
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private require(n: number): void {
    if (this.offset + n > this.bytes.byteLength) {
      throw new GgufTruncatedError(this.offset + n, this.bytes.byteLength);
    }
  }

  u8(): number {
    this.require(1);
    return this.view.getUint8(this.offset++);
  }

  i8(): number {
    this.require(1);
    return this.view.getInt8(this.offset++);
  }

  u16(): number {
    this.require(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  i16(): number {
    this.require(2);
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u32(): number {
    this.require(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  i32(): number {
    this.require(4);
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  f32(): number {
    this.require(4);
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  f64(): number {
    this.require(8);
    const v = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return v;
  }

  u64(): bigint {
    this.require(8);
    const v = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return v;
  }

  i64(): bigint {
    this.require(8);
    const v = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return v;
  }

  /** u64 length-prefixed UTF-8. Lengths are bounded so a corrupt file can't
   *  make us try to allocate gigabytes. */
  string(): string {
    const len = Number(this.u64());
    if (!Number.isSafeInteger(len) || len < 0 || len > 64 * 1024 * 1024) {
      throw new GgufParseError(`Implausible GGUF string length: ${len}`);
    }
    this.require(len);
    const slice = this.bytes.subarray(this.offset, this.offset + len);
    this.offset += len;
    return utf8Decode(slice);
  }
}

function utf8Decode(bytes: Uint8Array): string {
  // TextDecoder exists on Node 11+, all browsers, and Hermes/JSC in RN.
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(bytes);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

function readValue(cur: Cursor, type: number, depth = 0): GgufValue {
  switch (type) {
    case GgufType.UINT8:
      return cur.u8();
    case GgufType.INT8:
      return cur.i8();
    case GgufType.UINT16:
      return cur.u16();
    case GgufType.INT16:
      return cur.i16();
    case GgufType.UINT32:
      return cur.u32();
    case GgufType.INT32:
      return cur.i32();
    case GgufType.FLOAT32:
      return cur.f32();
    case GgufType.FLOAT64:
      return cur.f64();
    case GgufType.BOOL:
      return cur.u8() !== 0;
    case GgufType.STRING:
      return cur.string();
    case GgufType.UINT64:
      return cur.u64();
    case GgufType.INT64:
      return cur.i64();
    case GgufType.ARRAY: {
      if (depth > 4) throw new GgufParseError('GGUF array nesting too deep.');
      const elemType = cur.u32();
      const len = Number(cur.u64());
      if (!Number.isSafeInteger(len) || len < 0) {
        throw new GgufParseError(`Implausible GGUF array length: ${len}`);
      }
      const out: GgufValue[] = [];
      for (let i = 0; i < len; i += 1) {
        out.push(readValue(cur, elemType, depth + 1));
      }
      return out;
    }
    default:
      throw new GgufParseError(`Unknown GGUF value type: ${type}`);
  }
}

export interface ParseGgufOptions {
  /**
   * Skip tensor info. Tokenizer vocabularies dominate the KV section, but
   * tensor records are what let us count parameters — callers that only want
   * the KV metadata can opt out.
   */
  skipTensors?: boolean;
}

/**
 * Parse a GGUF header from `bytes`, which may be a prefix of the file.
 * Throws {@link GgufTruncatedError} if the prefix is too short — callers
 * should retry with more bytes.
 */
export function parseGguf(bytes: Uint8Array, options: ParseGgufOptions = {}): GgufMetadata {
  const cur = new Cursor(bytes);

  const magic = cur.u32();
  if (magic !== GGUF_MAGIC) {
    throw new GgufParseError(
      'Not a GGUF file (bad magic). Expected a .gguf model; got something else.',
    );
  }

  const version = cur.u32();
  if (version < 2 || version > 3) {
    throw new GgufParseError(
      `Unsupported GGUF version ${version}. This parser handles v2 and v3.`,
    );
  }

  const tensorCount = Number(cur.u64());
  const kvCount = Number(cur.u64());
  if (!Number.isSafeInteger(tensorCount) || !Number.isSafeInteger(kvCount)) {
    throw new GgufParseError('GGUF header declares implausible counts.');
  }

  const kv: Record<string, GgufValue> = {};
  for (let i = 0; i < kvCount; i += 1) {
    const key = cur.string();
    const type = cur.u32();
    kv[key] = readValue(cur, type);
  }

  const tensors: GgufTensorInfo[] = [];
  if (!options.skipTensors) {
    for (let i = 0; i < tensorCount; i += 1) {
      const name = cur.string();
      const nDims = cur.u32();
      if (nDims > 8) throw new GgufParseError(`Implausible tensor rank: ${nDims}`);
      const dims: number[] = [];
      for (let d = 0; d < nDims; d += 1) dims.push(Number(cur.u64()));
      const type = cur.u32();
      cur.u64(); // offset — not needed for metadata
      tensors.push({ name, dims, type });
    }
  }

  return { version, tensorCount, kv, tensors };
}

/** Total parameter count, summing the element count of every tensor. */
export function countParameters(metadata: GgufMetadata): number | undefined {
  if (metadata.tensors.length === 0) return undefined;
  let total = 0;
  for (const tensor of metadata.tensors) {
    let n = 1;
    for (const dim of tensor.dims) n *= dim;
    total += n;
  }
  return total;
}

/** `llama_ftype` → human label. Unknown ids fall through to `ftype-<n>`. */
const FILE_TYPE_NAMES: Record<number, string> = {
  0: 'F32',
  1: 'F16',
  2: 'Q4_0',
  3: 'Q4_1',
  7: 'Q8_0',
  8: 'Q5_0',
  9: 'Q5_1',
  10: 'Q2_K',
  11: 'Q3_K_S',
  12: 'Q3_K_M',
  13: 'Q3_K_L',
  14: 'Q4_K_S',
  15: 'Q4_K_M',
  16: 'Q5_K_S',
  17: 'Q5_K_M',
  18: 'Q6_K',
  19: 'IQ2_XXS',
  20: 'IQ2_XS',
  21: 'Q2_K_S',
  22: 'IQ3_XS',
  23: 'IQ3_XXS',
  24: 'IQ1_S',
  25: 'IQ4_NL',
  26: 'IQ3_S',
  27: 'IQ3_M',
  28: 'IQ2_S',
  29: 'IQ2_M',
  30: 'IQ4_XS',
  31: 'IQ1_M',
  32: 'BF16',
  36: 'TQ1_0',
  37: 'TQ2_0',
};

export function quantizationLabel(metadata: GgufMetadata): string | undefined {
  const ftype = metadata.kv['general.file_type'];
  if (typeof ftype !== 'number') return undefined;
  return FILE_TYPE_NAMES[ftype] ?? `ftype-${ftype}`;
}

function asNumber(value: GgufValue | undefined): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return undefined;
}

function asString(value: GgufValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** The subset of GGUF metadata `machine doctor` reports on. */
export interface GgufSummary {
  architecture?: string;
  name?: string;
  quantization?: string;
  contextLengthTokens?: number;
  embeddingLength?: number;
  blockCount?: number;
  headCount?: number;
  headCountKv?: number;
  parameterCount?: number;
  tensorCount: number;
  /** Presence of a chat template is how we tell an instruct model from a base
   *  one — the difference between `completeChat` working and producing junk. */
  hasChatTemplate: boolean;
  version: number;
}

export function summarizeGguf(metadata: GgufMetadata): GgufSummary {
  const architecture = asString(metadata.kv['general.architecture']);
  const prefix = architecture ? `${architecture}.` : '';

  return {
    architecture,
    name: asString(metadata.kv['general.name']),
    quantization: quantizationLabel(metadata),
    contextLengthTokens: asNumber(metadata.kv[`${prefix}context_length`]),
    embeddingLength: asNumber(metadata.kv[`${prefix}embedding_length`]),
    blockCount: asNumber(metadata.kv[`${prefix}block_count`]),
    headCount: asNumber(metadata.kv[`${prefix}attention.head_count`]),
    headCountKv: asNumber(metadata.kv[`${prefix}attention.head_count_kv`]),
    parameterCount: countParameters(metadata),
    tensorCount: metadata.tensorCount,
    hasChatTemplate: typeof metadata.kv['tokenizer.chat_template'] === 'string',
    version: metadata.version,
  };
}

/** "0.49B", "7.2B", "494M" — the way model cards write it. */
export function formatParameterCount(count: number | undefined): string | undefined {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return undefined;
  if (count >= 1e9) return `${(count / 1e9).toFixed(2)}B`;
  if (count >= 1e6) return `${(count / 1e6).toFixed(0)}M`;
  return `${count}`;
}
