import * as React from 'react';
import type { Machine } from 'machineai-activation';
import { MachineContext } from './MachineProvider';

export function useMachineContext(): Machine {
  const machine = React.useContext(MachineContext);
  if (!machine) {
    throw new Error(
      'useMachineContext() must be used inside <MachineProvider>. '
        + 'Wrap your tree with <MachineProvider machine={createMachine(...)}>.',
    );
  }
  return machine;
}
