import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface AppConfig {
  modelFilePath: string | null;
}

const DEFAULTS: AppConfig = {
  modelFilePath: null,
};

function configFilePath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

export function readConfig(): AppConfig {
  const file = configFilePath();
  if (!fs.existsSync(file)) return { ...DEFAULTS };
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeConfig(patch: Partial<AppConfig>): AppConfig {
  const current = readConfig();
  const next: AppConfig = { ...current, ...patch };
  const file = configFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
