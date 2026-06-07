import * as React from 'react';
import {
  ActivityIndicator,
  StyleProp,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { formatTokensPerSecond } from '../core/formatTokensPerSecond';
import type { UseInferenceReturn } from '../core/types';

export interface InferenceIndicatorProps {
  inference: UseInferenceReturn;
  style?: StyleProp<ViewStyle>;
  showAbort?: boolean;
}

export function InferenceIndicator(props: InferenceIndicatorProps): React.ReactElement {
  const { inference, style, showAbort = true } = props;
  const tokens = inference.usage?.completionTokens ?? 0;
  const streaming = inference.status === 'streaming';

  return (
    <View style={style} testID="machine-ui-inference-indicator">
      {streaming && <ActivityIndicator size="small" />}
      <Text>{inference.status}</Text>
      <Text>{formatTokensPerSecond(inference.tokensPerSecond)}</Text>
      <Text>{tokens} tok</Text>
      {showAbort && streaming && (
        <TouchableOpacity onPress={inference.abort}>
          <Text>Stop</Text>
        </TouchableOpacity>
      )}
      {inference.error && (
        <Text accessibilityRole="alert">{inference.error.message}</Text>
      )}
    </View>
  );
}
