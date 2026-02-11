# @zynth/skia - Binaries and Native Assets

## Commands

```bash
yarn workspace @zynth/skia binaries:sync
yarn workspace @zynth/skia binaries:update
yarn workspace @zynth/skia binaries:verify
```

Strict checksum verification (CI for manifest edits):

```bash
node packages/zynth-skia/scripts/manage-binaries.mjs verify --strict-checksums
```

## Manifest contract

`binaries.manifest.json` is the source of truth for:

- mirrored release tag
- per-platform artifact URLs
- destination paths under `native/vendor`
- optional SHA256 integrity locks

`binaries:sync` accepts empty `sha256`; `binaries:update` locks checksums.

## Layout normalization

- Android: `native/vendor/android/<abi>/gl-pdf`
  keeps `.a`, `.so`, `.dat` and strips archive byproducts
- iOS: `native/vendor/ios/<arch>/<target>/metal-pdf`
  writes `xcframeworks/`, `libs/`, and compatibility `libskia.a`

## Postinstall behavior

By default, install runs `binaries:sync`.

Skip in offline/CI contexts:

```bash
ZYNTH_SKIA_SKIP_BINARY_SYNC=1 yarn install
```

## Update policy

1. Mirror approved assets into package-scoped release tag.
2. Update via `binaries:update --version ...`.
3. Do not hand-edit checksums.
4. Run `binaries:verify` before PR.
5. If manifest changed, run strict checksum verification in CI.
