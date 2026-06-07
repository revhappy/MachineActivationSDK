import * as React from 'react';
import {
  FlatList,
  StyleProp,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import type { CatalogEntry } from '@machine/activation-sdk';
import { useCartridgeFilter } from '../core/useCartridgeFilter';
import { formatBytes } from '../core/formatBytes';

export interface ModelPickerProps {
  cartridges: CatalogEntry[];
  onSelect: (entry: CatalogEntry) => void;
  selectedId?: string;
  style?: StyleProp<ViewStyle>;
  searchPlaceholder?: string;
  showCategories?: boolean;
  renderItem?: (entry: CatalogEntry, selected: boolean) => React.ReactNode;
}

export function ModelPicker(props: ModelPickerProps): React.ReactElement {
  const {
    cartridges,
    onSelect,
    selectedId,
    style,
    searchPlaceholder = 'Search models…',
    showCategories = true,
    renderItem,
  } = props;

  const filter = useCartridgeFilter(cartridges);

  return (
    <View style={style} testID="machine-ui-model-picker">
      <TextInput
        value={filter.query}
        onChangeText={filter.setQuery}
        placeholder={searchPlaceholder}
        autoCapitalize="none"
        autoCorrect={false}
        testID="machine-ui-model-picker-search"
      />

      {showCategories && filter.categories.length > 0 && (
        <View testID="machine-ui-model-picker-categories">
          <TouchableOpacity onPress={() => filter.setCategory(null)}>
            <Text>{filter.category === null ? '• All' : 'All'}</Text>
          </TouchableOpacity>
          {filter.categories.map((cat) => (
            <TouchableOpacity
              key={cat}
              onPress={() =>
                filter.setCategory(filter.category === cat ? null : cat)
              }
            >
              <Text>{filter.category === cat ? `• ${cat}` : cat}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <FlatList
        data={filter.filtered}
        keyExtractor={(entry: CatalogEntry) => `${entry.id}@${entry.version}`}
        testID="machine-ui-model-picker-list"
        renderItem={({ item }: { item: CatalogEntry; index: number }) => {
          const selected = item.id === selectedId;
          if (renderItem) {
            return (
              <TouchableOpacity onPress={() => onSelect(item)}>
                <>{renderItem(item, selected)}</>
              </TouchableOpacity>
            );
          }
          return (
            <TouchableOpacity
              onPress={() => onSelect(item)}
              testID="machine-ui-model-picker-item"
            >
              <Text>{item.name}</Text>
              {item.description && (
                <Text numberOfLines={2}>{item.description}</Text>
              )}
              <Text>{formatBytes(item.downloadSizeBytes)}</Text>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={<Text>No cartridges match.</Text>}
      />
    </View>
  );
}
