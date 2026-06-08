'use client';

import * as React from 'react';
import { createMachine, type Machine } from '@revhappy/activation-sdk';
import { MachineProvider } from '@revhappy/ui/web';
import { webLlmRuntime } from '@/lib/webLlmRuntime';
import { ChatScreen } from './ChatScreen';

export default function Page(): JSX.Element {
  const machine = React.useMemo<Machine>(
    () => createMachine({ runtimes: webLlmRuntime }),
    [],
  );

  React.useEffect(() => {
    return () => {
      void machine.close();
    };
  }, [machine]);

  return (
    <MachineProvider machine={machine}>
      <ChatScreen />
    </MachineProvider>
  );
}
