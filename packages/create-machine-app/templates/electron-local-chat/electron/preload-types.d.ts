export {};

export interface MachineCompleteArgs {
  prompt: string;
  maxTokens?: number;
  systemPrompt?: string;
  grammar?: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  responseFormat?: 'json' | 'text';
}

export interface MachineCompleteResult {
  requestId: string;
  text: string;
  tokensPerSecond: number;
}

export interface AppConfig {
  modelFilePath: string | null;
}

declare global {
  interface Window {
    machine: {
      complete: (
        args: MachineCompleteArgs,
        onToken?: (delta: string) => void,
      ) => Promise<MachineCompleteResult>;
      abort: (requestId: string) => Promise<{ ok: boolean }>;
    };
    config: {
      get: () => Promise<AppConfig>;
      pickModelFile: () => Promise<{ filePath: string | null }>;
      setModelFilePath: (filePath: string | null) => Promise<AppConfig>;
    };
  }
}
