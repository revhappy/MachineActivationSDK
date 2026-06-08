# Package Consumption

This note explains how the Machine Activation SDK should be consumed today and what still needs to improve before a polished external publish.

## Current State

Current package name:

- `@revhappy/activation-sdk`

Current status:

- standalone top-level package boundary
- separate package scripts
- own package-local TypeScript toolchain
- generated `dist/` output
- generated capability-catalog source from a shipped catalog artifact
- separate source tree
- consumed from the host through package-style imports
- not yet published as an external npm package

Current package file:

- [package.json](./package.json)

## What Works Today

Inside this project, and from external consumer projects, consumers should import the SDK through:

```ts
import { createMachineActivationSdk } from '@revhappy/activation-sdk';
```

That is the intended consumption style.

The goal is to avoid deep relative imports into activation internals from app code.

There is now also an external-style sample consumer here:

- [examples/basic-consumer/package.json](./examples/basic-consumer/package.json)
- [examples/basic-consumer/src/index.ts](./examples/basic-consumer/src/index.ts)

That example installs the SDK through the package boundary and typechecks against the built package surface.

## What Still Needs Improvement Before External Publish

- release/version workflow should be exercised publicly at least once
- CI should be trusted by actual outside consumers, not only this repo
- at least one external-style sample consumer should stay green as the package evolves
- install and usage docs should be validated by someone outside this repo

## Short-Term Rule

For current development:

- treat this as a real package boundary
- do not import SDK internals through deep relative paths from app code
- add public exports intentionally through the SDK entrypoint

## Publishability Checklist

Before calling the package externally publishable:

- build output lives under a publishable dist directory
- `main` and `types` point at generated output
- exports map is explicit
- built-in model-family defaults come from a shipped catalog artifact, not only inline source rules
- at least one external-style sample consumer works against the package boundary
- CI validates the package and at least one outside-style consumer automatically
- release verification includes a dry-run pack step
- install and usage docs are verified from a clean consumer project
