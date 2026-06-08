import * as React from 'react';
import type { MachineModel, ModelSpec } from '@revhappy/activation-sdk';
import { useMachineContext } from './useMachineContext';

function stableSpecKey(spec: ModelSpec | null | undefined): string {
  if (!spec) return '';
  if ('cartridge' in spec) {
    return `cartridge::${spec.cartridge}::${spec.version ?? ''}::${spec.modelId ?? ''}`;
  }
  return [
    'file',
    spec.filePath,
    spec.modelId ?? '',
    spec.projectorPath ?? '',
    spec.runtimeHint ?? '',
    spec.modelFormatHint ?? '',
    spec.contextWindowTokens ?? '',
  ].join('::');
}

export function useMachineModel(spec: ModelSpec | null | undefined): MachineModel | null {
  const machine = useMachineContext();
  const key = stableSpecKey(spec);
  return React.useMemo(() => {
    if (!spec) return null;
    return machine.model(spec);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine, key]);
}
