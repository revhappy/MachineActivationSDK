// Minimal type stub so the template runtime adapters typecheck without
// installing llama.rn (which drags in the whole React Native toolchain).
// Scaffolded apps install the real llama.rn; its bundled types then supersede
// these declarations.
//
// Only the surface templates/*/src/llamaRuntime.ts actually uses is declared
// here. Needing to extend this stub is a signal that an adapter is reaching
// into backend internals instead of staying on the ActivationRuntime contract.

declare module 'llama.rn' {
  export interface TokenData {
    token: string;
    content?: string;
    reasoning_content?: string;
    accumulated_text?: string;
  }

  export interface CompletionTimings {
    predicted_per_second: number;
  }

  export interface CompletionResult {
    text: string;
    content: string;
    reasoning_content: string;
    tokens_predicted: number;
    timings: CompletionTimings;
  }

  export interface CompletionParams {
    messages?: Array<{ role: string; content: string }>;
    prompt?: string;
    n_predict?: number;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    stop?: string[];
    /** GBNF grammar for constrained decoding. */
    grammar?: string;
  }

  export interface ContextParams {
    model: string;
    n_ctx?: number;
    n_gpu_layers?: number;
  }

  export interface LlamaContext {
    /** True when layer offload to the GPU actually succeeded. */
    gpu: boolean;
    /** Populated when `gpu` is false. */
    reasonNoGPU: string;
    /** GPU device names, when the platform reports them. */
    devices?: string[];
    completion(
      params: CompletionParams,
      callback?: (data: TokenData) => void,
    ): Promise<CompletionResult>;
    stopCompletion(): Promise<void>;
    release(): Promise<void>;
  }

  export function initLlama(params: ContextParams): Promise<LlamaContext>;
}
