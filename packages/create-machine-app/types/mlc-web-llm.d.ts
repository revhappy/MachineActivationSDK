// Minimal type stub so templates/next-local-chat typechecks without installing
// @mlc-ai/web-llm. Scaffolded apps install the real package; its bundled types
// then supersede these declarations.
//
// Only the surface webLlmRuntime.ts actually uses is declared here.

declare module '@mlc-ai/web-llm' {
  export interface ChatCompletionMessageParam {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
  }

  export interface ChatCompletionChunk {
    choices: Array<{
      delta?: { content?: string };
      finish_reason?: string | null;
    }>;
  }

  export interface ChatCompletionCreateParams {
    messages: ChatCompletionMessageParam[];
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    stop?: string[];
    stream: true;
  }

  export interface MLCEngine {
    chat: {
      completions: {
        create(
          params: ChatCompletionCreateParams,
        ): Promise<AsyncIterable<ChatCompletionChunk>>;
      };
    };
    resetChat(): Promise<void>;
    interruptGenerate(): Promise<void>;
    unload(): Promise<void>;
  }

  export function CreateMLCEngine(modelId: string): Promise<MLCEngine>;
}
