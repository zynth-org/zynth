# Zynth Release Operations Guide

This is the long-term operational guide for Zynth package versioning and releases.

Use this as the source of truth for normal releases (patch/minor/major), prereleases, and first public alpha rollout.
Once this guide is fully adopted, `docs/release-readiness-roadmap.md` can be removed.

## Current Mode

As of now, CI is configured for **release readiness validation only**.

- CI validates release gates.
- CI does **not** publish to npm.
- Publishing remains a manual and explicit action.

This is intentional while the framework stabilizes pre-release.

## Package Release Model

## Public package names

- CLI: `zynth`
- Core runtime: `@zynthjs/core`
- APIs: `@zynthjs/apis`
- Components: `@zynthjs/components`

## Version tracks

- `@zynthjs/core`, `@zynthjs/apis`, `@zynthjs/components`: lockstep track during alpha.
- `zynth` CLI: independent track.

## Dist-tags

- Alpha prereleases publish under `alpha`.
- `latest` should only be used after validation, onboarding quality, and migration quality are stable.

## Semver Policy

Use this policy for user-facing version bumps:

- **Patch**: bug fixes and internal correctness improvements that do not change public API contracts.
- **Minor**: backward-compatible new features and additive API surface.
- **Major**: breaking API or behavior changes requiring migration.

For alpha, these typically appear as prerelease versions, for example:

- `0.2.0-alpha.1`
- `0.2.0-alpha.2`

## Release Types and How To Choose

Use this quick decision model before creating changesets:

- Use **patch** when behavior is fixed but public API contracts do not change.
- Use **minor** when adding backward-compatible APIs or features.
- Use **major** when removing/changing behavior that can break existing apps.

For mixed changes across packages, pick the highest-impact bump per package and let lockstep framework packages follow the highest bump among them.

## Changeset Rules

- Every user-visible change to a public package requires a changeset.
- Breaking changes must be explicitly labeled and explained.
- Lockstep framework packages should be versioned together.

## Standard Release Commands

## Readiness checks

Run before any versioning or publish action:

1. `yarn changeset:status`
2. `yarn release:preflight`
3. `yarn release:pack`
4. `yarn release:fixture`
5. `yarn release:versioning-drill`

## Versioning flow

1. Add changeset entries:
   - `yarn changeset`
2. For alpha prerelease mode:
   - `yarn changeset:pre enter alpha`
3. Apply versions/changelogs:
   - `yarn version:packages`
4. Review generated changes.

## Versioning Drill (Readiness Gate)

Use this gate to validate Changesets behavior without modifying your current branch state.

- Command: `yarn release:versioning-drill`
- The drill runs in an isolated temporary git worktree.
- It injects a temporary changeset for `@zynthjs/core`.
- It enters alpha prerelease mode and runs `changeset version`.
- It validates:
  - framework lockstep packages move together (`@zynthjs/core`, `@zynthjs/apis`, `@zynthjs/components`)
  - generated versions are alpha prerelease versions
  - CLI package `zynth` remains unchanged for framework-only changes
- It removes the temporary worktree when done.

## Standard Runbook by Release Type

## Patch release runbook

1. Ensure all bug-fix changes include changesets.
2. Run readiness checks.
3. Apply versions/changelogs.
4. Validate generated diffs and lockstep package alignment.
5. Publish only when publish mode is enabled.

## Minor release runbook

1. Confirm feature scope and backward compatibility.
2. Ensure all feature changes include changesets.
3. Run readiness checks.
4. Apply versions/changelogs.
5. Validate fixture smoke on both Android and iOS.
6. Publish only when publish mode is enabled.

## Major release runbook

1. Confirm breaking changes and migration guidance.
2. Ensure changesets clearly flag breaking changes.
3. Run readiness checks.
4. Apply versions/changelogs.
5. Review release notes carefully for migration clarity.
6. Validate fixture smoke and at least one external clean install.
7. Publish only when publish mode is enabled.

## Publish flow (manual, when enabled)

1. Ensure all readiness checks pass.
2. Ensure npm credentials are set (`NPM_TOKEN` or local auth).
3. Publish prerelease:
   - `yarn release:alpha`

When moving to stable:

1. Exit prerelease mode:
   - `yarn changeset:pre exit`
2. Apply versions:
   - `yarn version:packages`
3. Publish with stable tag:
   - `yarn release:packages`

## First Public Alpha Playbook

Use this sequence for first external release:

1. Confirm initial package set is still:
   - `@zynthjs/core`
   - `@zynthjs/apis`
   - `@zynthjs/components`
   - `zynth`
2. Run all readiness gates.
3. Create prerelease versions (`alpha`).
4. Publish under `alpha`.
5. Install from npm into a clean external test app.
6. Verify scaffold + Android bootstrap + iOS bootstrap.
7. Collect feedback and patch quickly with the next alpha.
8. Keep `latest` untouched until alpha feedback stabilizes.

## CI Readiness Workflow

Current CI workflow file:

- `.github/workflows/release-alpha.yml`

Current behavior:

- Manual trigger only.
- Runs readiness gates.
- Does not publish.

## Enabling CI Publish Later

When you decide to allow CI publish:

1. Add controlled publish conditions in workflow (manual publish input or release branch policy).
2. Add `NPM_TOKEN` secret to repository settings.
3. Add explicit publish step:
   - `yarn release:alpha`
4. Keep readiness gates before publish.
5. Start with manual publish mode before any automatic branch publish.

## Rollback Strategy

If a bad alpha is published:

- Prefer publishing a fixed higher alpha immediately.
- Avoid unpublish except emergency and npm policy-compliant windows.

## Ownership Checklist Per Release

Before closing a release cycle, confirm:

- Changesets reflect user-facing changes.
- Release notes/changelog are coherent.
- Preflight, pack, and fixture checks passed.
- Installation from npm was verified in a clean environment.
- Known issues are tracked for next iteration.
