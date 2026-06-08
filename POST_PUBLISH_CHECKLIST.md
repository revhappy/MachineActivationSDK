# Post-Publish Checklist

> This is the one-page list of things to do **after** `npm publish` succeeds on the real public registry. The publish-ready work — version bumps, peerdep audits, dry-run pack, local install proof — happens *before*. This list is for *after*.

## 1. Tag the release in git

Tag the commit you just published with the matching version (the release workflow keys off `activation-sdk-v*` tags):

```bash
git tag activation-sdk-v0.2.0-beta.1
git push origin activation-sdk-v0.2.0-beta.1
```

Pushing the tag also re-runs the publish workflow, which is idempotent — pushing the same versions a second time will surface an `npm publish` 403 "cannot publish over previously published version" and the rest of the job is a no-op.

## 2. Smoke-test from the public registry

In a brand-new scratch directory (outside this repo), prove the published artifacts actually install and run:

```bash
mkdir /tmp/machine-smoke && cd /tmp/machine-smoke
npm init -y
npm install machineai-activation@0.2.0-beta.1 \
            machineai-activation-ui@0.2.0-beta.1 \
            create-machineai-app@0.2.0-beta.1 \
            machineai-activation-capacitor@0.2.0-beta.1
node -e "console.log(require('machineai-activation').createMachine)"
```

If any of these 404 from the registry, the publish didn't propagate — wait a minute and retry. If a peer-dependency warning appears about `machineai-activation`, ignore it (see *Known peer-dep range trade-off* below).

## 3. Replace `file:` deps in the reference apps with published version ranges

The reference apps currently consume the SDK + UI + (optionally) capacitor via local workspace `file:` deps. Now that the packages are on the public registry, swap them.

### Reference App 02 — Second Brain (Electron)

Path: `Second Brain - Activation SDK\`

In its `package.json` (and any nested workspaces), find dependency entries that look like:

```json
"machineai-activation": "file:../Machine AI/iterations/MachineActivationSDK",
"machineai-activation-ui": "file:../Machine AI/iterations/MachineActivationSDK/packages/ui"
```

Replace each with:

```json
"machineai-activation": "^0.2.0-beta.1",
"machineai-activation-ui": "^0.2.0-beta.1"
```

Note: `^0.2.0-beta.1` only matches **prereleases of `0.2.0`** by npm semver rules. Once `0.2.0` stable ships, the range will continue to match `0.2.0` stable but not `0.2.1-beta.1`. That's fine for a beta train — bump the range when you bump the prerelease line.

After editing, in each reference app:

```bash
rm -rf node_modules package-lock.json
npm install
npm run dev   # or whatever the app's smoke command is
```

Confirm the reference app still launches, the model picker works, and inference actually runs locally.

### Reference App 01 — Ingredient Analyzer

Same procedure. The capacitor adapter (`machineai-activation-capacitor`) replaces the previously-vendored ~570 LOC of Capacitor + LiteRT-LM glue if the app uses Capacitor. See the app's `ACTIVATION_SDK_INTEGRATION_CHECKPOINT.md` for host-app Gradle/Kotlin pieces that **stay** in the host app and aren't packaged.

## 4. Update the CI workflow for the reference apps (if applicable)

If a reference app's CI installs from the workspace path, switch it to install from the registry:

```yaml
- name: Install dependencies
  run: npm ci
```

Make sure `package-lock.json` is committed with the new resolved `https://registry.npmjs.org/...` entries (not `file:` paths).

## 5. Announce + document

- Tag a GitHub release (if not auto-created by the tag push) with the changelog highlights.
- Update [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md) — flip M9 status to ✅ shipped.
- Update [`CARTRIDGE_SDK_ROADMAP.md`](./CARTRIDGE_SDK_ROADMAP.md) RESUME HERE block: bump "Last verified" date and note "M9 shipped — published to public registry".
- Mention adoption on whatever channels apply (Twitter / HN / community).

## Known peer-dep range trade-off

`machineai-activation-capacitor` declares its peer dep on `machineai-activation` as `"*"` (and `machineai-activation-ui` declares no explicit dep on the SDK — only imports it). This is because the SDK lives at the **repo root**, which npm does not treat as a workspace — declaring a stricter range (e.g. `>=0.2.0-beta.1 <0.3.0`) makes npm try to resolve the SDK from the public registry at install time, which fails with E404 even after publish (because npm only sees the workspace symlink in dev, not the registry entry until install resolves it).

Consumer impact: anyone installing `machineai-activation-capacitor` will be warned (without a hard error) that `machineai-activation` is needed. Anyone installing `machineai-activation-ui` won't be warned at all — they discover the SDK requirement from the docs (this file, `MIGRATION.md`, `PACKAGE_CONSUMPTION.md`).

A stricter, registry-resolvable range becomes possible if the SDK is later restructured into `packages/activation-sdk/` (turning the repo root into a private orchestration meta-package). That refactor is out of scope for M9 but is a clean follow-up.

## 6. Watch for downstream issues

- Track install errors in CI logs for any consumer using the packages.
- Watch [npm package pages](https://www.npmjs.com/package/machineai-activation) for the first weekly downloads tick — that's the public-adoption signal `PUBLISHING.md` calls out as "not yet exercised publicly."
- File issues against this repo for any concrete regressions found in the smoke-test or in the reference apps.

## 7. If something goes wrong

- **Wrong file shipped:** publish a patch version (`0.2.0-beta.2`) with the fix. Don't `npm unpublish` after 72 hours — npm doesn't truly remove a package and the name stays burned.
- **Critical bug:** add a deprecation message: `npm deprecate machineai-activation@0.2.0-beta.1 "Upgrade to 0.2.0-beta.2 — beta.1 had X"`.
- **Lockfile drift in reference apps:** clear `node_modules` + `package-lock.json` and reinstall. The published packages will resolve from the registry now.
