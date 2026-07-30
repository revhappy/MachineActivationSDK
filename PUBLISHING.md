# Publishing

This note describes the current release path for the Machine Activation SDK.

## Current Package Identity

- npm package: `machineai-activation`
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

## Python Client (PyPI)

The Python client ships as its own distribution, on its own cadence:

- PyPI package: `machine-activation` (source: [clients/python](./clients/python))
- import name: `machine_activation`
- tag glob: `python-client-v*`
- workflow: [.github/workflows/python-client-release.yml](./.github/workflows/python-client-release.yml)

It versions separately from npm on purpose. The two halves change for different
reasons — a supervisor fix does not warrant republishing four npm packages, and
a runtime-adapter fix does not warrant a PyPI release.

### One-time setup on PyPI (must be done by the account owner)

The workflow uses **trusted publishing** (OIDC), so there is no API token to
store or rotate. Until the publisher is registered it fails with
`invalid-publisher`, which is a configuration error, not a code one.

1. Sign in to <https://pypi.org> and go to *Your projects → Publishing*
   (or <https://pypi.org/manage/account/publishing/> for a project that does not
   exist yet — a "pending publisher").
2. Add a GitHub publisher:
   - PyPI project name: `machine-activation`
   - Owner: `revhappy`
   - Repository: `MachineActivationSDK`
   - Workflow: `python-client-release.yml`
   - Environment: `pypi`
3. In GitHub, create an environment named `pypi`
   (*Settings → Environments*). Add a required reviewer if you want a human gate
   on every release.

The name `machine-activation` was unclaimed as of 2026-07-26. Registering it is
the only step that cannot be done from here.

### Releasing

```bash
# bump `version` in clients/python/pyproject.toml first
git tag python-client-v0.2.0b2
git push origin python-client-v0.2.0b2
```

### Verifying locally

```bash
cd clients/python
python -m unittest discover -s tests -t .    # 11 supervision tests, no model needed
python -m build && python -m twine check dist/*
```

Every push also runs the tests on Windows, macOS and Linux across Python 3.9 and
3.13 (`python-client-check` in the CI workflow). The supervisor touches process
groups, `taskkill` and pipe lifetimes, which behave differently per platform —
that matrix is load-bearing, not decoration.

## Current Honest Limitations

- this is release plumbing, not proof of public adoption
- `0.2.0-beta.1` was published to npm on 2026-06-08, but **not via this workflow** — no `activation-sdk-v*` tag exists in the repo, so the tag/release path itself is still unexercised. The published version and the git history are therefore not linked by a tag; see `TODO.md`.
- **`machine-activation` is not on PyPI yet.** The package builds and passes `twine check`, and the workflow is wired — but nothing has been uploaded, and the trusted publisher above has not been registered. `pip install machine-activation` does not work today; `pip install -e clients/python` does.
- the built-in catalog is now externalized as data, but it is still maintained by this repo
