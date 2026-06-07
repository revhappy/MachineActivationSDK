import * as React from 'react';
import { StyleProp, Text, View, ViewStyle } from 'react-native';
import type { ActivationCapabilitySnapshot } from '@machine/activation-sdk';

export interface ActivationStatusProps {
  snapshot: ActivationCapabilitySnapshot;
  style?: StyleProp<ViewStyle>;
}

export function ActivationStatus(props: ActivationStatusProps): React.ReactElement {
  const { snapshot, style } = props;
  const { resolvedContract, diagnostics } = snapshot;
  const { compatibility, memoryAssessment, reasons, warnings } = resolvedContract;

  const backendLabel = diagnostics.backendName ?? diagnostics.backendId ?? '(unknown backend)';

  return (
    <View style={style} testID="machine-ui-activation-status">
      <Text accessibilityRole="text">{compatibility.toUpperCase()}</Text>
      <Text>
        Backend: {backendLabel}
        {diagnostics.backendVersion ? ` v${diagnostics.backendVersion}` : ''}
      </Text>
      <Text>Memory: {memoryAssessment.detail}</Text>

      {reasons.map((r, i) => (
        <Text key={`reason-${i}`}>• {r}</Text>
      ))}
      {warnings.map((w, i) => (
        <Text key={`warning-${i}`}>⚠ {w}</Text>
      ))}
    </View>
  );
}
