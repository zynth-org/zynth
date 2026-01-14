# Repository Guidelines

## Project Structure & Module Organization

- Monorepo driven by Yarn workspaces: runtime packages live in `packages/`, example app in `apps/components/`, shared helpers in `scripts/`.
- Key packages: `rune-core` (renderer), `rune-ios` / `rune-android` (native bridges), `rune-components`, `rune-apis`, `rune-cli`, and `rune-templates`.
- `apps/components` is the primary dev harness; it consumes packages directly from `node_modules` and hosts the iOS/Android workspaces.
- Type roots are in `types/`; path aliases are defined in `tsconfig.base.json` and mirrored by `scripts/sync-workspace-aliases.js`.

## Build, Test, and Development Commands

- Root builds: `yarn build` builds all workspaces; `yarn bundle` / `bundle:apps` / `bundle:packages` use the Rune CLI to produce JS bundles.
- Native prep: `yarn prebuild:ios` or `yarn prebuild:android` regenerate native projects from templates; `yarn reset:ios` / `reset:android` wipe derived native artifacts.
- Dev loops (demo app): from the root, `yarn rune dev ios --prebuild` or `yarn rune dev android --prebuild` run bundling plus the platform pipeline. Inside `apps/components`, use `yarn rune dev` for the same paired flows, or `yarn dev` for JS-only dev server.
- Keep `yarn sync-aliases` handy after adding new workspace packages or path aliases.

## Coding Style & Naming Conventions

- Language: TypeScript (strict, ESM). JSX uses `solid-js` (`jsx: "preserve"`, `jsxImportSource: "solid-js"`).
- Formatting: prefer 2-space indentation; keep imports ESM-only; colocate platform-specific code under package folders (e.g., `src/ios`, `src/android`).
- Naming: components PascalCase, functions/variables camelCase, hooks start with `use`, native modules follow platform conventions (Swift/ObjC/Kotlin files keep descriptive names).
- Keep files small and focused; favor clear Solid signals/memos over opaque abstractions.

## Testing Guidelines

- We're not testing anything yet

## Commit & Pull Request Guidelines

- Commits follow a conventional style: `<type>(<scope>): <summary>` (e.g., `fix(router-ios): Bottom tabs exports`). Use `feat`, `fix`, `chore`, `docs`, etc., with the package or platform as the scope.
- Pull requests should include: a concise summary, linked issues, clear testing notes (commands run, devices used), and screenshots or screen recordings for UI-visible changes.
- Keep changeset size minimal; split platform and JS-only changes when possible. Update documentation (`README.md`, `AGENTS.md`, package docs) when behavior or commands change.
