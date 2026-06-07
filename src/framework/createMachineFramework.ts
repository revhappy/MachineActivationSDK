import type { ActivationRuntime } from '../activation/activationAdapter';
import {
  createActivationManager,
  type ActivationManager,
  type ActivationManagerOptions,
} from '../activation/activationManager';
import {
  createCustomAppActivationClient,
  type CustomAppActivationClient,
} from '../activation/customAppSdk';

export interface MachineActivationSdk {
  activationManager: ActivationManager;
  createActivationClient: () => CustomAppActivationClient;
}

export function createMachineActivationSdk(
  runtime: ActivationRuntime | ActivationRuntime[],
  options: ActivationManagerOptions = {},
): MachineActivationSdk {
  const activationManager = createActivationManager(runtime, options);

  return {
    activationManager,
    createActivationClient: () => createCustomAppActivationClient(activationManager),
  };
}

export type MachineFramework = MachineActivationSdk;

export const createMachineFramework = createMachineActivationSdk;
