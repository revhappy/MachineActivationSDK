// Minimal type stub so templates/electron-local-chat typechecks without
// installing @mediapipe/tasks-genai. Scaffolded apps install the real package;
// its bundled types then supersede these declarations.
//
// Only the surface mediaPipeRuntime.ts actually uses is declared here.

declare module '@mediapipe/tasks-genai' {
  export interface WasmFileset {
    readonly wasmLoaderPath: string;
    readonly wasmBinaryPath: string;
  }

  export const FilesetResolver: {
    forGenAiTasks(wasmPath: string): Promise<WasmFileset>;
  };

  export interface LlmInferenceOptions {
    baseOptions: { modelAssetPath: string };
    maxTokens?: number;
    topK?: number;
    temperature?: number;
    randomSeed?: number;
  }

  export class LlmInference {
    static createFromOptions(
      fileset: WasmFileset,
      options: LlmInferenceOptions,
    ): Promise<LlmInference>;
    generateResponse(
      prompt: string,
      progressListener?: (partialResult: string, done: boolean) => void,
    ): Promise<string>;
    cancelProcessing(): void;
    close(): void;
  }
}
