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
}

export interface StreamTextResult {
  textStream: AsyncIterable<string>;
  text: Promise<string>;
  usage: Promise<UsageInfo>;
  finishReason: Promise<FinishReason>;
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
