import * as React from 'react';
import {
  StyleProp,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import type {
  CartridgeManifest,
  CatalogEntry,
} from 'machineai-activation';
import { formatBytes } from '../core/formatBytes';

export interface CartridgeCardProps {
  manifest: CartridgeManifest;
  catalogEntry?: CatalogEntry;
  onInstall?: () => void;
  onOpen?: () => void;
  installed?: boolean;
  installing?: { progress: number };
  style?: StyleProp<ViewStyle>;
}

export function CartridgeCard(props: CartridgeCardProps): React.ReactElement {
  const { manifest, catalogEntry, onInstall, onOpen, installed, installing, style } = props;

  return (
    <View style={style} testID="machine-ui-cartridge-card">
      <Text>{manifest.name}</Text>
      {manifest.author?.name && <Text>by {manifest.author.name}</Text>}
      {manifest.description && <Text numberOfLines={3}>{manifest.description}</Text>}

      <Text>Version {manifest.version}</Text>
      {catalogEntry && <Text>{formatBytes(catalogEntry.downloadSizeBytes)}</Text>}
      {manifest.license && <Text>License: {manifest.license}</Text>}
      {manifest.capabilities?.contextWindowTokens !== undefined && (
        <Text>
          {manifest.capabilities.contextWindowTokens.toLocaleString()} token context
        </Text>
      )}

      {installing && (
        <Text testID="machine-ui-cartridge-card-progress">
          {Math.round(Math.max(0, Math.min(1, installing.progress)) * 100)}%
        </Text>
      )}

      {installed
        ? onOpen && (
            <TouchableOpacity onPress={onOpen}>
              <Text>Open</Text>
            </TouchableOpacity>
          )
        : onInstall && (
            <TouchableOpacity
              onPress={onInstall}
              disabled={Boolean(installing)}
            >
              <Text>{installing ? 'Installing…' : 'Install'}</Text>
            </TouchableOpacity>
          )}
    </View>
  );
}
