import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin, resolve as pathResolve } from 'node:path';

import { loadCartridge } from '../../cartridge';
import type { LoadedCartridge } from '../../cartridge';
import { createNodeCartridgeFileSystem } from '../../cartridge/nodeFs';
import { createNodeCartridgeZipAdapter } from '../../cartridge/nodeZip';
import { unpackCartridge } from '../../cartridge/nodeUnpackCartridge';
import { getBoolFlag, parseArgs } from '../args';
import { bold, dim, errorln, formatBytes, printJson, println, red } from '../output';

const HELP = `\
machine info <file|dir> [--json]

Print a human-readable summary of a cartridge. Accepts an extracted directory
OR a .mcart zip.

Flags:
  --json    Emit JSON instead of human text.
  --help    Show this message.
`;

export async function runInfo(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    println(HELP);
    return 0;
  }

  const args = parseArgs(argv);
  const target = args.positionals[0];
  if (!target) {
    errorln(red('info: missing input path'));
    errorln(HELP);
    return 2;
  }

  const json = getBoolFlag(args, 'json', false);
  const inputPath = pathResolve(target);

  let workingDir = inputPath;
  let tempDir: string | undefined;

  try {
    if (isFile(inputPath)) {
      tempDir = mkdtempSync(pathJoin(tmpdir(), 'mcart-info-'));
      await unpackCartridge(inputPath, tempDir, {
        zip: createNodeCartridgeZipAdapter(),
        verify: false,
      });
      workingDir = tempDir;
    }

    const cartridge = await loadCartridge(workingDir, {
      fs: createNodeCartridgeFileSystem(),
    });

    if (json) {
      printJson(summarize(cartridge));
    } else {
      printHuman(cartridge);
    }
    return 0;
  } catch (error) {
    errorln(red(`info: ${error instanceof Error ? error.message : String(error)}`));
    return 1;
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}

function summarize(cartridge: LoadedCartridge): Record<string, unknown> {
  const m = cartridge.manifest;
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    schemaVersion: m.schemaVersion,
    author: m.author ?? null,
    license: m.license ?? null,
    description: m.description ?? null,
    weights: m.weights,
    capabilities: m.capabilities,
    requirements: m.requirements ?? null,
    presetCount: {
      systemPrompts: m.presets?.systemPrompts?.length ?? 0,
      examples: m.presets?.examples?.length ?? 0,
    },
  };
}

function printHuman(cartridge: LoadedCartridge): void {
  const m = cartridge.manifest;
  println(bold(`${m.name} ${dim(`(${m.id})`)}`));
  println(`  version:        ${m.version}`);
  println(`  schemaVersion:  ${m.schemaVersion}`);
  if (m.author) println(`  author:         ${m.author.name}${m.author.url ? ` <${m.author.url}>` : ''}`);
  if (m.license) println(`  license:        ${m.license}`);
  if (m.description) println(`  description:    ${m.description}`);
  println('');
  println(bold('Weights'));
  println(`  format:         ${m.weights.format}`);
  println(`  path:           ${m.weights.path}`);
  println(`  size:           ${formatBytes(m.weights.sizeBytes)}`);
  println(`  sha256:         ${m.weights.sha256}`);
  if (m.weights.quantization) println(`  quantization:   ${m.weights.quantization}`);
  if (m.weights.projectorPath) println(`  projector:      ${m.weights.projectorPath}`);
  println('');
  println(bold('Capabilities'));
  println(`  input:          ${m.capabilities.inputModalities.join(', ')}`);
  println(`  output:         ${m.capabilities.outputModalities.join(', ')}`);
  if (m.capabilities.contextWindowTokens !== undefined) {
    println(`  ctx tokens:     ${m.capabilities.contextWindowTokens}`);
  }
  println(`  flags:          ${flagSummary(m.capabilities)}`);
  if (m.requirements) {
    println('');
    println(bold('Requirements'));
    if (m.requirements.estimatedRuntimeMemoryMb !== undefined) {
      println(`  est. memory:    ${m.requirements.estimatedRuntimeMemoryMb} MB`);
    }
    if (m.requirements.minDeviceMemoryMb !== undefined) {
      println(`  min device:     ${m.requirements.minDeviceMemoryMb} MB`);
    }
    if (m.requirements.preferredAcceleration?.length) {
      println(`  acceleration:   ${m.requirements.preferredAcceleration.join(', ')}`);
    }
  }
  if (m.presets?.systemPrompts?.length || m.presets?.examples?.length) {
    println('');
    println(bold('Presets'));
    println(`  system prompts: ${m.presets.systemPrompts?.length ?? 0}`);
    println(`  examples:       ${m.presets.examples?.length ?? 0}`);
  }
}

function flagSummary(c: LoadedCartridge['manifest']['capabilities']): string {
  const flags: string[] = [];
  if (c.supportsTextCompletion) flags.push('completion');
  if (c.supportsTextChat) flags.push('chat');
  if (c.supportsStreaming) flags.push('streaming');
  if (c.structuredJsonOutput) flags.push('json');
  if (c.toolCalling) flags.push('tools');
  return flags.length > 0 ? flags.join(', ') : '(none)';
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
