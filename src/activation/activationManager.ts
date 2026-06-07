import type {
  ActivationRuntime,
  ActivationModelProbeInput,
  ActivationSession,
  ActivationSessionCreateInput,
} from './activationAdapter';
import type {
  ActivationCapabilitySnapshot,
  ActivationAccelerationMode,
  AppCapabilityRequirements,
  BackendCapabilityDeclaration,
  DeviceCapabilityDeclaration,
  ModelCapabilityDeclaration,
} from './activationContract';
import { ACTIVATION_CONTRACT_SCHEMA_VERSION } from './activationContract';
import type {
  ActivationObservedCapabilities,
  ActivationObservedCapabilityStore,
  ActivationProbeCheck,
} from './observedCapabilities';
import { resolveCapabilityContract } from './activationContract';
import { selectActivationRuntime } from './runtimeSelection';
import { detectActivationModelFormat } from './runtimeSelection';
import { inferKnownModelCapabilities } from './capabilityInference';
import type { ActivationCapabilityRegistry } from './capabilityRegistry';
import { DEFAULT_ACTIVATION_CAPABILITY_REGISTRY } from './capabilityRegistry';

export interface ActivationCompatibilityInput {
  model: ActivationModelProbeInput;
  appRequirements?: AppCapabilityRequirements;
  preferredAcceleration?: ActivationAccelerationMode[];
}

export interface ActivationManager {
  readonly runtime: ActivationRuntime;
  getCachedCapabilitySnapshot(input: ActivationModelProbeInput): ActivationCapabilitySnapshot | null;
  getObservedCapabilities(input: ActivationModelProbeInput): ActivationObservedCapabilities | null;
  invalidateModelProbe(input?: ActivationModelProbeInput): void;
  listBackendCapabilities(forceRefresh?: boolean): Promise<BackendCapabilityDeclaration>;
  probeDeviceCapabilities(forceRefresh?: boolean): Promise<DeviceCapabilityDeclaration>;
  probeModel(input: ActivationModelProbeInput, options?: { forceRefresh?: boolean }): Promise<ModelCapabilityDeclaration>;
  resolveCompatibility(input: ActivationCompatibilityInput): Promise<ActivationCapabilitySnapshot>;
  runObservedCapabilityProbes(
    input: ActivationModelProbeInput,
    options?: { forceRefresh?: boolean; saveResults?: boolean },
  ): Promise<ActivationObservedCapabilities>;
  createSession(input: ActivationSessionCreateInput): Promise<ActivationSession>;
}

export interface ActivationManagerOptions {
  capabilityRegistry?: ActivationCapabilityRegistry;
  observedCapabilityStore?: ActivationObservedCapabilityStore;
}

export function createActivationManager(
  runtime: ActivationRuntime | ActivationRuntime[],
  options: ActivationManagerOptions = {},
): ActivationManager {
  if (Array.isArray(runtime)) {
    if (runtime.length === 0) {
      throw new Error('At least one activation runtime must be provided.');
    }

    if (runtime.length === 1) {
      return new DefaultActivationManager(runtime[0], options);
    }

    return new RoutedActivationManager(runtime, options);
  }

  return new DefaultActivationManager(runtime, options);
}

class DefaultActivationManager implements ActivationManager {
  readonly runtime: ActivationRuntime;

  private backendCapabilitiesPromise: Promise<BackendCapabilityDeclaration> | null = null;

  private deviceCapabilitiesPromise: Promise<DeviceCapabilityDeclaration> | null = null;

  private readonly modelProbeCache = new Map<string, Promise<ModelCapabilityDeclaration>>();

  private readonly compatibilityCache = new Map<string, Promise<ActivationCapabilitySnapshot>>();

  private readonly resolvedCompatibilityCache = new Map<string, ActivationCapabilitySnapshot>();

  constructor(
    runtime: ActivationRuntime,
    private readonly options: ActivationManagerOptions = {},
  ) {
    this.runtime = runtime;
  }

  getCachedCapabilitySnapshot(input: ActivationModelProbeInput): ActivationCapabilitySnapshot | null {
    const key = createCompatibilityCacheKey({
      model: input,
      appRequirements: undefined,
      preferredAcceleration: undefined,
    });
    return this.resolvedCompatibilityCache.get(key) ?? null;
  }

  getObservedCapabilities(input: ActivationModelProbeInput): ActivationObservedCapabilities | null {
    return this.options.observedCapabilityStore?.load(toObservedCapabilityKey(input)) ?? null;
  }

  invalidateModelProbe(input?: ActivationModelProbeInput): void {
    if (!input) {
      this.modelProbeCache.clear();
      this.compatibilityCache.clear();
      this.resolvedCompatibilityCache.clear();
      return;
    }

    const probeKey = createProbeCacheKey(input);
    this.modelProbeCache.delete(probeKey);

    for (const key of Array.from(this.compatibilityCache.keys())) {
      if (key.startsWith(`${probeKey}::`)) {
        this.compatibilityCache.delete(key);
        this.resolvedCompatibilityCache.delete(key);
      }
    }
  }

  async listBackendCapabilities(forceRefresh = false): Promise<BackendCapabilityDeclaration> {
    if (!this.backendCapabilitiesPromise || forceRefresh) {
      this.backendCapabilitiesPromise = this.runtime.listBackendCapabilities
        ? this.runtime.listBackendCapabilities()
        : Promise.resolve(buildFallbackBackendCapabilities(this.runtime));
    }
    return this.backendCapabilitiesPromise;
  }

  async probeDeviceCapabilities(forceRefresh = false): Promise<DeviceCapabilityDeclaration> {
    if (!this.deviceCapabilitiesPromise || forceRefresh) {
      this.deviceCapabilitiesPromise = this.runtime.probeDeviceCapabilities
        ? this.runtime.probeDeviceCapabilities()
        : Promise.resolve(buildFallbackDeviceCapabilities());
    }
    return this.deviceCapabilitiesPromise;
  }

  async probeModel(
    input: ActivationModelProbeInput,
    options: { forceRefresh?: boolean } = {},
  ): Promise<ModelCapabilityDeclaration> {
    const key = createProbeCacheKey(input);
    if (!this.modelProbeCache.has(key) || options.forceRefresh) {
      this.modelProbeCache.set(
        key,
        this.runtime.probeModelPackage
          ? this.runtime.probeModelPackage(input)
          : Promise.resolve(
              buildFallbackModelCapabilities(
                this.runtime,
                input,
                this.options.capabilityRegistry ?? DEFAULT_ACTIVATION_CAPABILITY_REGISTRY,
              ),
            ),
      );
    }

    const baseModel = await this.modelProbeCache.get(key)!;
    return mergeObservedCapabilities(baseModel, this.getEffectiveObservedCapabilities(input));
  }

  async resolveCompatibility(input: ActivationCompatibilityInput): Promise<ActivationCapabilitySnapshot> {
    const key = createCompatibilityCacheKey(input);
    if (!this.compatibilityCache.has(key)) {
      this.compatibilityCache.set(
        key,
        this.buildCompatibilitySnapshot(input).then((snapshot) => {
          this.resolvedCompatibilityCache.set(key, snapshot);
          return snapshot;
        }),
      );
    }

    return this.compatibilityCache.get(key)!;
  }

  async createSession(input: ActivationSessionCreateInput): Promise<ActivationSession> {
    const effectiveInput = {
      ...input,
      observedCapabilities: this.getEffectiveObservedCapabilities(input),
    };
    const session = await this.runtime.createSession(effectiveInput);
    const compatibilityKey = createCompatibilityCacheKey({
      model: {
        modelId: effectiveInput.modelId,
        filePath: effectiveInput.filePath,
        projectorPath: effectiveInput.projectorPath,
      },
      appRequirements: effectiveInput.appRequirements,
      preferredAcceleration: effectiveInput.preferredAcceleration,
    });
    this.compatibilityCache.set(compatibilityKey, Promise.resolve(session.capabilitySnapshot));
    this.resolvedCompatibilityCache.set(compatibilityKey, session.capabilitySnapshot);
    this.modelProbeCache.set(
      createProbeCacheKey({
        modelId: effectiveInput.modelId,
        filePath: effectiveInput.filePath,
        projectorPath: effectiveInput.projectorPath,
      }),
      Promise.resolve(session.capabilitySnapshot.model),
    );
    return session;
  }

  async runObservedCapabilityProbes(
    input: ActivationModelProbeInput,
    options: { forceRefresh?: boolean; saveResults?: boolean } = {},
  ): Promise<ActivationObservedCapabilities> {
    if (!options.forceRefresh) {
      const cached = this.getObservedCapabilities(input);
      if (cached) {
        return cached;
      }
    }

    const observedAt = new Date().toISOString();
    const session = await this.runtime.createSession({
      ...input,
      observedCapabilities: this.getEffectiveObservedCapabilities(input),
      appRequirements: {
        textCompletion: true,
        streaming: true,
        structuredJsonOutput: true,
        visionImageInput: true,
      },
    });

    try {
      const textSanity = await runTextSanityProbe(session, observedAt);
      const streaming = await runStreamingProbe(
        session,
        session.capabilitySnapshot.resolvedContract.resolvedCapabilities.streaming,
        observedAt,
      );
      const structuredJsonOutput = await runStructuredJsonProbe(session, observedAt);
      const projectorInit = await runVisionReadinessProbe(
        session,
        session.capabilitySnapshot.model.inputModalities.includes('image') ||
          session.capabilitySnapshot.model.requiresProjector,
        observedAt,
      );

      const observed: ActivationObservedCapabilities = {
        source: 'probe-suite',
        observedAt,
        textCompletion: textSanity.status === 'passed',
        streaming:
          streaming.status === 'skipped' ? undefined : streaming.status === 'passed',
        structuredJsonOutput:
          structuredJsonOutput.status === 'skipped'
            ? undefined
            : structuredJsonOutput.status === 'passed',
        visionImageInput:
          projectorInit.status === 'skipped' ? undefined : projectorInit.status === 'passed',
        projectorReady:
          projectorInit.status === 'skipped' ? undefined : projectorInit.status === 'passed',
        notes: [
          'Machine Activation SDK executed its built-in observed capability probe suite for this model/runtime combination.',
        ],
        checks: {
          textSanity,
          streaming,
          structuredJsonOutput,
          projectorInit,
        },
      };

      if (options.saveResults !== false && this.options.observedCapabilityStore) {
        this.options.observedCapabilityStore.save(toObservedCapabilityKey(input), observed);
        this.invalidateModelProbe(input);
      }

      return observed;
    } finally {
      await session.close();
    }
  }

  private async buildCompatibilitySnapshot(
    input: ActivationCompatibilityInput,
  ): Promise<ActivationCapabilitySnapshot> {
    const [backend, device, model] = await Promise.all([
      this.listBackendCapabilities(),
      this.probeDeviceCapabilities(),
      this.probeModel(input.model, { forceRefresh: false }),
    ]);
    const effectiveModel = mergeObservedCapabilities(model, this.getEffectiveObservedCapabilities(input.model));

    const resolvedContract = resolveCapabilityContract({
      appRequirements: input.appRequirements,
      model: effectiveModel,
      backend,
      device,
      preferredAcceleration: input.preferredAcceleration,
    });

    return {
      schemaVersion: ACTIVATION_CONTRACT_SCHEMA_VERSION,
      appRequirements: input.appRequirements ?? {},
      model: effectiveModel,
      backend,
      device,
      resolvedContract,
      diagnostics: {
        sourceAdapterId: this.runtime.id,
        backendId: backend.backendId,
        backendName: backend.backendName,
        backendVersion: backend.backendVersion,
        accelerationMode: resolvedContract.resolvedCapabilities.accelerationMode,
        backendSummary: backend.notes[0],
        backendDetails: backend.notes.slice(1).join(' '),
        devicesSummary: backend.detectedDevices.join(', '),
        deviceSummary: `${device.platform} (${device.availableAccelerationModes.join(', ')})`,
      },
    };
  }

  private getEffectiveObservedCapabilities(
    input: ActivationModelProbeInput,
  ): ActivationObservedCapabilities | undefined {
    return mergeObservedCapabilityInputs(
      this.options.observedCapabilityStore?.load(toObservedCapabilityKey(input)) ?? null,
      input.observedCapabilities,
    );
  }
}

class RoutedActivationManager implements ActivationManager {
  readonly runtime: ActivationRuntime;

  private readonly runtimes: ActivationRuntime[];

  private readonly managers: Map<string, DefaultActivationManager>;

  private backendCapabilitiesPromise: Promise<BackendCapabilityDeclaration> | null = null;

  private deviceCapabilitiesPromise: Promise<DeviceCapabilityDeclaration> | null = null;

  constructor(
    runtimes: ActivationRuntime[],
    private readonly options: ActivationManagerOptions = {},
  ) {
    this.runtimes = runtimes;
    this.runtime = runtimes[0];
    this.managers = new Map(
      runtimes.map((runtime) => [runtime.id, new DefaultActivationManager(runtime, options)]),
    );
  }

  getCachedCapabilitySnapshot(input: ActivationModelProbeInput): ActivationCapabilitySnapshot | null {
    return this.getManagerForInput(input).getCachedCapabilitySnapshot(input);
  }

  getObservedCapabilities(input: ActivationModelProbeInput): ActivationObservedCapabilities | null {
    return this.getManagerForInput(input).getObservedCapabilities(input);
  }

  invalidateModelProbe(input?: ActivationModelProbeInput): void {
    if (!input) {
      this.backendCapabilitiesPromise = null;
      this.deviceCapabilitiesPromise = null;
      for (const manager of this.managers.values()) {
        manager.invalidateModelProbe();
      }
      return;
    }

    this.getManagerForInput(input).invalidateModelProbe(input);
  }

  async listBackendCapabilities(forceRefresh = false): Promise<BackendCapabilityDeclaration> {
    if (!this.backendCapabilitiesPromise || forceRefresh) {
      this.backendCapabilitiesPromise = this.buildCompositeBackendCapabilities(forceRefresh);
    }

    return this.backendCapabilitiesPromise;
  }

  async probeDeviceCapabilities(forceRefresh = false): Promise<DeviceCapabilityDeclaration> {
    if (!this.deviceCapabilitiesPromise || forceRefresh) {
      this.deviceCapabilitiesPromise = this.buildCompositeDeviceCapabilities(forceRefresh);
    }

    return this.deviceCapabilitiesPromise;
  }

  async probeModel(
    input: ActivationModelProbeInput,
    options: { forceRefresh?: boolean } = {},
  ): Promise<ModelCapabilityDeclaration> {
    return this.getManagerForInput(input).probeModel(input, options);
  }

  async resolveCompatibility(input: ActivationCompatibilityInput): Promise<ActivationCapabilitySnapshot> {
    return this.getManagerForInput(input.model).resolveCompatibility(input);
  }

  async runObservedCapabilityProbes(
    input: ActivationModelProbeInput,
    options: { forceRefresh?: boolean; saveResults?: boolean } = {},
  ): Promise<ActivationObservedCapabilities> {
    return this.getManagerForInput(input).runObservedCapabilityProbes(input, options);
  }

  async createSession(input: ActivationSessionCreateInput): Promise<ActivationSession> {
    return this.getManagerForInput(input).createSession(input);
  }

  private getManagerForInput(input: ActivationModelProbeInput): DefaultActivationManager {
    const runtime = selectActivationRuntime(this.runtimes, input);
    return this.managers.get(runtime.id)!;
  }

  private async buildCompositeBackendCapabilities(
    forceRefresh: boolean,
  ): Promise<BackendCapabilityDeclaration> {
    const backends = await Promise.all(
      Array.from(this.managers.values()).map((manager) =>
        manager.listBackendCapabilities(forceRefresh),
      ),
    );

    return {
      backendId: 'machine.multi-runtime',
      backendName: 'Machine multi-runtime router',
      backendVersion: backends
        .map((backend) => `${backend.backendName}@${backend.backendVersion ?? 'unknown'}`)
        .join(', '),
      sessionCreationAvailable: backends.some((backend) => backend.sessionCreationAvailable),
      supportsStreaming: backends.some((backend) => backend.supportsStreaming),
      supportsVision: backends.some((backend) => backend.supportsVision),
      supportsStructuredJsonOutput: backends.some(
        (backend) => backend.supportsStructuredJsonOutput,
      ),
      supportsToolCalling: backends.some((backend) => backend.supportsToolCalling),
      supportsCancellation: backends.some((backend) => backend.supportsCancellation),
      supportedAccelerationModes: uniqueValues(
        backends.flatMap((backend) => backend.supportedAccelerationModes),
      ),
      detectedDevices: uniqueValues(backends.flatMap((backend) => backend.detectedDevices)),
      notes: backends.flatMap((backend) => [
        `${backend.backendName}:`,
        ...backend.notes.map((note) => `  ${note}`),
      ]),
    };
  }

  private async buildCompositeDeviceCapabilities(
    forceRefresh: boolean,
  ): Promise<DeviceCapabilityDeclaration> {
    const devices = await Promise.all(
      Array.from(this.managers.values()).map((manager) =>
        manager.probeDeviceCapabilities(forceRefresh),
      ),
    );

    return {
      platform: uniqueValues(devices.map((device) => device.platform)).join(', '),
      cameraAvailable: devices.some((device) => device.cameraAvailable),
      photoLibraryAvailable: devices.some((device) => device.photoLibraryAvailable),
      availableAccelerationModes: uniqueValues(
        devices.flatMap((device) => device.availableAccelerationModes),
      ),
      memoryClassMb: devices.reduce<number | undefined>(
        (maxValue, device) =>
          typeof device.memoryClassMb === 'number'
            ? Math.max(maxValue ?? 0, device.memoryClassMb)
            : maxValue,
        undefined,
      ),
      notes: uniqueValues(devices.flatMap((device) => device.notes)),
    };
  }
}

function mergeObservedCapabilities(
  model: ModelCapabilityDeclaration,
  observed?: ActivationObservedCapabilities,
): ModelCapabilityDeclaration {
  if (!observed) {
    return model;
  }

  const supportsVision =
    observed.visionImageInput ??
    model.inputModalities.includes('image');

  return {
    ...model,
    inputModalities: supportsVision ? ['text', 'image'] : ['text'],
    supportsTextCompletion: observed.textCompletion ?? model.supportsTextCompletion,
    supportsTextChat: observed.textCompletion ?? model.supportsTextChat,
    supportsStreaming: observed.streaming ?? model.supportsStreaming,
    structuredJsonOutput: observed.structuredJsonOutput ?? model.structuredJsonOutput,
    requiresProjector: model.requiresProjector || supportsVision,
    projectorAttached: observed.projectorReady ?? model.projectorAttached,
    notes: [...model.notes, ...observed.notes],
  };
}

function createProbeCacheKey(input: ActivationModelProbeInput): string {
  return [
    input.modelId ?? '',
    input.filePath,
    input.projectorPath ?? '',
    input.modelFormatHint ?? '',
    input.runtimeHint ?? '',
  ].join('|');
}

function createCompatibilityCacheKey(input: ActivationCompatibilityInput): string {
  return [
    createProbeCacheKey(input.model),
    JSON.stringify(input.appRequirements ?? {}),
    JSON.stringify(input.preferredAcceleration ?? []),
  ].join('::');
}

function uniqueValues<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function buildFallbackBackendCapabilities(runtime: ActivationRuntime): BackendCapabilityDeclaration {
  return {
    backendId: runtime.id,
    backendName: runtime.name,
    backendVersion: runtime.version,
    sessionCreationAvailable: true,
    supportsStreaming: false,
    supportsVision: false,
    supportsStructuredJsonOutput: false,
    supportsToolCalling: false,
    supportsCancellation: false,
    supportedAccelerationModes: ['cpu'],
    detectedDevices: [],
    notes: [
      'This runtime only implements the minimal Machine Activation runtime surface, so backend capability reporting is using conservative defaults.',
    ],
  };
}

function buildFallbackDeviceCapabilities(): DeviceCapabilityDeclaration {
  return {
    platform: 'unknown',
    cameraAvailable: false,
    photoLibraryAvailable: false,
    availableAccelerationModes: ['cpu'],
    notes: [
      'This runtime did not implement device capability reporting, so the SDK is using conservative unknown-device defaults.',
    ],
  };
}

function buildFallbackModelCapabilities(
  runtime: ActivationRuntime,
  input: ActivationModelProbeInput,
  capabilityRegistry: ActivationCapabilityRegistry = DEFAULT_ACTIVATION_CAPABILITY_REGISTRY,
): ModelCapabilityDeclaration {
  const modelFormat = detectActivationModelFormat(input.filePath, input.modelFormatHint);
  const inferred = inferKnownModelCapabilities({
    modelId: input.modelId,
    filePath: input.filePath,
    projectorPath: input.projectorPath,
  }, capabilityRegistry);
  const inputModalities = inferred.inferredFields.inputModalities ?? ['text'];

  return {
    modelId: input.modelId,
    modelPath: input.filePath,
    modelFormat,
    inputModalities,
    outputModalities: ['text'],
    supportsTextCompletion: true,
    supportsTextChat: true,
    supportsStreaming: false,
    structuredJsonOutput: inferred.inferredFields.structuredJsonOutput ?? false,
    toolCalling: inferred.inferredFields.toolCalling ?? false,
    requiresProjector: inferred.inferredFields.requiresProjector ?? false,
    projectorAttached: Boolean(input.projectorPath),
    projectorPath: input.projectorPath ?? null,
    notes: [
      `${runtime.name} did not implement model probing, so the SDK is using a conservative inferred capability declaration.`,
      ...inferred.notes,
    ],
  };
}

function toObservedCapabilityKey(input: ActivationModelProbeInput) {
  return {
    modelId: input.modelId,
    filePath: input.filePath,
    projectorPath: input.projectorPath,
  };
}

function mergeObservedCapabilityInputs(
  left?: ActivationObservedCapabilities | null,
  right?: ActivationObservedCapabilities,
): ActivationObservedCapabilities | undefined {
  if (!left && !right) {
    return undefined;
  }

  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return {
    source: 'probe-suite',
    observedAt: right.observedAt || left.observedAt,
    textCompletion: right.textCompletion ?? left.textCompletion,
    streaming: right.streaming ?? left.streaming,
    structuredJsonOutput: right.structuredJsonOutput ?? left.structuredJsonOutput,
    visionImageInput: right.visionImageInput ?? left.visionImageInput,
    projectorReady: right.projectorReady ?? left.projectorReady,
    notes: [...left.notes, ...right.notes],
    checks: {
      ...left.checks,
      ...right.checks,
    },
  };
}

async function runTextSanityProbe(
  session: ActivationSession,
  observedAt: string,
): Promise<ActivationProbeCheck> {
  try {
    const result = await session.complete('Reply with exactly OK.', {
      temperature: 0,
      maxTokens: 8,
    });
    const passed = /\bok\b/i.test(result.text.trim());
    return {
      status: passed ? 'passed' : 'failed',
      detail: passed
        ? 'Text sanity probe returned a recognizable OK response.'
        : `Unexpected text sanity result: ${result.text.trim() || '<empty>'}`,
      observedAt,
    };
  } catch (error) {
    return {
      status: 'failed',
      detail: `Text sanity probe failed: ${toProbeErrorDetail(error)}`,
      observedAt,
    };
  }
}

async function runStreamingProbe(
  session: ActivationSession,
  streamingSupported: boolean,
  observedAt: string,
): Promise<ActivationProbeCheck> {
  if (!streamingSupported) {
    return {
      status: 'skipped',
      detail: 'Streaming probe skipped because the current capability snapshot does not advertise streaming support.',
      observedAt,
    };
  }

  let tokenCount = 0;
  try {
    await session.complete('Reply with exactly STREAM.', {
      temperature: 0,
      maxTokens: 8,
      onToken: () => {
        tokenCount += 1;
      },
    });
    return {
      status: tokenCount > 0 ? 'passed' : 'failed',
      detail:
        tokenCount > 0
          ? 'Streaming probe observed token callbacks during generation.'
          : 'Streaming probe completed without emitting any token callbacks.',
      observedAt,
    };
  } catch (error) {
    return {
      status: 'failed',
      detail: `Streaming probe failed: ${toProbeErrorDetail(error)}`,
      observedAt,
    };
  }
}

async function runStructuredJsonProbe(
  session: ActivationSession,
  observedAt: string,
): Promise<ActivationProbeCheck> {
  try {
    const result = await session.complete(
      'Return exactly this JSON object and nothing else: {"ok":true}',
      {
        temperature: 0,
        maxTokens: 32,
        responseFormat: 'json',
      },
    );
    const parsed = tryParseProbeJson(result.text);
    const passed = Boolean(parsed && typeof parsed === 'object' && parsed.ok === true);
    return {
      status: passed ? 'passed' : 'failed',
      detail: passed
        ? 'Structured JSON probe returned parseable JSON in the expected shape.'
        : `Structured JSON probe returned non-parseable or unexpected JSON: ${result.text.trim() || '<empty>'}`,
      observedAt,
    };
  } catch (error) {
    return {
      status: 'failed',
      detail: `Structured JSON probe failed: ${toProbeErrorDetail(error)}`,
      observedAt,
    };
  }
}

async function runVisionReadinessProbe(
  session: ActivationSession,
  shouldCheck: boolean,
  observedAt: string,
): Promise<ActivationProbeCheck> {
  if (!shouldCheck) {
    return {
      status: 'skipped',
      detail: 'Vision readiness probe skipped because the model/session does not currently present itself as an image-capable stack.',
      observedAt,
    };
  }

  try {
    const readiness = await session.probeVisionReadiness();
    return {
      status: readiness.ready ? 'passed' : 'failed',
      detail: readiness.detail,
      observedAt,
    };
  } catch (error) {
    return {
      status: 'failed',
      detail: `Vision readiness probe failed: ${toProbeErrorDetail(error)}`,
      observedAt,
    };
  }
}

function tryParseProbeJson(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const direct = safeJsonParse(trimmed);
  if (direct && typeof direct === 'object') {
    return direct;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    const parsed = safeJsonParse(fencedMatch[1].trim());
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    const parsed = safeJsonParse(objectMatch[0]);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  }

  return null;
}

function safeJsonParse(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toProbeErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
