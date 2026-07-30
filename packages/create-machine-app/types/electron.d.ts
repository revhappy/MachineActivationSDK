// Minimal type stub so templates/electron-local-chat typechecks without
// installing electron (~200 MB). Scaffolded apps install the real electron;
// its bundled types then supersede these declarations.
//
// Only the surface the template's main-process runtime uses is declared here.

declare module 'electron' {
  export interface App {
    getAppPath(): string;
    getPath(
      name:
        | 'home'
        | 'appData'
        | 'userData'
        | 'temp'
        | 'downloads'
        | 'documents'
        | 'logs',
    ): string;
  }

  export const app: App;
}

// Electron adds `resourcesPath` to the Node `process` global. @types/node
// doesn't know about it, so declare it here rather than casting at each use.
//
// NOTE: this file must stay a global script (no top-level import/export), or
// the `declare module 'electron'` above stops being an ambient declaration.
declare namespace NodeJS {
  interface Process {
    resourcesPath: string;
  }
}
