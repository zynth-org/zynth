# Zynth Release Readiness Roadmap

This document is the release preparation plan for the first public Zynth package releases.
This roadmap is temporary and should be retired in favor of `docs/release-operations.md` once the release system is stable.

It is written for the current Zynth monorepo shape:

- The repo is a Yarn 1 workspace monorepo.
- The root package is private.
- The main initial public packages are `@zynth/core`, `@zynth/apis`, and `@zynth/components`.
- The CLI should be published as `zynth` if that package name is available.
- The first public release cycle should use alpha releases for early feedback.

The goal is to make publishing safe, repeatable, and maintainable for a solo maintainer with more than 30 packages.

## Current Progress

- [x] Release roadmap created.
- [x] CLI package name decision recorded: publish the CLI as `zynth`.
- [x] Initial public framework package set recorded: `@zynth/core`, `@zynth/apis`, and `@zynth/components`.
- [x] Package release manifest created at `docs/package-release-manifest.json`.
- [x] Changesets configured.
- [x] Initial public package metadata hardened.
- [x] Release preflight validator implemented.
- [x] Pack validation implemented.
- [x] Consumer smoke fixture validation implemented.
- [x] Alpha CI readiness workflow implemented (publish disabled).
- [ ] Alpha publish execution enabled.

## Release Principles

- Favor a small and stable first public surface over publishing everything at once.
- Prefer standard npm ecosystem tooling over custom release systems.
- Every step must have an explicit validation gate before it is considered done.
- Version management must reduce human memory load.
- Release automation must refuse to publish if the repo is not in a valid state.
- The framework runtime packages and the CLI are related, but they are not the same product and should not be forced into the same release cadence.

## Final Package Naming Decision

### Public package names

- CLI: `zynth`
- Core runtime: `@zynth/core`
- Platform APIs: `@zynth/apis`
- Initial component set: `@zynth/components`

### Why this naming is recommended

- `zynth` is the best package name for the CLI because it is the command developers will type most often.
- `@zynth/core` should remain the runtime and renderer package because it is not the same thing as the CLI.
- Using the unscoped `zynth` package for the runtime would make the product shape less clear and would create confusion later if the CLI also needs that name.
- Keeping the framework libraries scoped under `@zynth/*` gives you a clean namespace for future packages.

### Ready when

- The npm name `zynth` is confirmed available and reserved for the CLI.
- All publishable packages have their final public names locked in.
- No internal tooling or docs still assume that the root private package is publishable.

### Validation

- Confirm the CLI package metadata points to the final publish name.
- Confirm user-facing docs refer to `npm install -g zynth` or `npx zynth`, not `@zynth/cli`.
- Confirm the root `package.json` remains private.

## What Should Be Published First

The first release should be intentionally narrow.

### Tier 1: initial framework packages

- `@zynth/core`
- `@zynth/apis`
- `@zynth/components`

These should be the only packages treated as required for the first public alpha unless an additional package is truly required for installation or app bootstrap.

### Tier 2: framework-adjacent packages

These are good candidates for later alpha waves after the install story is proven:

- `@zynth/router`
- `@zynth/screens`
- `@zynth/skia`
- `@zynth/icons`
- `@zynth/safe-area`

Motion and gesture are part of the core alpha surface through
`@zynth/core/motion`, `@zynth/core/gesture`, and `@zynth/components`, not
separate release-track packages.

### Tier 3: extras and specialized modules

Packages like storage, sensors, haptics, markdown, webserver, bluetooth, webview, secure store, and others should be treated as optional alpha extras unless they are required by the first-time developer experience.

### Ready when

- [x] Every package in the repo is classified as one of: initial public, later public, or internal/private.
- [x] There is a checked-in source of truth for that classification.

### Validation

- [x] No package is left in an ambiguous state.
- [x] Internal-only packages are marked `"private": true`.
- Release scripts only include packages intended for public distribution.

## Distribution Model for Native Code and Binaries

Zynth should use the standard npm distribution model for JavaScript packages with native mobile code:

- Publish JavaScript artifacts to npm.
- Publish iOS and Android native source files inside the npm package for ordinary native modules.
- Let the consuming app compile that native code through its normal iOS and Android toolchains.
- Only ship prebuilt or managed binary payloads for large, complex, or painful dependencies where source-only distribution creates too much user friction.

This means the answer is not "everything must be precompiled." The correct rule is "compile ahead of time where that meaningfully improves developer experience, but do not fight the normal native build model."

### Recommended Zynth policy

- `@zynth/core`, `@zynth/apis`, `@zynth/components`: ship built JS plus native source.
- Heavy packages like `@zynth/skia`: support managed binary synchronization or vendored artifacts where needed.
- Web support packages: ship built JS and any required static/native support assets.
- The CLI should help users avoid manual binary setup whenever possible.

### Ready when

- Every public package has a documented distribution strategy.
- Heavy binary packages have explicit verification scripts.
- No public package relies on undocumented manual installation steps.

### Validation

- `npm pack --dry-run` shows all required native files in each tarball.
- A fresh consumer app can install the package and build without undocumented local patching.
- Binary-heavy packages have a release prep step and a verification step.

## Versioning Strategy

Zynth should use **Changesets** for versioning, changelogs, and publish orchestration.

### Why Changesets is the best fit

- It is standard and widely used in multi-package npm monorepos.
- It reduces human bookkeeping.
- It makes public changes explicit before release.
- It can manage changelog generation.
- It works well with prereleases like alpha.
- It scales far better than manually editing 30+ package versions.

## Versioning policy

### Framework packages

The framework packages should start with **lockstep versioning**.

That means the main public framework packages move together with the same version number during the alpha period.

Example:

- `@zynth/core@0.1.0-alpha.1`
- `@zynth/apis@0.1.0-alpha.1`
- `@zynth/components@0.1.0-alpha.1`

This is strongly recommended for the first stage because:

- the packages are tightly related
- peer dependency coordination is easier
- documentation stays simpler
- install instructions stay cleaner
- you avoid version graph fatigue as a solo maintainer

### CLI package

The CLI should be versioned independently from the framework packages.

This is recommended because:

- the CLI may change faster than runtime APIs
- the CLI may need patch releases unrelated to runtime behavior
- users benefit when CLI regressions can be fixed without forcing a framework bump

### Alpha semantics

Use alpha prereleases with npm dist-tags.

Recommended pattern:

- Publish prereleases with versions like `0.1.0-alpha.1`
- Publish them under the `alpha` dist-tag
- Do not move `latest` until installation, docs, validation, and upgrade flow are stable

### Ready when

- There is a written versioning policy checked into the repo.
- Framework and CLI release tracks are clearly separated.
- Peer dependency ranges are compatible with the chosen lockstep model.

### Validation

- A dry-run version step updates only the packages that should move.
- Framework package versions remain synchronized after a dry run.
- CLI version changes do not accidentally force framework package releases.

## Changelog and Public API Discipline

Zynth should maintain changelogs for public packages. The changelog process should be mostly automated, but not entirely implicit.

### Recommended policy

- Every user-visible change to a public package requires a changeset.
- Breaking changes must be labeled clearly.
- Significant installation, migration, or behavior changes should receive a short human-written note in the release summary.
- Generated changelogs are acceptable for routine releases.
- Manually curated release notes should be added for larger milestones.

### Public API discipline

For public packages, the release process should require maintainers to answer:

- Did the exported API surface change?
- Did a peer dependency expectation change?
- Did native installation behavior change?
- Did a default runtime behavior change?
- Does the upgrade require a migration note?

### Ready when

- The repo has a clear rule that public changes require a changeset.
- Breaking changes have a consistent label and release note format.
- Each public package has a `CHANGELOG.md` policy, whether generated or maintained through Changesets.

### Validation

- No public release can be cut without changelog content.
- Breaking changes appear in changelog output.
- Alpha releases still generate useful release notes instead of opaque version bumps.

## Tooling to Add

This section describes the tooling that should be added to make releases safe.

## 1. Changesets setup

Install and configure Changesets for the monorepo.

What it should do:

- manage version bumps
- generate changelogs
- support prerelease mode
- support selective package publishing
- support lockstep version policy for framework packages

Ready when:

- the repo contains a `.changeset` directory
- the config matches the desired package groups
- maintainers can run the version command locally and see expected updates

Validation:

- create a test changeset and run the version step
- confirm only intended package versions change
- confirm changelog output is readable

## 2. Release manifest

Add a checked-in manifest that classifies packages and their release role.

What it should describe:

- package name
- publish status
- release tier
- version track
- package owner or responsibility if useful
- binary strategy if applicable

Ready when:

- every package in `packages/*` is represented
- release scripts can consume this manifest

Validation:

- no publishable package is missing
- no internal package is accidentally marked for publish

## 3. Preflight validation script

Add a repo-level release preflight script.

This should be a hard gate and should fail fast.

It should validate:

- clean build state or explicitly accepted dirty state
- package metadata completeness
- `exports` correctness
- `types` output existence
- required files in `files`
- native asset paths exist
- README presence
- repository/license metadata
- peer dependency sanity
- no accidental private/public mismatch
- no unresolved workspace dependency placeholders in publishable packages

Ready when:

- one command can validate release readiness across all intended public packages
- the script exits non-zero on any invalid package

Validation:

- intentionally break one package field and confirm the script fails
- restore it and confirm the script passes

## 4. Pack validation script

Add a script that runs `npm pack --dry-run` for each public package and checks what would actually be published.

It should validate:

- required native sources are included
- built JS artifacts are included
- podspecs or android integration files are included where required
- junk files are excluded
- tarball size is not unexpectedly huge

Ready when:

- every publishable package can be inspected as a tarball before publish
- results are easy to read in CI

Validation:

- compare tarball contents against expected package files
- confirm no accidental secrets, caches, tests, or local-only files are included

## 5. Consumer smoke fixtures

Add one or more fixture apps used only to validate the install experience from packed tarballs.

Suggested fixtures:

- minimal iOS/Android app using `@zynth/core`, `@zynth/apis`, `@zynth/components`
- optional web fixture for partial web support

These fixtures should prove:

- installation works from local tarballs
- the CLI can scaffold or run the app if that is part of the intended DX
- native linking/bootstrap works
- the app starts on both iOS and Android

Ready when:

- a fresh fixture can consume tarballs without local source linking tricks
- the fixture acts as a release smoke test

Validation:

- install packed tarballs into the fixture
- run the fixture bootstrap
- build and start the app successfully

## 6. CI readiness workflow (publish deferred)

Add a release workflow that runs all validation gates and keeps publish disabled for now.

Recommended behavior:

- run from CI, not from an ad hoc local shell
- allow manual triggering for alpha
- require successful build and preflight checks first
- keep publishing disabled in this stage

Ready when:

- the workflow runs all required release validation gates
- the workflow fails fast on invalid packages
- publish remains explicitly disabled

Validation:

- run the workflow manually
- confirm all readiness gates pass on valid input
- confirm no publish step is executed

## 7. Release checklist document

Keep a human-readable release checklist even after automation exists.

This is important because solo maintenance benefits from a fixed ritual.

The checklist should include:

- confirm the release scope
- confirm changesets are present
- run build and validation
- run pack checks
- run fixture smoke tests
- if publishing is enabled, publish alpha
- install from npm in a clean environment
- verify docs and examples
- collect feedback/issues

Ready when:

- a release can be performed by following the checklist without relying on memory

Validation:

- in readiness mode, perform at least one dry-run cycle using only the checklist
- in publish mode, perform at least one alpha using only the checklist

## Phase-by-Phase TODO Plan

## Phase 0: Release policy lock

Goal:

- finalize the public release model before adding tooling

TODO:

- [x] confirm `zynth` is the CLI package
- [x] confirm initial public packages are `@zynth/core`, `@zynth/apis`, `@zynth/components`
- [x] classify all remaining packages as later public or internal
- [x] decide that framework packages are lockstep during alpha
- [x] decide that CLI is independent
- [x] decide that alpha uses npm dist-tag `alpha`

Mark ready when:

- [x] these decisions are written down and not disputed

Validate:

- [x] package naming, versioning, and publish surface are all documented in-repo

## Phase 1: Metadata hardening

Goal:

- ensure every intended public package has production-quality package metadata

TODO:

- [x] audit `package.json` for every intended public package
- [x] add missing `description`, `repository`, `homepage`, `bugs`, `keywords`, and `engines` where needed
- [x] verify `exports`, `main`, `module`, and `types`
- [x] verify `files` whitelists
- [x] ensure each package has a real `README.md`
- [x] ensure licenses are correct
- [x] mark internal packages private

Mark ready when:

- [x] all intended public packages meet the metadata checklist

Validate:

- [x] run the preflight metadata validator
- [x] inspect at least one tarball per package category

## Phase 2: Versioning foundation

Goal:

- install the standard versioning workflow

TODO:

- [x] add Changesets
- [x] configure release grouping
- [x] configure changelog generation
- [x] document version policy in the repo
- [x] add scripts for creating and applying changesets
- [x] add isolated versioning drill script (`yarn release:versioning-drill`)

Mark ready when:

- [x] maintainers can add a changeset, run the version command, and produce a coherent release diff

Validate:

- [x] create a fake alpha change and inspect all resulting package version updates

## Phase 3: Validation gates

Goal:

- make it difficult to publish broken packages

TODO:

- [x] add repo preflight validation
- [x] add pack validation
- [x] add fixture smoke installs
- [x] add checks for native file presence
- [x] add checks for peer dependency alignment
- [x] add checks for build artifacts

Mark ready when:

- [x] validation catches missing files, bad metadata, bad exports, and stale builds before publish

Validate:

- [x] break one thing intentionally and confirm the correct validator catches it

## Phase 4: Alpha release pipeline

Goal:

- keep alpha pipeline safely ready, then enable publishing intentionally

TODO:

- [x] add CI readiness workflow (manual trigger, publish disabled)
- support prerelease versions
- add controlled publish switch for `alpha` when ready
- document rollback and unpublish constraints
- verify install instructions using fixture tarballs until publish is enabled

Mark ready when:

- readiness workflow is stable and publishing can be enabled with explicit configuration

Validate:

- in readiness mode: run fixture-based clean bootstrap checks
- in publish mode: install published alpha into a clean project and verify bootstrap

## Phase 5: Feedback loop

Goal:

- stabilize the release process before moving beyond alpha

TODO:

- collect install friction reports
- collect native integration issues
- improve CLI setup flow
- tighten docs based on real onboarding feedback
- decide when to move more packages into public alpha

Mark ready when:

- at least two or three alpha release cycles complete without major packaging surprises

Validate:

- review support burden, recurring issues, and upgrade friction between alpha versions

## Package Readiness Checklist

Every public package should satisfy this checklist before publish:

- package name is final
- package is not accidentally private
- version is managed by the release system
- description is clear
- license is correct
- repository metadata is present
- `README.md` exists and is not placeholder text
- `main`, `module`, `types`, and `exports` are correct
- `files` includes exactly the required payload
- `dist` output is buildable from a clean checkout
- native integration files exist if the package includes native modules
- peer dependencies are correct
- no accidental dev-only files leak into the tarball
- install instructions are documented

Mark package ready when:

- the package passes preflight checks, pack validation, and smoke installation validation

## Release Command Model

The release flow should eventually feel like this:

1. Add or review changesets for user-visible changes.
2. Run a full release preflight command.
3. Run pack validation.
4. Run consumer smoke fixtures.
5. Enter prerelease mode for alpha if needed.
6. Version packages.
7. Publish under `alpha`.
8. Install from npm in a clean environment and verify.
9. Monitor feedback and patch quickly.

The exact commands can be finalized after the release tooling is implemented, but the flow should remain stable.

## CI Expectations

Before any public publish, CI should run at minimum:

- workspace build
- type generation
- lint
- release preflight validation
- pack dry-run validation
- fixture installation checks

If possible, add:

- iOS smoke bootstrap
- Android smoke bootstrap
- web smoke build for supported packages

## Important Repo-Specific Follow-Ups

These issues should be addressed as part of release preparation:

- The repo currently uses Yarn 1 workspaces, but some internal guidance still references `pnpm run lint` and `pnpm run build`. The release docs and automation should be aligned to the actual package manager and commands in this repository.
- The root package is named `zynth` but is private. That is fine for the workspace root, but it should not be confused with the publishable CLI package metadata.
- Some packages appear ready for native source distribution already, but they still need pack validation to confirm the tarballs include exactly what consumers need.
- Binary-heavy packages like `@zynth/skia` deserve stricter release checks than ordinary JS-first packages.

## Recommended First Implementation Order

To keep scope controlled, implement release readiness in this order:

1. [x] Create the package release manifest.
2. [x] Add Changesets.
3. [x] Harden package metadata for the first public packages.
4. [x] Add preflight validation.
5. [x] Add `npm pack --dry-run` validation.
6. [x] Add fixture smoke tests.
7. [x] Add alpha readiness workflow (no publish).
8. Publish only the first three framework packages plus the CLI.
9. Expand package coverage after alpha feedback.

## Definition of Release Ready

Zynth is ready for its first public alpha release when all of the following are true:

- the CLI package name is finalized as `zynth`
- the first public framework package set is fixed
- public package metadata is complete
- a release manifest exists
- Changesets is configured
- versioning policy is documented
- preflight validation exists and passes
- pack validation exists and passes
- fixture smoke installs exist and pass
- alpha readiness workflow exists
- install and upgrade docs are clear enough for external users
- at least one end-to-end dry run has been completed before publishing

At that point, the project is release-ready and operationally maintainable.
