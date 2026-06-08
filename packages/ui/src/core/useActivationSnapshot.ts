import * as React from 'react';
import type {
  ActivationCapabilitySnapshot,
  MachineModel,
} from '@revhappy/activation-sdk';
import type { ActivationSnapshotStatus } from './types';

export interface UseActivationSnapshotReturn {
  readonly status: ActivationSnapshotStatus;
  readonly snapshot: ActivationCapabilitySnapshot | null;
  readonly error: Error | null;
  reload(): void;
}

export function useActivationSnapshot(
  model: MachineModel | null | undefined,
): UseActivationSnapshotReturn {
  const [status, setStatus] = React.useState<ActivationSnapshotStatus>('idle');
  const [snapshot, setSnapshot] = React.useState<ActivationCapabilitySnapshot | null>(null);
  const [error, setError] = React.useState<Error | null>(null);
  const [reloadTick, setReloadTick] = React.useState(0);

  const modelId = model?.modelId ?? null;

  React.useEffect(() => {
    if (!model) {
      setStatus('idle');
      setSnapshot(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setStatus('loading');
    setError(null);

    model
      .getSnapshot()
      .then((result) => {
        if (cancelled) return;
        setSnapshot(result);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [model, modelId, reloadTick]);

  const reload = React.useCallback(() => {
    setReloadTick((n) => n + 1);
  }, []);

  return { status, snapshot, error, reload };
}
