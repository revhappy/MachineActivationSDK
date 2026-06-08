import type {
  ActivationRuntime,
  ActivationSession,
  ActivationSessionCreateInput,
} from '../activation/activationAdapter';
import type { ActivationCapabilitySnapshot } from '../activation/activationContract';
import type { CartridgeResolver } from '../catalog/types';
import {
  cartridgeToActivationInput,
  type CartridgeToActivationInputOptions,
} from '../cartridge/toActivationInput';
import type { LoadedCartridge } from '../cartridge/types';
import {
  createMachineActivationSdk,
  type MachineActivationSdk,
} from '../framework/createMachineFramework';
import type { ActivationManagerOptions } from '../activation/activationManager';
import type { CustomAppActivationClient } from '../activation/customAppSdk';
import type { MachineModel, ModelSpec } from './types';

export interface CreateMachineOptions extends ActivationManagerOptions {
  runtimes: ActivationRuntime | ActivationRuntime[];
  /** Default compatibility policy passed to activateModel. */
  compatibilityPolicy?: 'permissive' | 'strict';
  /**
   * Resolver for `{ cartridge: "id" }` specs. In Node, use
   * `createNodeCartridgeResolver()`. Without one, `machine.model({ cartridge })`
   * will throw on first use.
   */
  cartridgeResolver?: CartridgeResolver;
}

export interface Machine {
  readonly activationSdk: MachineActivationSdk;
  readonly activationClient: CustomAppActivationClient;
  model(spec: ModelSpec): MachineModel;
  /**
   * Build a MachineModel from a preloaded cartridge. Call `loadCartridge()`
   * first (it's async + FS-dependent), then pass the result here.
   */
  modelFromCartridge(
    cartridge: LoadedCartridge,
    options?: CartridgeToActivationInputOptions,
  ): MachineModel;
  close(): Promise<void>;
}

export function createMachine(options: CreateMachineOptions): Machine {
  const { runtimes, compatibilityPolicy, cartridgeResolver, ...managerOptions } = options;
  const activationSdk = createMachineActivationSdk(runtimes, managerOptions);
  const activationClient = activationSdk.createActivationClient();

  const models = new Map<string, MachineModel>();

  function keyOf(spec: ModelSpec): string {
    if ('cartridge' in spec) {
      return `cartridge::${spec.cartridge}::${spec.version ?? ''}::${spec.modelId ?? ''}`;
    }
    return [
      'file',
      spec.filePath,
      spec.modelId ?? '',
      spec.projectorPath ?? '',
      spec.runtimeHint ?? '',
      spec.modelFormatHint ?? '',
    ].join('::');
  }

  function toFileSessionInput(spec: Extract<ModelSpec, { filePath: string }>): ActivationSessionCreateInput {
    return {
      modelId: spec.modelId,
      filePath: spec.filePath,
      projectorPath: spec.projectorPath,
      runtimeHint: spec.runtimeHint,
      modelFormatHint: spec.modelFormatHint,
      contextWindowTokens: spec.contextWindowTokens,
    };
  }

  function createModel(spec: ModelSpec): MachineModel {
    const key = keyOf(spec);
    const existing = models.get(key);
    if (existing) {
      return existing;
    }

    let sessionPromise: Promise<ActivationSession> | null = null;
    let snapshotPromise: Promise<ActivationCapabilitySnapshot> | null = null;
    let resolvedInputPromise: Promise<ActivationSessionCreateInput> | null = null;

    async function resolveInput(): Promise<ActivationSessionCreateInput> {
      if ('cartridge' in spec) {
        if (!cartridgeResolver) {
          throw new Error(
            'createMachine({ cartridge: "..." }) requires a cartridgeResolver. '
              + 'In Node, pass `cartridgeResolver: createNodeCartridgeResolver()` '
              + 'from @revhappy/activation-sdk. See CARTRIDGE_SDK_ROADMAP.md M4.',
          );
        }
        const resolverSpec: { id: string; version?: string } = { id: spec.cartridge };
        if (spec.version !== undefined) resolverSpec.version = spec.version;
        const loaded = await cartridgeResolver(resolverSpec);
        const base = cartridgeToActivationInput(loaded);
        if (spec.modelId !== undefined) {
          return { ...base, modelId: spec.modelId };
        }
        return base;
      }
      return toFileSessionInput(spec);
    }

    function getResolvedInput(): Promise<ActivationSessionCreateInput> {
      if (!resolvedInputPromise) {
        resolvedInputPromise = resolveInput();
      }
      return resolvedInputPromise;
    }

    const model: MachineModel = {
      modelId: 'cartridge' in spec
        ? spec.modelId ?? spec.cartridge
        : spec.modelId ?? spec.filePath,
      spec,
      async getSession(): Promise<ActivationSession> {
        if (!sessionPromise) {
          sessionPromise = getResolvedInput().then((input) =>
            activationClient.activateModel(input, { compatibilityPolicy }),
          );
        }
        return sessionPromise;
      },
      async getSnapshot(): Promise<ActivationCapabilitySnapshot> {
        if (!snapshotPromise) {
          snapshotPromise = getResolvedInput().then((input) =>
            activationClient.diagnoseModel({
              model: {
                modelId: input.modelId,
                filePath: input.filePath,
                projectorPath: input.projectorPath,
                runtimeHint: input.runtimeHint,
                modelFormatHint: input.modelFormatHint,
              },
            }),
          );
        }
        return snapshotPromise;
      },
      async close(): Promise<void> {
        if (sessionPromise) {
          const pending = sessionPromise;
          sessionPromise = null;
          snapshotPromise = null;
          resolvedInputPromise = null;
          try {
            const session = await pending;
            await session.close();
          } catch {
            // closing a failed/aborted session is best-effort
          }
        }
        models.delete(key);
      },
    };

    models.set(key, model);
    return model;
  }

  function createModelFromCartridge(
    cartridge: LoadedCartridge,
    bridgeOptions?: CartridgeToActivationInputOptions,
  ): MachineModel {
    const activationInput = cartridgeToActivationInput(cartridge, bridgeOptions);
    const spec: ModelSpec = {
      filePath: activationInput.filePath,
      modelId: activationInput.modelId ?? cartridge.manifest.id,
      ...(activationInput.projectorPath !== undefined
        ? { projectorPath: activationInput.projectorPath }
        : {}),
      ...(activationInput.runtimeHint !== undefined
        ? { runtimeHint: activationInput.runtimeHint }
        : {}),
      ...(activationInput.modelFormatHint !== undefined
        ? { modelFormatHint: activationInput.modelFormatHint }
        : {}),
      ...(activationInput.contextWindowTokens !== undefined
        ? { contextWindowTokens: activationInput.contextWindowTokens }
        : {}),
    };

    const key = keyOf(spec);
    const existing = models.get(key);
    if (existing) {
      return existing;
    }

    let sessionPromise: Promise<ActivationSession> | null = null;
    let snapshotPromise: Promise<ActivationCapabilitySnapshot> | null = null;

    const model: MachineModel = {
      modelId: spec.modelId ?? cartridge.manifest.id,
      spec,
      async getSession(): Promise<ActivationSession> {
        if (!sessionPromise) {
          sessionPromise = activationClient.activateModel(activationInput, {
            compatibilityPolicy,
          });
        }
        return sessionPromise;
      },
      async getSnapshot(): Promise<ActivationCapabilitySnapshot> {
        if (!snapshotPromise) {
          snapshotPromise = activationClient.diagnoseModel({
            model: {
              modelId: activationInput.modelId,
              filePath: activationInput.filePath,
              projectorPath: activationInput.projectorPath,
              runtimeHint: activationInput.runtimeHint,
              modelFormatHint: activationInput.modelFormatHint,
            },
          });
        }
        return snapshotPromise;
      },
      async close(): Promise<void> {
        if (sessionPromise) {
          const pending = sessionPromise;
          sessionPromise = null;
          snapshotPromise = null;
          try {
            const session = await pending;
            await session.close();
          } catch {
            // best-effort
          }
        }
        models.delete(key);
      },
    };

    models.set(key, model);
    return model;
  }

  return {
    activationSdk,
    activationClient,
    model: createModel,
    modelFromCartridge: createModelFromCartridge,
    async close(): Promise<void> {
      const pending = Array.from(models.values()).map((m) => m.close());
      await Promise.all(pending);
    },
  };
}
