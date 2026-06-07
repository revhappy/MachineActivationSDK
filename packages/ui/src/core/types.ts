import type {
  FinishReason,
  StreamTextOptions,
  UsageInfo,
} from '@machine/activation-sdk';

export type InferenceStatus = 'idle' | 'streaming' | 'done' | 'aborted' | 'error';

export interface UseInferenceReturn {
  readonly status: InferenceStatus;
  readonly text: string;
  readonly tokensPerSecond: number;
  readonly usage: UsageInfo | null;
  readonly finishReason: FinishReason | null;
  readonly error: Error | null;
  start(options: Omit<StreamTextOptions, 'model'>): Promise<void>;
  abort(): void;
  reset(): void;
}

export type ActivationSnapshotStatus = 'idle' | 'loading' | 'ready' | 'error';
