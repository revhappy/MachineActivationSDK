import type { ModelCapabilityDeclaration } from './activationContract';
import { DEFAULT_ACTIVATION_CAPABILITY_CATALOG } from './generated/defaultCapabilityCatalog';

export interface CapabilityInferenceInput {
  modelId?: string;
  filePath: string;
  architecture?: string;
  projectorPath?: string | null;
}

export interface CapabilityInferenceResult {
  inferredFields: Partial<
    Pick<
      ModelCapabilityDeclaration,
      'inputModalities' | 'structuredJsonOutput' | 'toolCalling' | 'requiresProjector'
    >
  >;
  notes: string[];
}

export interface ActivationCapabilityRegistryEntry {
  id: string;
  match: RegExp;
  infer: (input: CapabilityInferenceInput) => CapabilityInferenceResult;
}

export interface ActivationCapabilityCatalogEntry {
  id: string;
  matchPattern: string;
  matchFlags?: string;
  structuredJsonOutput?: boolean;
  toolCalling?: boolean;
  forceInputModalities?: ReadonlyArray<'text' | 'image'>;
  imageWhenProjector?: boolean;
  imageWhenPathMatchesPattern?: string;
  imageWhenPathMatchesFlags?: string;
  requiresProjectorWhenImage?: boolean;
  projectorExemptPathPattern?: string;
  projectorExemptPathFlags?: string;
  note: string;
}

export interface ActivationCapabilityRegistry {
  readonly entries: ActivationCapabilityRegistryEntry[];
  infer(input: CapabilityInferenceInput): CapabilityInferenceResult;
}

export function createActivationCapabilityRegistry(
  entries: ActivationCapabilityRegistryEntry[],
): ActivationCapabilityRegistry {
  return {
    entries: [...entries],
    infer(input) {
      const haystack = `${input.modelId ?? ''} ${input.filePath} ${input.architecture ?? ''}`;
      for (const entry of entries) {
        if (entry.match.test(haystack)) {
          return entry.infer(input);
        }
      }

      return {
        inferredFields: {},
        notes: [
          'No Machine Activation SDK registry rule matched this model, so capability inference falls back to backend probing plus conservative defaults.',
        ],
      };
    },
  };
}

export function createActivationCapabilityRegistryFromCatalog(
  catalog: readonly ActivationCapabilityCatalogEntry[],
): ActivationCapabilityRegistry {
  return createActivationCapabilityRegistry(
    catalog.map((entry) => ({
      id: entry.id,
      match: new RegExp(entry.matchPattern, entry.matchFlags),
      infer: (input) => inferCapabilityCatalogEntry(entry, input),
    })),
  );
}

export const DEFAULT_ACTIVATION_CAPABILITY_REGISTRY =
  createActivationCapabilityRegistryFromCatalog(DEFAULT_ACTIVATION_CAPABILITY_CATALOG);

function inferCapabilityCatalogEntry(
  entry: ActivationCapabilityCatalogEntry,
  input: CapabilityInferenceInput,
): CapabilityInferenceResult {
  const inputModalities =
    entry.forceInputModalities ?? resolveCatalogInputModalities(entry, input);
  const imageEnabled = inputModalities.includes('image');
  const projectorExempt = entry.projectorExemptPathPattern
    ? new RegExp(entry.projectorExemptPathPattern, entry.projectorExemptPathFlags).test(
        input.filePath,
      )
    : false;

  return {
    inferredFields: {
      structuredJsonOutput: entry.structuredJsonOutput ?? false,
      toolCalling: entry.toolCalling ?? false,
      inputModalities: [...inputModalities],
      requiresProjector:
        Boolean(entry.requiresProjectorWhenImage) && imageEnabled && !projectorExempt,
    },
    notes: [entry.note],
  };
}

function resolveCatalogInputModalities(
  entry: ActivationCapabilityCatalogEntry,
  input: CapabilityInferenceInput,
): Array<'text' | 'image'> {
  const imageFromProjector = Boolean(entry.imageWhenProjector && input.projectorPath);
  const imageFromPath =
    Boolean(entry.imageWhenPathMatchesPattern) &&
    new RegExp(
      entry.imageWhenPathMatchesPattern!,
      entry.imageWhenPathMatchesFlags,
    ).test(input.filePath);

  return imageFromProjector || imageFromPath ? ['text', 'image'] : ['text'];
}
