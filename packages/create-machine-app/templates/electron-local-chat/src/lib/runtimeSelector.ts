import type { ActivationRuntime } from '@revhappy/activation-sdk';
import { ipcRuntime } from '../ipcRuntime';
import { mediaPipeRuntime } from './mediaPipeRuntime';

export type ModelFormat = 'gguf' | 'task' | 'litertlm' | 'unknown';

export function detectModelFormat(filePath: string): ModelFormat {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.gguf')) return 'gguf';
  if (lower.endsWith('.task')) return 'task';
  if (lower.endsWith('.litertlm')) return 'litertlm';
  return 'unknown';
}

export function selectRuntimeForModel(filePath: string): ActivationRuntime {
  const fmt = detectModelFormat(filePath);
  if (fmt === 'gguf') return ipcRuntime;
  if (fmt === 'task') return mediaPipeRuntime;
  if (fmt === 'litertlm') {
    // The MediaPipe runtime throws a clear error on .litertlm at session
    // creation time. Routing through it gives the user the same path they'd
    // get if they tried .task — same picker, same UI path.
    return mediaPipeRuntime;
  }
  throw new Error(
    `Unsupported model file: "${filePath}". Pick a .gguf, .task, or .litertlm file.`,
  );
}
