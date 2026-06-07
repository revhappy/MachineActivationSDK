import { Capacitor, registerPlugin } from '@capacitor/core';

export interface MachineActivationBackendInfo {
  backendId: string;
  backendName: string;
  backendVersion?: string;
  sessionCreationAvailable: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  supportsStructuredJsonOutput: boolean;
  supportsToolCalling: boolean;
  supportsCancellation: boolean;
  supportedAccelerationModes: string[];
  detectedDevices: string[];
  notes: string[];
}

export interface MachineActivationDeviceInfo {
  platform: string;
  manufacturer?: string;
  model?: string;
  memoryClassMb?: number;
  largeMemoryClassMb?: number;
  totalMemoryMb?: number;
  availableMemoryMb?: number;
  lowRamDevice?: boolean;
  supportedAbis?: string[];
}

export interface MachineActivationModelProbeResult {
  modelPath: string;
  modelFormat: string;
  fileSizeBytes?: number;
  exists: boolean;
  supportsVisionGuess: boolean;
}

export interface MachineActivationCreateSessionResult {
  sessionId: string;
  backendId: string;
  backendName: string;
  backendVersion?: string;
  maxContextTokens: number;
  supportsVision: boolean;
}

export interface MachineActivationCompletionResult {
  text: string;
  tokensGenerated: number;
  tokensPerSecond: number;
}

export interface MachineActivationContextStateResult {
  strategy: string;
  reuseStateAvailable: boolean;
  maxContextTokens: number;
  cachedTokens: number;
  lastPromptTokens: number;
  contextFull: boolean;
  overflowStrategy: 'reset' | 'sliding_window';
  notes: string[];
}

export interface MachineActivationVisionReadinessResult {
  ready: boolean;
  detail: string;
}

export interface MachineActivationDiagnosticsResult {
  backendId: string;
  backendName: string;
  backendVersion?: string;
  accelerationMode: string;
  backendSummary?: string;
  backendDetails?: string;
  devicesSummary?: string;
  deviceSummary?: string;
  recentLogs?: string[];
}

export interface MachineActivationPlugin {
  getBackendInfo(): Promise<MachineActivationBackendInfo>;
  getDeviceInfo(): Promise<MachineActivationDeviceInfo>;
  probeModelPackage(options: {
    modelPath: string;
    projectorPath?: string | null;
  }): Promise<MachineActivationModelProbeResult>;
  createSession(options: {
    modelPath: string;
    contextWindowTokens?: number;
    contextStrategy?: string;
    supportsVision?: boolean;
    preferredAcceleration?: string[];
  }): Promise<MachineActivationCreateSessionResult>;
  complete(options: {
    sessionId: string;
    prompt: string;
    options?: {
      systemPrompt?: string;
      temperature?: number;
      topP?: number;
      topK?: number;
      maxTokens?: number;
    };
  }): Promise<MachineActivationCompletionResult>;
  completeChat(options: {
    sessionId: string;
    messages: Array<{
      role: string;
      content:
        | string
        | Array<
            | { type: 'text'; text: string }
            | { type: 'image'; url: string }
            | { type: 'image_url'; image_url: { url: string } }
          >;
    }>;
    options?: {
      systemPrompt?: string;
      temperature?: number;
      topP?: number;
      topK?: number;
      maxTokens?: number;
    };
  }): Promise<MachineActivationCompletionResult>;
  contextState(options: {
    sessionId: string;
  }): Promise<MachineActivationContextStateResult>;
  resetContext(options: { sessionId: string }): Promise<void>;
  probeVisionReadiness(options: {
    sessionId: string;
  }): Promise<MachineActivationVisionReadinessResult>;
  diagnostics(options: {
    sessionId: string;
  }): Promise<MachineActivationDiagnosticsResult>;
  abort(options: { sessionId: string }): Promise<void>;
  closeSession(options: { sessionId: string }): Promise<void>;
}

export const MachineActivationNative = registerPlugin<MachineActivationPlugin>(
  'MachineActivation',
);

export function isMachineActivationPluginAvailable(): boolean {
  return Capacitor.getPlatform() === 'android';
}
