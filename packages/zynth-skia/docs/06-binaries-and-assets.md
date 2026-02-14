# @zynth/skia - Binaries and Native Assets

## Commands

```bash
yarn workspace @zynth/skia binaries:sync
yarn workspace @zynth/skia binaries:update
yarn workspace @zynth/skia binaries:verify
yarn workspace @zynth/skia binaries:prepare-release --source /path/to/skia-refs_heads_chrome_m142 --features svg,skottie --out /tmp/zynth-skia-release
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

The manifest provisions a single headers payload at `native/vendor/headers/skia` (public + required module/internal headers).

`binaries:sync` accepts empty `sha256`; `binaries:update` locks checksums.

## Layout normalization

- Android: `native/vendor/android/<abi>`
  keeps `.a`, `.so`, `.dat` and strips archive byproducts
- iOS: `native/vendor/ios`
  writes `xcframeworks/` and flattened `libs/`
- Headers: `native/vendor/headers/skia`
  generated from a deterministic transitive dependency walk rooted at native includes and feature roots

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

## Release prep lifecycle

Use one command to prepare release assets from a matching Skia source snapshot:

`yarn workspace @zynth/skia binaries:prepare-release --source /absolute/path/to/skia-snapshot --features svg,skottie --out /tmp/zynth-skia-release`

This command:
1. Reuses cached runtime artifacts already synchronized by `binaries:sync`.
2. Regenerates `native/vendor/headers/skia` from source closure and writes `native/vendor/headers/skia/.headers-manifest.json`.
3. Packs all manifest artifacts into the output folder using manifest filenames.
4. Updates manifest checksums to match generated tarballs.

Feature roots are declarative and additive:
- `svg`
- `skottie`
- `shaper`

Additional roots can be pinned in `native/headers.roots.json`.
