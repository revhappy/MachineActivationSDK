import * as React from 'react';
import {
  Button,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  InferenceIndicator,
  useInference,
  useMachineModel,
} from '@revhappy/ui/native';

const CARTRIDGE_ID = 'dev.machine.gemma-3n-e4b-it';

export function ChatScreen(): JSX.Element {
  const { model, status: modelStatus } = useMachineModel({
    cartridge: CARTRIDGE_ID,
  });
  const inference = useInference(model);
  const [prompt, setPrompt] = React.useState('');

  const onSend = async (): Promise<void> => {
    if (!prompt.trim() || !model) return;
    await inference.start({ prompt, maxTokens: 256 });
  };

  const busy = inference.status === 'streaming' || modelStatus === 'loading';

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Local chat</Text>
      <Text style={styles.subtitle}>cartridge: {CARTRIDGE_ID}</Text>

      <ScrollView
        style={styles.output}
        contentContainerStyle={styles.outputContent}
      >
        <Text style={styles.outputText}>
          {inference.text || (busy ? 'thinking…' : 'no response yet')}
        </Text>
      </ScrollView>

      <InferenceIndicator
        status={inference.status}
        tokensPerSecond={inference.tokensPerSecond}
      />

      <TextInput
        style={styles.input}
        value={prompt}
        onChangeText={setPrompt}
        placeholder="Ask anything…"
        multiline
      />

      <View style={styles.row}>
        <Button title="Send" onPress={onSend} disabled={busy || !model} />
        <View style={styles.gap} />
        <Button
          title="Stop"
          onPress={inference.abort}
          disabled={inference.status !== 'streaming'}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { fontSize: 12, color: '#666' },
  output: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8 },
  outputContent: { padding: 12 },
  outputText: { fontSize: 15, lineHeight: 22 },
  input: {
    minHeight: 60,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  gap: { width: 12 },
});
