// Built-in runtime adapters.
//
// The SDK stays adapter-driven — `ActivationRuntime` is a three-member interface
// and any backend can implement it. What lives here is the adapter almost every
// consumer needs anyway: llama.cpp over its OpenAI-compatible HTTP surface.
//
// It ships in the core rather than as a satellite package because it has zero
// dependencies, and because four separate copies of it had already accumulated
// across this repo and the apps consuming it — the CLI's `doctor --run`, the
// Electron template, and two hand-written app adapters — each with bugs the
// others never received. One implementation, tested once, is the point.
//
// Everything in this barrel is portable: no `node:*`, so it bundles for the
// browser, React Native and Capacitor. The process manager that spawns the
// binary is Node-only and lives in `./nodeLlamaServer`, re-exported from
// `machineai-activation/node`.

export { llamaServerRuntime } from './llamaServerRuntime';
export { stubRuntime, type StubRuntimeOptions } from './stubRuntime';
export {
  BACKEND_ID as LLAMA_SERVER_BACKEND_ID,
  BACKEND_NAME as LLAMA_SERVER_BACKEND_NAME,
  fetchServerProps,
  type LlamaServerProps,
} from './capabilities';
export { decodeRate, iterateSse, toWireMessage, type WireMessage } from './wire';
export type { FetchLike, FetchLikeResponse, LlamaServerRuntimeOptions } from './types';
