# @zynth/skia

Declarative Skia rendering package for Zynth (Phase 1 foundation).

## Phase 1 status

- Package scaffolding for iOS and Android is in place.
- Binary provisioning is manifest-driven via `binaries.manifest.json`.
- Binaries are synced into `native/vendor/**` using package scripts.

## Commands

Automatic install-time sync (default):

```bash
yarn add @zynth/skia
```

Manual sync for maintainers/local debugging:

```bash
yarn workspace @zynth/skia binaries:sync
```

Force refresh and update `sha256` values in the manifest:

```bash
yarn workspace @zynth/skia binaries:update
```

## Binary manifest

`binaries.manifest.json` is the source of truth for:

- Skia release version
- platform/architecture artifact URLs
- destination paths under `native/vendor`
- optional SHA256 integrity locks

`binaries:sync` accepts empty `sha256` fields, but once `binaries:update` runs, the script writes locked checksums for reproducible installs.

By default, `postinstall` runs `binaries:sync`. To skip in CI/offline environments:

```bash
ZYNTH_SKIA_SKIP_BINARY_SYNC=1 yarn install
```
