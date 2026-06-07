import * as React from 'react';
import type { Machine } from '@machine/activation-sdk';

const MachineContext = React.createContext<Machine | null>(null);

export interface MachineProviderProps {
  machine: Machine;
  children?: React.ReactNode;
}

export function MachineProvider(props: MachineProviderProps): React.ReactElement {
  return (
    <MachineContext.Provider value={props.machine}>
      {props.children}
    </MachineContext.Provider>
  );
}

export { MachineContext };
