import * as React from 'react';
import {
  streamText,
  type FinishReason,
  type MachineModel,
  type StreamTextOptions,
  type StreamTextResult,
  type UsageInfo,
} from '@revhappy/activation-sdk';
import type { InferenceStatus, UseInferenceReturn } from './types';

export function useInference(
  model: MachineModel | null | undefined,
): UseInferenceReturn {
  const [status, setStatus] = React.useState<InferenceStatus>('idle');
  const [text, setText] = React.useState('');
  const [usage, setUsage] = React.useState<UsageInfo | null>(null);
  const [finishReason, setFinishReason] = React.useState<FinishReason | null>(null);
  const [error, setError] = React.useState<Error | null>(null);

  const activeRef = React.useRef<StreamTextResult | null>(null);
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const active = activeRef.current;
      if (active) {
        void active.abort().catch(() => undefined);
      }
    };
  }, []);

  const reset = React.useCallback(() => {
    setStatus('idle');
    setText('');
    setUsage(null);
    setFinishReason(null);
    setError(null);
  }, []);

  const abort = React.useCallback(() => {
    const active = activeRef.current;
    if (active) {
      void active.abort().catch(() => undefined);
    }
  }, []);

  const start = React.useCallback(
    async (options: Omit<StreamTextOptions, 'model'>): Promise<void> => {
      if (!model) {
        const err = new Error('useInference: start() called with no model.');
        setError(err);
        setStatus('error');
        throw err;
      }
      if (activeRef.current) {
        // Abort any in-flight run before starting a new one.
        try {
          await activeRef.current.abort();
        } catch {
          // best-effort
        }
      }

      setStatus('streaming');
      setText('');
      setUsage(null);
      setFinishReason(null);
      setError(null);

      const result = streamText({ ...options, model });
      activeRef.current = result;

      let accumulated = '';
      let aborted = false;

      try {
        for await (const delta of result.textStream) {
          if (!mountedRef.current) {
            aborted = true;
            break;
          }
          accumulated += delta;
          setText(accumulated);
        }

        const [finalUsage, finalReason] = await Promise.all([
          result.usage,
          result.finishReason,
        ]);
        if (!mountedRef.current) return;
        setUsage(finalUsage);
        setFinishReason(finalReason);
        setStatus(aborted ? 'aborted' : 'done');
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus('error');
      } finally {
        if (activeRef.current === result) {
          activeRef.current = null;
        }
      }
    },
    [model],
  );

  const tokensPerSecond = usage?.tokensPerSecond ?? 0;

  return {
    status,
    text,
    tokensPerSecond,
    usage,
    finishReason,
    error,
    start,
    abort,
    reset,
  };
}
