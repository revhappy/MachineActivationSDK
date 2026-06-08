import * as React from 'react';
import type { CatalogEntry } from 'machineai-activation';
import { useCartridgeFilter } from '../core/useCartridgeFilter';
import { formatBytes } from '../core/formatBytes';

export interface ModelPickerProps {
  cartridges: CatalogEntry[];
  onSelect: (entry: CatalogEntry) => void;
  selectedId?: string;
  className?: string;
  searchPlaceholder?: string;
  showCategories?: boolean;
  renderItem?: (entry: CatalogEntry, selected: boolean) => React.ReactNode;
}

export function ModelPicker(props: ModelPickerProps): React.ReactElement {
  const {
    cartridges,
    onSelect,
    selectedId,
    className,
    searchPlaceholder = 'Search models…',
    showCategories = true,
    renderItem,
  } = props;

  const filter = useCartridgeFilter(cartridges);

  return (
    <div className={className} data-machine-ui="model-picker">
      <input
        type="search"
        value={filter.query}
        onChange={(e) => filter.setQuery(e.target.value)}
        placeholder={searchPlaceholder}
        data-machine-ui="model-picker-search"
      />

      {showCategories && filter.categories.length > 0 && (
        <div data-machine-ui="model-picker-categories" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={filter.category === null}
            onClick={() => filter.setCategory(null)}
          >
            All
          </button>
          {filter.categories.map((cat) => (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={filter.category === cat}
              onClick={() => filter.setCategory(filter.category === cat ? null : cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      <ul data-machine-ui="model-picker-list" role="listbox">
        {filter.filtered.map((entry) => {
          const selected = entry.id === selectedId;
          return (
            <li key={`${entry.id}@${entry.version}`} role="option" aria-selected={selected}>
              {renderItem ? (
                <div onClick={() => onSelect(entry)}>{renderItem(entry, selected)}</div>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect(entry)}
                  data-machine-ui="model-picker-item"
                  data-selected={selected || undefined}
                >
                  <strong>{entry.name}</strong>
                  {entry.description && <span>{entry.description}</span>}
                  <small>{formatBytes(entry.downloadSizeBytes)}</small>
                </button>
              )}
            </li>
          );
        })}
        {filter.filtered.length === 0 && (
          <li data-machine-ui="model-picker-empty">No cartridges match.</li>
        )}
      </ul>
    </div>
  );
}
