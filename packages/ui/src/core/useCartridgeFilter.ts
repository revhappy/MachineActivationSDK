import * as React from 'react';
import type { CatalogEntry } from 'machineai-activation';

export interface UseCartridgeFilterOptions {
  initialQuery?: string;
  initialCategory?: string | null;
  initialTags?: string[];
  featuredFirst?: boolean;
}

export interface UseCartridgeFilterReturn {
  readonly query: string;
  readonly category: string | null;
  readonly tags: string[];
  readonly filtered: CatalogEntry[];
  readonly categories: string[];
  readonly tagsAvailable: string[];
  setQuery(next: string): void;
  setCategory(next: string | null): void;
  setTags(next: string[]): void;
  toggleTag(tag: string): void;
  reset(): void;
}

export function filterCartridges(
  entries: CatalogEntry[],
  query: string,
  category: string | null,
  tags: string[],
  featuredFirst: boolean,
): CatalogEntry[] {
  const q = query.trim().toLowerCase();

  const predicate = (entry: CatalogEntry): boolean => {
    if (category && !(entry.categories ?? []).includes(category)) {
      return false;
    }
    if (tags.length > 0) {
      const entryTags = entry.tags ?? [];
      for (const tag of tags) {
        if (!entryTags.includes(tag)) return false;
      }
    }
    if (q.length === 0) return true;
    const haystacks: string[] = [
      entry.id,
      entry.name,
      entry.description ?? '',
      entry.author?.name ?? '',
      ...(entry.tags ?? []),
      ...(entry.categories ?? []),
    ];
    return haystacks.some((h) => h.toLowerCase().includes(q));
  };

  const matched = entries.filter(predicate);

  if (featuredFirst) {
    return [...matched].sort((a, b) => {
      const af = a.featured ? 1 : 0;
      const bf = b.featured ? 1 : 0;
      if (af !== bf) return bf - af;
      return 0;
    });
  }
  return matched;
}

function collectUnique(values: Iterable<string | undefined | null>): string[] {
  const set = new Set<string>();
  for (const v of values) {
    if (typeof v === 'string' && v.length > 0) set.add(v);
  }
  return [...set].sort();
}

export function useCartridgeFilter(
  entries: CatalogEntry[],
  options: UseCartridgeFilterOptions = {},
): UseCartridgeFilterReturn {
  const { initialQuery = '', initialCategory = null, initialTags = [], featuredFirst = true } = options;

  const [query, setQuery] = React.useState(initialQuery);
  const [category, setCategory] = React.useState<string | null>(initialCategory);
  const [tags, setTags] = React.useState<string[]>(initialTags);

  const filtered = React.useMemo(
    () => filterCartridges(entries, query, category, tags, featuredFirst),
    [entries, query, category, tags, featuredFirst],
  );

  const categories = React.useMemo(
    () => collectUnique(entries.flatMap((e) => e.categories ?? [])),
    [entries],
  );

  const tagsAvailable = React.useMemo(
    () => collectUnique(entries.flatMap((e) => e.tags ?? [])),
    [entries],
  );

  const toggleTag = React.useCallback((tag: string) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }, []);

  const reset = React.useCallback(() => {
    setQuery(initialQuery);
    setCategory(initialCategory);
    setTags(initialTags);
  }, [initialQuery, initialCategory, initialTags]);

  return {
    query,
    category,
    tags,
    filtered,
    categories,
    tagsAvailable,
    setQuery,
    setCategory,
    setTags,
    toggleTag,
    reset,
  };
}
