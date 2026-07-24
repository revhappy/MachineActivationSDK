import { statSync } from 'node:fs';
import { cpus, freemem, totalmem } from 'node:os';
import { dirname, resolve as pathResolve } from 'node:path';

import {
  resolveCapabilityContract,
  type ActivationAccelerationMode,
  type BackendCapabilityDeclaration,
  type DeviceCapabilityDeclaration,
  type ModelCapabilityDeclaration,
  type ResolvedCapabilityContract,
} from '../../activation/activationContract';
import { estimateModelRuntimeMemoryMb } from '../../activation/activationPlanning';
import { formatParameterCount, type GgufSummary } from '../../model/gguf';
import { readGgufSummary } from '../../model/nodeGguf';
import { createMachine } from '../../sdk/createMachine';
import { generateObject } from '../../sdk/generateObject';
import type { SchemaLike } from '../../sdk/types';
import { getBoolFlag, getStringFlag, parseArgs } from '../args';
import {
  bold,
  dim,
  errorln,
  formatBytes,
  green,
  printJson,
  println,
  red,
  yellow,
} from '../output';
import {
  discoverLlamaServer,
  readVendoredAcceleration,
  startLlamaServerRuntime,
} from './doctorRuntime';

const HELP = `\
machine doctor <model.gguf> [flags]

Answer the questions a local model actually raises: can this run here, will it
fit, how fast is it, what's degraded, and what acceleration is live.

Works offline against a file on disk — no catalog, no account, no network.

Flags:
  --run                 Actually load the model and measure it (needs llama-server).
  --server <path>       Path to llama-server[.exe]. Defaults to $MACHINE_LLAMA_SERVER
                        or a vendored build under ./vendor/llama-cpp/.
  --gpu-layers <n>      Layers to offload when running (default: 0 = CPU).
  --ctx <n>             Context size for the live run (default: 4096).
  --prompt <text>       Prompt for the live run.
  --json                Emit JSON instead of human text.
  --help                Show this message.
`;

/** What the live run measured, when `--run` was passed. */
interface LiveRunReport {
  ok: boolean;
  backendId?: string;
  accelerationMode?: ActivationAccelerationMode;
  loadSeconds?: number;
  /** Prompt-evaluation latency: request sent → first token out. */
  timeToFirstTokenSeconds?: number;
  tokensGenerated?: number;
  tokensPerSecond?: number;
  sample?: string;
  grammarConstrainedJson?: boolean;
  structuredSample?: unknown;
  error?: string;
  logHighlights?: string[];
}

interface DoctorReport {
  model: {
    path: string;
    fileSizeBytes: number;
    gguf: GgufSummary;
  };
  device: {
    platform: string;
    arch: string;
    cpuCount: number;
    cpuModel?: string;
    totalMemoryMb: number;
    availableMemoryMb: number;
  };
  contract: ResolvedCapabilityContract;
  liveRun?: LiveRunReport;
  verdict: 'ready' | 'tight' | 'not-recommended';
}

export async function runDoctor(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    println(HELP);
    return 0;
  }

  const args = parseArgs(argv);
  const target = args.positionals[0];
  if (!target) {
    errorln(red('doctor: missing model path'));
    errorln(HELP);
    return 2;
  }

  const json = getBoolFlag(args, 'json', false);
  const modelPath = pathResolve(target);

  let fileSizeBytes: number;
  try {
    const stat = statSync(modelPath);
    if (!stat.isFile()) {
      errorln(red(`doctor: ${modelPath} is not a file. Point me at a .gguf.`));
      return 2;
    }
    fileSizeBytes = stat.size;
  } catch {
    errorln(red(`doctor: cannot read ${modelPath}`));
    return 2;
  }

  let gguf: GgufSummary;
  try {
    gguf = readGgufSummary(modelPath);
  } catch (error) {
    errorln(red(`doctor: ${error instanceof Error ? error.message : String(error)}`));
    return 1;
  }

  const device = probeDevice();
  const wantsRun = getBoolFlag(args, 'run', false);
  const gpuLayers = Number(getStringFlag(args, 'gpu-layers', '0'));
  const contextTokens = Number(getStringFlag(args, 'ctx', '4096'));

  const serverBinary =
    getStringFlag(args, 'server') ??
    discoverLlamaServer(process.cwd(), dirname(modelPath)) ??
    undefined;

  const backend = describeBackend(serverBinary, gpuLayers > 0);
  const contract = resolveCapabilityContract({
    appRequirements: {
      textCompletion: true,
      textChat: true,
      streaming: true,
      structuredJsonOutput: true,
    },
    model: describeModel(modelPath, fileSizeBytes, gguf),
    backend,
    device: toDeviceDeclaration(device),
  });

  let liveRun: LiveRunReport | undefined;
  if (wantsRun) {
    liveRun = await runLive({
      modelPath,
      serverBinary,
      gpuLayers,
      contextTokens,
      prompt: getStringFlag(args, 'prompt') ?? 'In one sentence, what is a local LLM?',
    });
  }

  const report: DoctorReport = {
    model: { path: modelPath, fileSizeBytes, gguf },
    device,
    contract,
    liveRun,
    verdict: decideVerdict(contract, liveRun),
  };

  if (json) {
    printJson(report);
  } else {
    printHuman(report, serverBinary, wantsRun);
  }

  if (report.verdict === 'not-recommended') return 1;
  if (liveRun && !liveRun.ok) return 1;
  return 0;
}

interface DeviceInfo {
  platform: string;
  arch: string;
  cpuCount: number;
  cpuModel?: string;
  totalMemoryMb: number;
  availableMemoryMb: number;
}

function probeDevice(): DeviceInfo {
  const cores = cpus();
  return {
    platform: process.platform,
    arch: process.arch,
    cpuCount: cores.length,
    cpuModel: cores[0]?.model?.trim(),
    totalMemoryMb: Math.round(totalmem() / (1024 * 1024)),
    availableMemoryMb: Math.round(freemem() / (1024 * 1024)),
  };
}

function toDeviceDeclaration(device: DeviceInfo): DeviceCapabilityDeclaration {
  return {
    platform: `${device.platform}/${device.arch}`,
    cameraAvailable: false,
    photoLibraryAvailable: false,
    // Desktop hosts always have CPU; GPU is claimed only when a build that
    // supports it is actually vendored (see describeBackend).
    availableAccelerationModes: ['cpu'],
    totalMemoryMb: device.totalMemoryMb,
    availableMemoryMb: device.availableMemoryMb,
    notes: device.cpuModel ? [device.cpuModel] : [],
  };
}

function describeModel(
  modelPath: string,
  fileSizeBytes: number,
  gguf: GgufSummary,
): ModelCapabilityDeclaration {
  const model: ModelCapabilityDeclaration = {
    modelPath,
    modelFormat: 'gguf',
    architecture: gguf.architecture,
    fileSizeBytes,
    inputModalities: ['text'],
    outputModalities: ['text'],
    contextWindowTokens: gguf.contextLengthTokens,
    supportsTextCompletion: true,
    // A base model without a chat template will "work" and produce nonsense
    // for chat-shaped prompts, which is worth saying out loud.
    supportsTextChat: gguf.hasChatTemplate,
    supportsStreaming: true,
    structuredJsonOutput: true,
    toolCalling: gguf.hasChatTemplate,
    requiresProjector: false,
    projectorAttached: false,
    notes: [],
  };
  model.estimatedRuntimeMemoryMb = estimateModelRuntimeMemoryMb(model);
  return model;
}

/**
 * Describe the llama.cpp backend profile.
 *
 * Note this describes the backend's *capabilities*, not whether a binary
 * happens to be installed on this machine. Those are different questions and
 * conflating them made `doctor` report a perfectly good model as
 * "not recommended" purely because no binary had been vendored yet. Whether a
 * runtime is present is reported separately, as an advisory.
 */
function describeBackend(
  serverBinary: string | undefined,
  gpuRequested: boolean,
): BackendCapabilityDeclaration {
  if (!serverBinary) {
    return {
      backendId: 'llama-server',
      backendName: 'llama.cpp llama-server (not installed here)',
      sessionCreationAvailable: true,
      supportsStreaming: true,
      supportsVision: false,
      supportsStructuredJsonOutput: true,
      supportsToolCalling: true,
      supportsCancellation: true,
      supportedAccelerationModes: ['cpu'],
      detectedDevices: [],
      notes: ['No llama-server binary discovered on this machine.'],
    };
  }

  const vendored = readVendoredAcceleration(serverBinary);
  const modes: ActivationAccelerationMode[] =
    gpuRequested && vendored.acceleration !== 'cpu'
      ? [vendored.acceleration, 'cpu']
      : ['cpu'];

  return {
    backendId: 'llama-server',
    backendName: 'llama.cpp llama-server (subprocess)',
    backendVersion: vendored.build,
    sessionCreationAvailable: true,
    supportsStreaming: true,
    supportsVision: false,
    supportsStructuredJsonOutput: true,
    supportsToolCalling: true,
    supportsCancellation: true,
    supportedAccelerationModes: modes,
    detectedDevices: [],
    notes: [serverBinary],
  };
}

interface LiveRunInput {
  modelPath: string;
  serverBinary?: string;
  gpuLayers: number;
  contextTokens: number;
  prompt: string;
}

/** Schema for the structured-output probe. Hand-rolled so `doctor` needs no
 *  zod — it only has to prove that grammar-constrained decoding produces
 *  parseable JSON in the declared shape. */
const probeSchema: SchemaLike<{ language: string; confidence: number }> = {
  parse(value: unknown) {
    const obj = value as { language?: unknown; confidence?: unknown };
    if (typeof obj?.language !== 'string' || typeof obj?.confidence !== 'number') {
      throw new Error('probe schema mismatch');
    }
    return { language: obj.language, confidence: obj.confidence };
  },
  toJsonSchema: () => ({
    type: 'object',
    properties: {
      language: { type: 'string' },
      confidence: { type: 'number' },
    },
    required: ['language', 'confidence'],
  }),
};

async function runLive(input: LiveRunInput): Promise<LiveRunReport> {
  if (!input.serverBinary) {
    return {
      ok: false,
      error:
        'No llama-server binary found. Pass --server <path> or set MACHINE_LLAMA_SERVER.',
    };
  }

  const startedLoad = Date.now();
  let handle: Awaited<ReturnType<typeof startLlamaServerRuntime>> | undefined;

  try {
    handle = await startLlamaServerRuntime({
      serverBinary: input.serverBinary,
      modelPath: input.modelPath,
      contextTokens: input.contextTokens,
      gpuLayers: input.gpuLayers,
    });
    const loadSeconds = (Date.now() - startedLoad) / 1000;

    const machine = createMachine({ runtimes: handle.runtime });
    const model = machine.model({ filePath: input.modelPath });

    // Stream rather than generate: it proves tokens actually arrive
    // incrementally AND lets us time the first one. Prompt evaluation and
    // decoding have very different costs on CPU, and a single blended
    // "tokens/sec" hides which one is hurting.
    const { streamText } = await import('../../sdk/streamText');
    const requestedAt = Date.now();
    let firstTokenAt = 0;
    const stream = streamText({ model, prompt: input.prompt, maxTokens: 96 });
    for await (const _delta of stream.textStream) {
      if (firstTokenAt === 0) firstTokenAt = Date.now();
    }
    const sampleText = await stream.text;
    const usage = await stream.usage;
    const diagnostics = await model.getSession().then((s) => s.diagnostics());

    // Structured output: proves GBNF actually reaches the backend. This is
    // the differentiated path, so it gets tested explicitly rather than
    // assumed from a capability flag.
    let grammarConstrainedJson = false;
    let structuredSample: unknown;
    try {
      const structured = await generateObject({
        model,
        schema: probeSchema,
        prompt:
          'Identify the language of this text and how confident you are from 0 to 1: "Bonjour, comment allez-vous?"',
        maxTokens: 96,
      });
      grammarConstrainedJson = true;
      structuredSample = structured.object;
    } catch (error) {
      structuredSample = {
        error: error instanceof Error ? error.message : String(error),
      };
    }

    await machine.close();

    return {
      ok: true,
      backendId: diagnostics.backendId,
      accelerationMode: diagnostics.accelerationMode,
      loadSeconds,
      timeToFirstTokenSeconds:
        firstTokenAt > 0 ? (firstTokenAt - requestedAt) / 1000 : undefined,
      tokensGenerated: usage.completionTokens,
      tokensPerSecond: usage.tokensPerSecond,
      sample: sampleText.trim().slice(0, 240),
      grammarConstrainedJson,
      structuredSample,
      logHighlights: highlightLogs(handle.logs),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      logHighlights: handle ? highlightLogs(handle.logs) : undefined,
    };
  } finally {
    await handle?.close();
  }
}

/** Pull the device/backend lines out of llama.cpp's very chatty startup log —
 *  these are what tell you whether Metal/CUDA/Vulkan is actually live. */
function highlightLogs(logs: string[]): string[] {
  const interesting =
    /(load_tensors|llama_context|ggml_(metal|cuda|vulkan|blas)|using device|offloaded|n_ctx|CPU buffer size|model size|BLAS)/i;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of logs) {
    if (!interesting.test(line)) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
    if (out.length >= 12) break;
  }
  return out;
}

function decideVerdict(
  contract: ResolvedCapabilityContract,
  liveRun: LiveRunReport | undefined,
): DoctorReport['verdict'] {
  if (liveRun && !liveRun.ok) return 'not-recommended';
  const memory = contract.memoryAssessment.status;
  if (!contract.compatible || memory === 'insufficient') return 'not-recommended';
  if (contract.degraded || memory === 'tight') return 'tight';
  return 'ready';
}

function printHuman(
  report: DoctorReport,
  serverBinary: string | undefined,
  wantsRun: boolean,
): void {
  const { gguf } = report.model;

  println(bold(gguf.name ?? report.model.path));
  println(`  path:           ${report.model.path}`);
  println(`  size:           ${formatBytes(report.model.fileSizeBytes)}`);
  println(`  architecture:   ${gguf.architecture ?? 'unknown'}`);
  println(`  quantization:   ${gguf.quantization ?? 'unknown'}`);
  const params = formatParameterCount(gguf.parameterCount);
  if (params) println(`  parameters:     ${params}`);
  if (gguf.contextLengthTokens) {
    println(`  context:        ${gguf.contextLengthTokens.toLocaleString()} tokens`);
  }
  println(
    `  chat template:  ${
      gguf.hasChatTemplate
        ? green('present')
        : yellow('absent (base model — chat prompts will drift)')
    }`,
  );

  println('');
  println(bold('Device'));
  println(`  platform:       ${report.device.platform}/${report.device.arch}`);
  if (report.device.cpuModel) {
    println(`  cpu:            ${report.device.cpuModel} ${dim(`(${report.device.cpuCount} cores)`)}`);
  }
  println(
    `  memory:         ${report.device.availableMemoryMb.toLocaleString()} MB free of ${report.device.totalMemoryMb.toLocaleString()} MB`,
  );
  println(
    `  runtime:        ${
      serverBinary ??
      yellow('no llama-server found — pass --server or set MACHINE_LLAMA_SERVER')
    }`,
  );

  println('');
  println(bold('Fit'));
  const memory = report.contract.memoryAssessment;
  if (memory.estimatedModelFootprintMb) {
    println(`  est. footprint: ${memory.estimatedModelFootprintMb.toLocaleString()} MB`);
  }
  if (memory.recommendedMinimumMemoryMb) {
    println(`  recommended:    ${memory.recommendedMinimumMemoryMb.toLocaleString()} MB free`);
  }
  println(`  assessment:     ${statusColor(memory.status)}`);
  println(`  ${dim(memory.detail)}`);

  const caps = report.contract.resolvedCapabilities;
  println('');
  println(bold('Resolved capabilities'));
  println(`  acceleration:   ${caps.accelerationMode}`);
  println(`  chat:           ${yesNo(caps.textChat)}`);
  println(`  streaming:      ${yesNo(caps.streaming)}`);
  println(`  structured:     ${yesNo(caps.structuredJsonOutput)}`);
  println(`  tools:          ${yesNo(caps.toolCalling)}`);

  if (report.contract.reasons.length > 0) {
    println('');
    println(bold('Blockers'));
    for (const reason of report.contract.reasons) println(`  ${red('x')} ${reason}`);
  }
  if (report.contract.warnings.length > 0) {
    println('');
    println(bold('Warnings'));
    for (const warning of report.contract.warnings) println(`  ${yellow('!')} ${warning}`);
  }

  if (report.liveRun) {
    println('');
    println(bold('Live run'));
    if (!report.liveRun.ok) {
      println(`  ${red('failed')}: ${report.liveRun.error}`);
    } else {
      println(`  load time:      ${report.liveRun.loadSeconds?.toFixed(1)}s`);
      if (report.liveRun.timeToFirstTokenSeconds !== undefined) {
        println(`  first token:    ${report.liveRun.timeToFirstTokenSeconds.toFixed(2)}s`);
      }
      println(`  throughput:     ${report.liveRun.tokensPerSecond?.toFixed(1)} tok/s ${dim(`(${report.liveRun.tokensGenerated} tokens, decode only)`)}`);
      println(`  acceleration:   ${report.liveRun.accelerationMode}`);
      println(
        `  grammar JSON:   ${
          report.liveRun.grammarConstrainedJson ? green('works') : red('failed')
        }`,
      );
      if (report.liveRun.sample) {
        println(`  ${dim(`sample: ${report.liveRun.sample.replace(/\s+/g, ' ')}`)}`);
      }
      if (report.liveRun.structuredSample) {
        println(`  ${dim(`structured: ${JSON.stringify(report.liveRun.structuredSample)}`)}`);
      }
    }
    if (report.liveRun.logHighlights?.length) {
      println('');
      for (const line of report.liveRun.logHighlights) println(`  ${dim(line)}`);
    }
  } else if (!wantsRun) {
    println('');
    println(dim('  Static analysis only. Re-run with --run to load the model and measure it.'));
  }

  println('');
  println(bold(`Verdict: ${verdictLabel(report.verdict)}`));
}

function statusColor(status: string): string {
  if (status === 'supported') return green(status);
  if (status === 'insufficient') return red(status);
  if (status === 'tight') return yellow(status);
  return dim(status);
}

function yesNo(value: boolean): string {
  return value ? green('yes') : yellow('no');
}

function verdictLabel(verdict: DoctorReport['verdict']): string {
  if (verdict === 'ready') return green('ready');
  if (verdict === 'tight') return yellow('tight — it should run, with caveats');
  return red('not recommended on this device');
}
