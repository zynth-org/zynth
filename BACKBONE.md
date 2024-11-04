# Rune Backbone (Frozen Contracts)

**Do not change** without a deprecation plan:
- JS globals: `__startApp`, `__ui.*`, `__modules.call`
- `LayoutEngine` protocol (iOS native)
- `RuneModule` / `RuneModuleRegistry` shapes (native)
- Renderer host method names from `createRenderer` (TS)

**Extensions live here:**
- New native features → add a `RuneModule` & call via `__modules.call`
- New JS engine → implement `JSRuntimeAdapter` (keep runtime code)
- New layout backends → implement `LayoutEngine` (keep UIManager)
- Devtools → separate overlay windows and modules; no node mutation

**If a breaking change is inevitable:**
1) Add runtime shim so the old API still works.
2) Log a one-line `console.warn('[DEPRECATED] …')`.
3) Keep the shim for at least one minor release.

## Acceptance checks (CI or local scripts)

Add light, objective gates that catch drift:

- No DOM in bundle (compile-time guard)

```json
// package.json (repo root)
{
  "scripts": {
    "check:bundle": "grep -q 'document\\.' apps/sn-demo/dist/main.js && (echo 'DOM refs found' && exit 1) || exit 0"
  }
}
```

- Bridge shape only (TS compile ensures only declared methods are called).
- Smoke on iOS: app boots, Yoga layout correct, onPress works, counter ticks.
- No host API drift: forbid renames in LayoutEngine/module interfaces via codeowners/review or a simple grep baseline.
