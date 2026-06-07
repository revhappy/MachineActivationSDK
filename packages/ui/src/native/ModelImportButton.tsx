import * as React from 'react';
import {
  StyleProp,
  Text,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';

export interface ImportedModelFile {
  name: string;
  uri: string;
  size?: number;
}

export interface ModelImportButtonProps {
  /**
   * Consumer-supplied picker (typically from `react-native-document-picker`).
   * Returns the picked file (with normalized `uri` — the app code, not this
   * component, handles Android `content://` → filesystem-path conversion) or
   * `null` if cancelled.
   */
  pickModel: () => Promise<ImportedModelFile | null>;
  onImport: (imported: ImportedModelFile) => void | Promise<void>;
  onError?: (error: Error) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function ModelImportButton(props: ModelImportButtonProps): React.ReactElement {
  const { pickModel, onImport, onError, disabled, style, children } = props;
  const [busy, setBusy] = React.useState(false);

  const handlePress = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const picked = await pickModel();
      if (picked) {
        await onImport(picked);
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (onError) onError(e);
    } finally {
      setBusy(false);
    }
  }, [busy, pickModel, onImport, onError]);

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={disabled || busy}
      style={style}
      testID="machine-ui-model-import-button"
    >
      {children ?? <Text>{busy ? 'Importing…' : 'Import model'}</Text>}
    </TouchableOpacity>
  );
}
