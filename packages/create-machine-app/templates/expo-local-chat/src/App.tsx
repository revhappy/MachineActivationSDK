import * as React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { createMachine, type Machine } from '@machine/activation-sdk';
import { MachineProvider } from '@machine/ui/native';

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
    <MachineProvider machine={machine}>
      <SafeAreaView style={styles.container}>
        <StatusBar style="auto" />
        <ChatScreen />
      </SafeAreaView>
    </MachineProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
});
