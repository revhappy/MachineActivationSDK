import * as React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createMachine, type Machine } from 'machineai-activation';
import { MachineProvider } from 'machineai-activation-ui/native';

import { llamaRuntime } from './llamaRuntime';
import { ChatScreen } from './ChatScreen';

export default function App(): JSX.Element {
  const machine = React.useMemo<Machine>(
    () => createMachine({ runtimes: llamaRuntime }),
    [],
  );

  React.useEffect(() => {
    return () => {
      void machine.close();
    };
  }, [machine]);

  return (
    <SafeAreaProvider>
      <MachineProvider machine={machine}>
        <SafeAreaView style={styles.container}>
          <ChatScreen />
        </SafeAreaView>
      </MachineProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
});
