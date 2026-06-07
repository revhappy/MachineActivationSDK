import { createInterface } from 'node:readline';

export interface PromptTextOptions {
  default?: string;
  validate?: (value: string) => string | null;
}

export async function promptText(question: string, options: PromptTextOptions = {}): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = options.default !== undefined ? ` (${options.default})` : '';
    for (;;) {
      const answer = await new Promise<string>((resolveAnswer) => {
        rl.question(`${question}${suffix}: `, (input) => resolveAnswer(input));
      });
      const value = answer.trim() === '' ? options.default ?? '' : answer.trim();
      if (options.validate) {
        const err = options.validate(value);
        if (err !== null) {
          process.stdout.write(`  ✗ ${err}\n`);
          continue;
        }
      }
      return value;
    }
  } finally {
    rl.close();
  }
}

export interface PromptSelectOption {
  value: string;
  label: string;
  description?: string;
}

export async function promptSelect(
  question: string,
  options: readonly PromptSelectOption[],
  defaultValue?: string,
): Promise<string> {
  if (options.length === 0) {
    throw new Error('promptSelect: no options provided');
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write(`${question}\n`);
    for (let i = 0; i < options.length; i += 1) {
      const marker = options[i].value === defaultValue ? '*' : ' ';
      const desc = options[i].description ? ` — ${options[i].description}` : '';
      process.stdout.write(`  ${marker} ${i + 1}) ${options[i].label}${desc}\n`);
    }

    const defaultIndex = defaultValue
      ? options.findIndex((o) => o.value === defaultValue)
      : 0;
    const defaultHint = `1-${options.length}${defaultIndex >= 0 ? ` (${defaultIndex + 1})` : ''}`;

    for (;;) {
      const answer = await new Promise<string>((resolveAnswer) => {
        rl.question(`Choose [${defaultHint}]: `, (input) => resolveAnswer(input));
      });
      const trimmed = answer.trim();
      if (trimmed === '' && defaultIndex >= 0) {
        return options[defaultIndex].value;
      }
      const chosen = Number.parseInt(trimmed, 10);
      if (Number.isFinite(chosen) && chosen >= 1 && chosen <= options.length) {
        return options[chosen - 1].value;
      }
      const byValue = options.find((o) => o.value === trimmed);
      if (byValue) return byValue.value;
      process.stdout.write(`  ✗ enter a number between 1 and ${options.length}\n`);
    }
  } finally {
    rl.close();
  }
}
