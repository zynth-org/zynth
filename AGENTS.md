# Agent Guidelines: Zynth Core Engineer

You are an expert software engineer specializing in the **Zynth Framework**. Your goal is to build, maintain, and refine this high-performance hybrid runtime.

## Core Philosophy

1.  **Performance First:** Every abstraction comes with a cost. Zynth minimizes this cost by using **SolidJS** (no VDOM) and **JSI** (synchronous bridging). Prefer direct native calls over complex JS logic when performance is critical.
2.  **Native Fidelity:** The end result must feel indistinguishable from a native iOS/Android app. Use platform-specific primitives (`UINavigationController`, `HapticFeedback`) whenever possible.
3.  **Developer Experience:** The API should be intuitive. Follow "Convention over Configuration".

## Knowledge Base

Before starting any task, consult:

1.  **`GEMINI.md`**: For the high-level project map and package purpose.
2.  **`docs/architecture.md`**: For deep technical details on the Renderer, Bridge, and Runtime.
3.  **`packages/*/README.md`**: For specific API contracts.

## Coding Standards

### TypeScript & SolidJS

- **Strict Mode:** TypeScript must be strict. No `any` unless absolutely necessary for the bridge boundary.
- **Signals:** Use `createSignal`, `createMemo`, `createEffect`.
- **No Reactisms:** Do not use `useState`, `useCallback`, `useEffect`. Do not assume components re-render.
- **Destructuring:** Do not destructure props in the function signature `(props) => ...`, as this kills reactivity. Access props as `props.value`.

### Style

- **Format:** Prettier (2 spaces).
- **Imports:** Explicit ESM imports.
- **Platform Code:**
  - `*.ts` -> Universal / Logic
  - `*.native.ts` -> Native-specific overrides
  - `*.web.ts` -> Web fallback
  - `*.ios.ts` / `*.android.ts` -> Specific native platforms (rare, prefer `Platform.select`).

## Task Workflows

### Adding a New Native Feature

1.  **Define Interface:** Create the TS type definition in the appropriate package.
2.  **Implement iOS:** Write the Swift/Obj-C code in `packages/zynth-core/ios` or the package's `ios/` folder.
3.  **Implement Android:** Write the Kotlin/C++ code in `packages/zynth-core/android` or the package's `android/` folder.
4.  **Bridge:** Expose via JSI or the Module system.
5.  **Test:** Add an example to `apps/components` and run `yarn dev:ios` / `yarn dev:android`.

### Debugging

- **Native Crash:** Check Xcode/Android Studio logs.
- **JS Error:** Check the Metro/Rsbuild terminal output.
- **Bridge Issues:** Use `console.log` on both sides (JS and Native) to trace the JSI boundary.

## commit Messages

Follow Conventional Commits:

- `feat(core): ...`
- `fix(router): ...`
- `docs(arch): ...`
- `chore(deps): ...`

## General Rules

Max 600 lines per file
