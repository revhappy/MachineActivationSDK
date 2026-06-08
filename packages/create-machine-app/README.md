# create-machineai-app

Scaffold a local-LLM app preconfigured for [`machineai-activation`](https://github.com/machine-ai/activation-sdk).

```sh
npx create-machineai-app my-app
# or pick a template up-front:
npx create-machineai-app my-app --template node-script
```

## Templates

| id | target | what it is |
|---|---|---|
| `node-script` | Node 20+ | Minimal TypeScript CLI that runs one-shot inference against a local cartridge. Good for prototyping. |
| `expo-local-chat` | Expo / React Native | Streaming chat UI on-device via `llama.rn`. Built on `machineai-activation-ui/native`. |

More templates (`rn-cli-local-chat`, `next-local-chat`, `electron-local-chat`) land in a later release.

## Flags

```
create-machine-app [app-name] [--template <id>] [--pm <npm|pnpm|yarn>] [--yes] [--force]
```

| flag | default | description |
|---|---|---|
| `--template`, `-t` | prompt | Template id. |
| `--pm` | `npm` | Package manager to reference in generated `README.md` / next-steps output. |
| `--yes`, `-y` | off | Skip prompts; require sufficient flags. Errors out if a required value is missing. |
| `--force` | off | Overwrite a non-empty target directory. |
| `--help`, `-h` | — | Print help. |
| `--version`, `-v` | — | Print version. |

Exit codes: `0` success, `1` expected error (target exists, unknown template, non-TTY interactive), `2` usage error.

## License

MIT.
