export interface ActivationProbeCheck {
  status: 'passed' | 'failed' | 'skipped';
  detail: string;
  observedAt: string;
}

export interface ActivationObservedCapabilities {
  source: 'probe-suite';
  observedAt: string;
  textCompletion?: boolean;
  streaming?: boolean;
  structuredJsonOutput?: boolean;
  visionImageInput?: boolean;
  projectorReady?: boolean;
  notes: string[];
  checks: {
    textSanity?: ActivationProbeCheck;
    streaming?: ActivationProbeCheck;
    structuredJsonOutput?: ActivationProbeCheck;
    projectorInit?: ActivationProbeCheck;
  };
}

export interface ActivationObservedCapabilityKey {
  modelId?: string;
  filePath: string;
  projectorPath?: string | null;
}

export interface ActivationObservedCapabilityStore {
  load(key: ActivationObservedCapabilityKey): ActivationObservedCapabilities | null;
  save(key: ActivationObservedCapabilityKey, value: ActivationObservedCapabilities): void;
  clear?(key?: ActivationObservedCapabilityKey): void;
}

export interface ActivationObservedCapabilityStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createInMemoryObservedCapabilityStore(): ActivationObservedCapabilityStore {
  const state = new Map<string, ActivationObservedCapabilities>();

  return {
    load(key) {
      return state.get(createObservedCapabilityStoreKey(key)) ?? null;
    },
    save(key, value) {
      state.set(createObservedCapabilityStoreKey(key), value);
    },
    clear(key) {
      if (!key) {
        state.clear();
        return;
      }

      state.delete(createObservedCapabilityStoreKey(key));
    },
  };
}

export function createJsonObservedCapabilityStore(options: {
  storageKey: string;
  storage?: ActivationObservedCapabilityStorageLike;
}): ActivationObservedCapabilityStore {
  const storage = options.storage ?? getDefaultObservedCapabilityStorage();

  return {
    load(key) {
      const raw = storage.getItem(options.storageKey);
      if (!raw) {
        return null;
      }

      try {
        const parsed = JSON.parse(raw) as Record<string, ActivationObservedCapabilities>;
        return parsed[createObservedCapabilityStoreKey(key)] ?? null;
      } catch {
        return null;
      }
    },
    save(key, value) {
      const current = readObservedCapabilityJson(storage, options.storageKey);
      current[createObservedCapabilityStoreKey(key)] = value;
      storage.setItem(options.storageKey, JSON.stringify(current));
    },
    clear(key) {
      if (!key) {
        storage.removeItem(options.storageKey);
        return;
      }

      const current = readObservedCapabilityJson(storage, options.storageKey);
      delete current[createObservedCapabilityStoreKey(key)];
      storage.setItem(options.storageKey, JSON.stringify(current));
    },
  };
}

export function createObservedCapabilityStoreKey(
  key: ActivationObservedCapabilityKey,
): string {
  return [key.modelId ?? '', key.filePath, key.projectorPath ?? ''].join('|');
}

function readObservedCapabilityJson(
  storage: ActivationObservedCapabilityStorageLike,
  storageKey: string,
): Record<string, ActivationObservedCapabilities> {
  const raw = storage.getItem(storageKey);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, ActivationObservedCapabilities>;
    return parsed ?? {};
  } catch {
    return {};
  }
}

function getDefaultObservedCapabilityStorage(): ActivationObservedCapabilityStorageLike {
  const browserStorage = (globalThis as typeof globalThis & {
    localStorage?: ActivationObservedCapabilityStorageLike;
  }).localStorage;

  if (browserStorage) {
    return browserStorage;
  }

  const fallbackState = new Map<string, string>();
  return {
    getItem(key) {
      return fallbackState.get(key) ?? null;
    },
    setItem(key, value) {
      fallbackState.set(key, value);
    },
    removeItem(key) {
      fallbackState.delete(key);
    },
  };
}
