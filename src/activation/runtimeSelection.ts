import type { ActivationModelProbeInput, ActivationRuntime } from './activationAdapter';

const FORMAT_ALIASES: Record<string, string> = {
  '.gguf': 'gguf',
  '.litertlm': 'litert-lm',
  '.task': 'litert-lm',
};

export function detectActivationModelFormat(
  filePath: string,
  explicitFormat?: string | null,
): string {
  if (explicitFormat && explicitFormat.trim().length > 0) {
    return normalizeModelFormat(explicitFormat);
  }

  const lowerPath = filePath.toLowerCase();
  for (const [suffix, format] of Object.entries(FORMAT_ALIASES)) {
    if (lowerPath.endsWith(suffix)) {
      return format;
    }
  }

  const extensionMatch = lowerPath.match(/(\.[a-z0-9]+)$/i);
  return extensionMatch ? extensionMatch[1].replace(/^\./, '') : 'unknown';
}

export function normalizeModelFormat(value: string): string {
  const normalized = value.trim().toLowerCase();
  return FORMAT_ALIASES[normalized as keyof typeof FORMAT_ALIASES] ?? normalized;
}

export function runtimeSupportsActivationInput(
  runtime: ActivationRuntime,
  input: ActivationModelProbeInput,
): boolean {
  if (runtime.canHandleModel) {
    return runtime.canHandleModel(input);
  }

  if (!runtime.supportedModelFormats || runtime.supportedModelFormats.length === 0) {
    return true;
  }

  const inputFormat = detectActivationModelFormat(input.filePath, input.modelFormatHint);
  return runtime.supportedModelFormats
    .map(normalizeModelFormat)
    .includes(inputFormat);
}

export function selectActivationRuntime(
  runtimes: ActivationRuntime[],
  input: ActivationModelProbeInput,
): ActivationRuntime {
  if (runtimes.length === 0) {
    throw new Error('At least one activation runtime must be provided.');
  }

  if (input.runtimeHint) {
    const hinted = runtimes.find((runtime) => runtime.id === input.runtimeHint);
    if (hinted) {
      return hinted;
    }
  }

  const compatibleRuntimes = runtimes.filter((runtime) =>
    runtimeSupportsActivationInput(runtime, input),
  );

  if (compatibleRuntimes.length === 0) {
    return runtimes[0];
  }

  if (compatibleRuntimes.length === 1) {
    return compatibleRuntimes[0];
  }

  const inputFormat = detectActivationModelFormat(input.filePath, input.modelFormatHint);
  return [...compatibleRuntimes].sort((left, right) => {
    const leftScore = scoreRuntimeForFormat(left, inputFormat);
    const rightScore = scoreRuntimeForFormat(right, inputFormat);
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }

    return 0;
  })[0];
}

function scoreRuntimeForFormat(runtime: ActivationRuntime, inputFormat: string): number {
  const haystack = `${runtime.id} ${runtime.name}`.toLowerCase();

  if (inputFormat === 'gguf') {
    if (haystack.includes('llama')) {
      return 100;
    }
    return 10;
  }

  if (inputFormat === 'litert-lm') {
    if (haystack.includes('litert')) {
      return 100;
    }
    return 10;
  }

  return 0;
}
