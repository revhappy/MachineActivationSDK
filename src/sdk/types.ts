import type {
  ActivationAccelerationMode,
  ActivationCapabilitySnapshot,
  ActivationDiagnostics,
} from '../activation/activationContract';
import type {
  ActivationChatMessage,
  ActivationSession,
} from '../activation/activationAdapter';
import type { JsonSchema } from './jsonSchema';

/**
 * Identifies a local model. The `cartridge` variant requires a
 * `cartridgeResolver` on `createMachine(...)` — see M4 in
 * CARTRIDGE_SDK_ROADMAP.md.
 */
export type ModelSpec =
  | {
      filePath: string;
      modelId?: string;
      projectorPath?: string | null;
      runtimeHint?: string;
      modelFormatHint?: string;
      contextWindowTokens?: number;
    }
  | {
      cartridge: string;
      version?: string;
      modelId?: string;
    };

export interface MachineModel {
  readonly modelId: string;
  readonly spec: ModelSpec;
  getSession(): Promise<ActivationSession>;
  getSnapshot(): Promise<ActivationCapabilitySnapshot>;
  close(): Promise<void>;
}

export type FinishReason =
  | 'stop'
  | 'length'
  | 'tool-calls'
  | 'content-filter'
  | 'error'
  | 'other';

export interface UsageInfo {
  promptTokens?: number;
  completionTokens: number;
  totalTokens?: number;
  tokensPerSecond: number;
}

export interface CommonGenerationOptions {
  system?: string;
  prompt?: string;
  messages?: ActivationChatMessage[];
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  stopSequences?: string[];
  preferredAcceleration?: ActivationAccelerationMode[];
  abortSignal?: AbortSignal;
  /**
   * A GBNF grammar to constrain generation, passed straight to the backend.
   *
   * `generateObject` derives one from your schema, so you rarely need this. It
   * exists for the cases a schema cannot express: constrained *streaming* (which
   * `generateObject` does not do), a hand-written grammar, or forwarding a
   * grammar that arrived from somewhere else — `machine serve` compiles the
   * caller's `response_format.json_schema` here.
   *
   * Backends that cannot constrain generation ignore it. Use `jsonSchemaToGbnf`
   * to build one from a JSON Schema.
   */
  grammar?: string;
}

// Use `any` in the tool record so `Record<string, tool(...)>` stays assignable
// regardless of the caller's per-tool input/output types. TS function-parameter
// variance is strict enough that narrowing ToolDefinition<unknown, unknown>
// rejects ToolDefinition<{ query: string }, ...>.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDefinition = ToolDefinition<any, any>;

export interface GenerateTextOptions extends CommonGenerationOptions {
  model: MachineModel;
  tools?: Record<string, AnyToolDefinition>;
  toolChoice?: 'auto' | 'none' | { toolName: string };
  maxSteps?: number;
  onStepFinish?: (step: StepResult) => void | Promise<void>;
}

export interface StepResult {
  stepIndex: number;
  text: string;
  toolCalls: Array<{ toolName: string; args: unknown }>;
  toolResults: Array<{ toolName: string; result: unknown; error?: string }>;
  finishReason: FinishReason;
}

export interface GenerateTextResult {
  text: string;
  usage: UsageInfo;
  finishReason: FinishReason;
  reasoningText?: string;
  steps: StepResult[];
  diagnostics: ActivationDiagnostics;
}

export interface StreamTextOptions extends CommonGenerationOptions {
  model: MachineModel;
  /**
   * Tools the model may call, executed in this process.
   *
   * The loop is the same one `generateText` runs — same preamble, same
   * grammar-constrained envelope, same termination — so an agent behaves
   * identically whether or not you stream it.
   *
   * What streams is the *final answer only*. Intermediate turns are a
   * grammar-locked JSON envelope, and forwarding those deltas would render
   * `{"tool":"sea` into a chat window; they are withheld and surfaced as
   * `steps`/`toolCalls` instead. Once the model commits to answering, its text
   * is decoded out of the envelope and streamed token by token — so a
   * constrained agentic loop still feels live, which on a CPU decoding at a few
   * tokens a second is the difference between an app that works and one that
   * looks hung.
   */
  tools?: Record<string, AnyToolDefinition>;
  toolChoice?: 'auto' | 'none' | { toolName: string };
  maxSteps?: number;
  onStepFinish?: (step: StepResult) => void | Promise<void>;
  /**
   * Called as chain-of-thought arrives from a thinking model.
   *
   * `textStream` carries the *answer* only, so a UI bound to it never renders
   * the model's private deliberation as the reply. Thinking models are common
   * enough now (Gemma 4, DeepSeek-R1, Qwen3) that ignoring the channel makes
   * them look like they generated nothing at all — which is exactly what a live
   * Gemma 4 run reported before this existed.
   *
   * Receives the accumulated reasoning and the newest delta. Backends with no
   * separate reasoning channel never call it.
   */
  onReasoning?: (reasoningText: string, reasoningDelta: string) => void;
}

export interface StreamTextResult {
  /**
   * Text as it is generated.
   *
   * With `tools`, this carries the final answer only — see `tools`. Without
   * them it is the whole completion.
   */
  textStream: AsyncIterable<string>;
  text: Promise<string>;
  usage: Promise<UsageInfo>;
  finishReason: Promise<FinishReason>;
  /** Every step the loop ran, in order. One entry when no tools were used. */
  steps: Promise<StepResult[]>;
  /** Flattened convenience view of the tools that were called, in order. */
  toolCalls: Promise<Array<{ toolName: string; args: unknown }>>;
  abort(): Promise<void>;
}

export interface SchemaLike<T> {
  parse(value: unknown): T;
  safeParse?: (
    value: unknown,
  ) => { success: true; data: T } | { success: false; error: unknown };
  /**
   * Optional hook returning a JSON Schema representation of this schema.
   * When available, `generateObject` and the tool loop use it to emit a
   * grammar-constrained GBNF. Returning `null` signals that no grammar is
   * available for this schema (fall back to prompt-only JSON mode).
   */
  toJsonSchema?: () => JsonSchema | null;
}

export interface GenerateObjectOptions<T> extends CommonGenerationOptions {
  model: MachineModel;
  schema: SchemaLike<T>;
  /** Hint for the schema's JSON shape; included in the prompt if provided. */
  schemaDescription?: string;
  maxRetries?: number;
}

export interface GenerateObjectResult<T> {
  object: T;
  raw: string;
  usage: UsageInfo;
  finishReason: FinishReason;
  diagnostics: ActivationDiagnostics;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  description: string;
  parameters: SchemaLike<TInput>;
  execute: (args: TInput) => Promise<TOutput> | TOutput;
}
