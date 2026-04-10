# Changesets

Zynth uses Changesets for public package versioning and changelog generation.

## Release Tracks

- `@zynth/core`, `@zynth/apis`, and `@zynth/components` are fixed together during the alpha period.
- The CLI package is published as `zynth` and exposes the `zynth` binary.
- `@zynth/skills` and `@zynth/skyhook` are private and ignored by Changesets.
- Later-alpha packages are available to Changesets, but should not be published until the release manifest marks them ready.

## Common Commands

- Create a user-visible change note: `yarn changeset`
- Enter alpha prerelease mode: `yarn changeset:pre enter alpha`
- Exit prerelease mode after alpha: `yarn changeset:pre exit`
- Apply versions and changelog updates: `yarn version:packages`
- Publish prereleases with the alpha dist-tag: `yarn release:alpha`

Before publishing, always run the release preflight and pack validation scripts once they exist.
