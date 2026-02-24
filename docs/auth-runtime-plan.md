# Auth Runtime Plan: WebBrowser + AuthSession

## Goals

- Provide framework-level primitives for secure OAuth flows (Google, Facebook, OIDC providers).
- Support iOS and Android natively, with web best-effort fallback.
- Keep framework responsibility focused on browser/session orchestration, not app auth business logic.
- Preserve bridge security posture (`exportedMethods`, protected nonce/session checks).

## Non-Goals

- No provider-specific SDK adapters.
- No token exchange helpers.
- No crypto/PKCE helpers in this phase.
- No embedded WebView-based login baseline.

## Threat Model

### In Scope

- Bridge method abuse through non-exported method calls.
- Replay/misuse of sensitive auth-session calls.
- Redirect URI mismatch / callback confusion.
- Concurrent session confusion (overlapping auth attempts).

### Mitigations

- Explicit `exportedMethods` on all modules.
- `protectedMethods` for:
  - `openAuthSession`
  - `completeAuthSession`
  - `dismissAuthSession`
- Native URL validation and size limits.
- Single active session guard per runtime.
- Redirect URL matching by scheme/host/path.

## Package Split

- `@zynth/web-browser`
  - Open/dismiss system browser primitives.
  - Android warmup/cooldown hooks.
- `@zynth/auth-session`
  - Redirect-based session orchestration.
  - Completion/cancel/error event normalization.

## Platform Capability Matrix

| Capability | iOS | Android | Web |
|---|---|---|---|
| System browser open | `SFSafariViewController` | Custom Tabs | `window.open` |
| Auth session | `ASWebAuthenticationSession` | Custom Tabs + deep-link intent capture + `completeAuthSession` fallback | Popup best-effort |
| Dismiss browser | Yes | Best-effort false | No programmatic guarantee |
| Protected methods | Yes | Yes | N/A |

## API Contracts

## `@zynth/web-browser`

### TS API

- `WebBrowser.openBrowserAsync(options)`
- `WebBrowser.dismissBrowser()`
- `WebBrowser.warmUpAsync()`
- `WebBrowser.coolDownAsync()`
- `WebBrowser.isAvailable()`

### Types

- `OpenBrowserOptions`
  - `url`
  - `preferEphemeralSession?`
  - `toolbarColor?`
  - `controlsColor?`
  - `showTitle?`
  - `enableBarCollapsing?`
  - `createTask?`
- `WebBrowserResult`
  - `type: "opened" | "cancel" | "dismiss" | "error"`
  - `url?`
  - `errorCode?`
  - `errorMessage?`

### Native Module Methods

- `openBrowserAsync`
- `dismissBrowser`
- `warmUpAsync`
- `coolDownAsync`

### Events

- `WebBrowser.result`

## `@zynth/auth-session`

### TS API

- `AuthSession.startAsync(request)`
- `AuthSession.dismissAuthSession()`
- `AuthSession.makeRedirectUri(options)`
- `AuthSession.isAvailable()`

### Types

- `AuthSessionRequest`
  - `authUrl`
  - `redirectUri`
  - `preferEphemeralSession?`
  - `timeoutMs?`
- `AuthSessionResult`
  - `type: "success" | "cancel" | "dismiss" | "error"`
  - `url?`
  - `params?`
  - `errorCode?`
  - `errorMessage?`

### Native Module Methods

- `openAuthSession` (protected)
- `completeAuthSession` (protected)
- `dismissAuthSession` (protected)

### Events

- `AuthSession.result`

## Deep-Link Configuration Requirements

Android:

- Host app must add intent filter(s) for chosen callback URI scheme/host/path.
- Activity launch mode should allow deep-link delivery to the running activity (`singleTask` is currently used in demo app).
- If automatic completion is not sufficient for an app setup, app/runtime can invoke `completeAuthSession` with a captured callback URL.

iOS:

- Host app must register callback URL scheme(s) in `Info.plist` (`CFBundleURLTypes`).
- `ASWebAuthenticationSession` callback URL scheme must match the configured redirect URI.

## Test Matrix & Acceptance Checklist

- [ ] iOS success path returns `success` with callback URL and parsed params.
- [ ] iOS user cancel returns deterministic `cancel`.
- [ ] iOS dismiss API returns deterministic `dismiss`.
- [ ] Android success path returns `success` only once per request.
- [ ] Android dismiss returns deterministic `dismiss` when pending.
- [ ] Concurrent starts are rejected.
- [ ] Invalid `authUrl` (`http`, invalid, oversized) rejected natively.
- [ ] Invalid `redirectUri` (missing scheme, oversized) rejected natively.
- [ ] Protected methods fail with invalid session/nonce.
- [ ] Web fallback returns deterministic best-effort responses.

## Roadmap

### Phase 1 (current)

- Secure browser + auth session primitives.
- Protected bridge methods for sensitive session control.
- URL validation + session concurrency controls.

### Phase 2 (future)

- Crypto helpers (secure random, hashing utilities).
- PKCE helper set (verifier/challenge generation).
- Optional higher-level helper APIs for provider integration ergonomics.
