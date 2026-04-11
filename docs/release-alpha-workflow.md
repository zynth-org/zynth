# Alpha Release Readiness Workflow

This document describes the CI workflow used to validate Zynth alpha release readiness.

## Workflow file

- `.github/workflows/release-alpha.yml`

## Triggers

- Manual run via `workflow_dispatch`

## Pipeline gates

The workflow runs these checks:

1. `yarn install --frozen-lockfile`
2. `yarn changeset:status`
3. `yarn release:preflight`
4. `yarn release:pack`
5. `yarn release:fixture` (android + ios on macOS runner)

Publishing is intentionally disabled in CI for now.

## Rollback guidance

- Not applicable yet for CI, because CI does not publish.
- When publishing is enabled later, prefer publishing a fixed follow-up version over unpublish.
