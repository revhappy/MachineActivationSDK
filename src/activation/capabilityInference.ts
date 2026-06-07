import {
  DEFAULT_ACTIVATION_CAPABILITY_REGISTRY,
  type ActivationCapabilityRegistry,
  type CapabilityInferenceInput,
  type CapabilityInferenceResult,
} from './capabilityRegistry';

export function inferKnownModelCapabilities(
  input: CapabilityInferenceInput,
  registry: ActivationCapabilityRegistry = DEFAULT_ACTIVATION_CAPABILITY_REGISTRY,
): CapabilityInferenceResult {
  return registry.infer(input);
}
