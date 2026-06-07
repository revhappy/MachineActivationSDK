import { join, resolve } from 'node:path';

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

export const PACKAGE_MANAGERS: readonly PackageManager[] = ['npm', 'pnpm', 'yarn'] as const;

export function isPackageManager(value: string): value is PackageManager {
  return (PACKAGE_MANAGERS as readonly string[]).includes(value);
}

export type TemplateTarget =
  | 'node'
  | 'expo'
  | 'react-native'
  | 'next'
  | 'electron';

export interface TemplateDescriptor {
  id: string;
  displayName: string;
  description: string;
  target: TemplateTarget;
  nextSteps: readonly string[];
}

export const TEMPLATES: readonly TemplateDescriptor[] = [
  {
    id: 'node-script',
    displayName: 'Node script',
    description: 'Minimal Node CLI that runs one-shot inference against a local cartridge.',
    target: 'node',
    nextSteps: [
      '{pm} install',
      '{pm} run build',
      '{pm} start',
    ],
  },
  {
    id: 'expo-local-chat',
    displayName: 'Expo local chat',
    description: 'Expo RN app with streaming on-device chat via llama.rn + @machine/ui/native.',
    target: 'expo',
    nextSteps: [
      '{pm} install',
      'cd ios && pod install && cd .. ',
      '{pm} run start',
    ],
  },
  {
    id: 'rn-cli-local-chat',
    displayName: 'RN CLI local chat',
    description: 'Bare React Native (no Expo) with streaming on-device chat via llama.rn + @machine/ui/native.',
    target: 'react-native',
    nextSteps: [
      '{pm} install',
      'npx pod-install',
      '{pm} run ios',
    ],
  },
  {
    id: 'next-local-chat',
    displayName: 'Next.js local chat',
    description: 'Next.js 14 (app router) web app with streaming in-browser chat via @mlc-ai/web-llm + @machine/ui/web.',
    target: 'next',
    nextSteps: [
      '{pm} install',
      '{pm} run dev',
    ],
  },
  {
    id: 'electron-local-chat',
    displayName: 'Electron local chat',
    description:
      'Electron desktop app: multi-format model picker (.gguf via vendored llama-server subprocess, .task via @mediapipe/tasks-genai in renderer, .litertlm recognized) + @machine/ui hooks. Self-updating llama.cpp via scripts/fetch-llama-cpp.js.',
    target: 'electron',
    nextSteps: [
      '{pm} install',
      '{pm} run fetch:llama',
      '{pm} run dev',
    ],
  },
];

export function findTemplate(id: string): TemplateDescriptor | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/**
 * Root of the templates dir on disk, relative to this module's runtime location.
 * At runtime the compiled module lives at `dist/templates.js`; templates are shipped at
 * `../templates/<id>` (one level up — `dist/` is a sibling of `templates/`).
 */
export function templatesRoot(): string {
  return resolve(__dirname, '..', 'templates');
}

export function templateDir(id: string): string {
  return join(templatesRoot(), id);
}
