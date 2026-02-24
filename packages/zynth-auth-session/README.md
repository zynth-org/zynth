# @zynth/auth-session

Secure auth session primitives for Zynth, including PKCE helpers for OAuth.

## Dependencies

- Requires `@zynth/core`
- Requires `@zynth/crypto` for secure PKCE and `state` generation

If crypto is unavailable, PKCE helpers fail with `E_CRYPTO_UNAVAILABLE` and a developer-facing message explaining how to fix installation.

## API

- `AuthSession.startAsync(request)`
- `AuthSession.dismissAuthSession()`
- `AuthSession.makeRedirectUri(options)`
- `AuthSession.isAvailable()`
- `AuthSession.isCryptoAvailable()`
- `AuthSession.getCryptoWarningMessage()`
- `AuthSession.createPKCEAsync(options?)`
- `AuthSession.generateStateAsync(options?)`
- `AuthSession.buildAuthorizationUrl(options)`
- `AuthSession.validateAuthResponse(options)`

## Security Notes

- PKCE uses `code_challenge_method=S256`.
- Web fallback is disabled by default because secure redirect capture is not guaranteed in all runtimes.
- To explicitly open an insecure popup fallback on web, pass `allowInsecureWebPopupFallback: true` to `startAsync`.
