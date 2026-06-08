# Publishing

This note describes the current release path for the Machine Activation SDK.

## Current Package Identity

- npm package: `@revhappy/activation-sdk`
- publish access: `public`

## Release Verification

Before publishing, run:

```bash
npm run release:verify
```

That does three things:

1. regenerates the default capability catalog source from the shipped catalog JSON
2. runs package typecheck, tests, and build
3. performs `npm pack --dry-run`

## Catalog Source Of Truth

The built-in model-family defaults now come from:

- [catalog/default-capability-catalog.json](./catalog/default-capability-catalog.json)

That file is transformed into generated package source by:

- [scripts/generate-capability-catalog.js](./scripts/generate-capability-catalog.js)

Do not hand-edit the generated TypeScript output.

## CI Workflow

The package CI workflow lives here:

- [../.github/workflows/activation-sdk-ci.yml](./.github/workflows/activation-sdk-ci.yml)

It verifies:

- the SDK package itself
- the external-style basic consumer example

## Publish Workflow

The publish workflow lives here:

- [../.github/workflows/activation-sdk-release.yml](./.github/workflows/activation-sdk-release.yml)

Current release behavior:

- `workflow_dispatch` allows a manual dry run of the pipeline
- pushes to tags matching `activation-sdk-v*` trigger an npm publish step
- the workflow expects `NPM_TOKEN` to exist in repository secrets

## Current Honest Limitations

- this is release plumbing, not proof of public adoption
- tag/release strategy is now defined, but not yet exercised publicly
- the built-in catalog is now externalized as data, but it is still maintained by this repo
