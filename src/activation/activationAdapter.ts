import type {
  ActivationAccelerationMode,
  ActivationCapabilitySnapshot,
  ActivationDiagnostics,
  AppCapabilityRequirements,
  BackendCapabilityDeclaration,
  DeviceCapabilityDeclaration,
  ModelCapabilityDeclaration,
  ResolvedCapabilityContract,
} from './activationContract';
import type { ActivationObservedCapabilities } from './observedCapabilities';

export type ActivationContextStrategy = 'reuse' | 'fresh' | 'sliding_window';
export type ActivationModelFormat = string;
export type ActivationResponseFormat = 'text' | 'json';

export interface ActivationCompletionChunk {
  rawToken: string;
  text: string;
  textDelta: string;
  reasoningText: string;
  reasoningDelta: string;
  tokensGenerated: number;
  tokensPerSecond: number;
}

export interface ActivationCompletionOptions {
  systemPrompt?: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  stopSequences?: string[];
  enableThinking?: boolean;
  responseFormat?: ActivationResponseFormat;
  grammar?: string;
  onToken?: (token: string) => void;
  onChunk?: (chunk: ActivationCompletionChunk) => void;
}

export interface ActivationCompletionResult {
  text: string;
  reasoningText: string;
  tokensGenerated: number;
  tokensPerSecond: number;
}

export type ActivationMessagePart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'image';
      url: string;
    }
  | {
      type: 'image_url';
      image_url: {
        url: string;
      };
    };

export interface ActivationChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ActivationMessagePart[];
}

export interface ActivationModelProbeInput {
  modelId?: string;
  filePath: string;
  projectorPath?: string | null;
  observedCapabilities?: ActivationObservedCapabilities;
  modelFormatHint?: ActivationModelFormat;
  runtimeHint?: string;
}

export interface ActivationSessionCreateInput extends ActivationModelProbeInput {
  appRequirements?: AppCapabilityRequirements;
  preferredAcceleration?: ActivationAccelerationMode[];
  contextWindowTokens?: number;
  contextStrategy?: ActivationContextStrategy;
}

export interface ActivationBackendCapabilityReporter {
  listBackendCapabilities(): Promise<BackendCapabilityDeclaration>;
}

export interface ActivationDeviceCapabilityReporter {
  probeDeviceCapabilities(): Promise<DeviceCapabilityDeclaration>;
}

export interface ActivationModelIntrospector {
  probeModelPackage(input: ActivationModelProbeInput): Promise<ModelCapabilityDeclaration>;
}

export interface ActivationRuntimeCore {
  id: string;
  name: string;
  version?: string;
  supportedModelFormats?: ActivationModelFormat[];
  canHandleModel?(input: ActivationModelProbeInput): boolean;
  createSession(input: ActivationSessionCreateInput): Promise<ActivationSession>;
}

export type ActivationRuntime = ActivationRuntimeCore &
  Partial<
    ActivationBackendCapabilityReporter &
      ActivationDeviceCapabilityReporter &
      ActivationModelIntrospector
  >;

export type ActivationInferenceAdapter = ActivationRuntimeCore;
export type ActivationDeviceProbe = ActivationDeviceCapabilityReporter;

export type ActivationAdapter = ActivationRuntime;

export interface ActivationContextState {
  strategy: ActivationContextStrategy;
  reuseStateAvailable: boolean;
  maxContextTokens?: number;
  cachedTokens?: number;
  lastPromptTokens?: number;
  contextFull?: boolean;
  overflowStrategy: 'reset' | 'sliding_window';
  notes: string[];
}

export interface ActivationSession {
  modelId?: string;
  backendId: string;
  resolvedContract: ResolvedCapabilityContract;
  capabilitySnapshot: ActivationCapabilitySnapshot;
  complete(
    prompt: string,
    options?: ActivationCompletionOptions,
  ): Promise<ActivationCompletionResult>;
  completeChat(
    messages: ActivationChatMessage[],
    options?: ActivationCompletionOptions,
  ): Promise<ActivationCompletionResult>;
  contextState(): Promise<ActivationContextState>;
  resetContext(options?: { clearData?: boolean }): Promise<void>;
  probeVisionReadiness(): Promise<{ ready: boolean; detail: string }>;
  diagnostics(): Promise<ActivationDiagnostics>;
  updateProjectorPath?(projectorPath: string | null): void;
  abort(): Promise<void>;
  close(): Promise<void>;
}
