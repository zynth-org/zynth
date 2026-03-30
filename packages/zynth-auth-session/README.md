# AuthSession

Secure, web-based authentication transitions for Zynth applications, providing a unified interface for OAuth2 and OpenID Connect flows.

`@zynth/auth-session` manages the lifecycle of authentication requests by leveraging native browser components (**ASWebAuthenticationSession** on iOS and **Custom Tabs** on Android). This ensures that credentials remain isolated from the application and that redirects are captured securely by the native OS.

## Basic usage

### Starting an Auth Session

The `startAsync` method opens a secure browser window to the specified `authUrl`. It resolves when the user completes the flow via the `redirectUri` or cancels the session.

```tsx
import { AuthSession } from "@zynth/auth-session";

const authenticate = async () => {
  const result = await AuthSession.startAsync({
    authUrl: "https://auth.example.com/authorize?...",
    redirectUri: "my-app://auth-callback"
  });

  if (result.type === "success") {
    // Session completed, handle redirect URL
    console.log("Redirect URL:", result.url);
    console.log("Query Params:", result.params);
  }
};
```

### Generating Redirect URIs

Use `makeRedirectUri` to construct a compliant callback URL that the native OS can intercept.

```ts
const redirectUri = AuthSession.makeRedirectUri({
  scheme: "my-app",
  path: "callback"
});
// Result: "my-app://callback"
```

## Advanced

### PKCE and Security Helpers

For secure OAuth2 flows, Zynth provides built-in helpers for producing PKCE (Proof Key for Code Exchange) values and random state strings.

> [!IMPORTANT]
> These helpers require a native installation of `@zynth/crypto`.

```tsx
import { AuthSession } from "@zynth/auth-session";

const login = async () => {
  // 1. Generate security values
  const state = await AuthSession.generateStateAsync();
  const pkce = await AuthSession.createPKCEAsync();

  // 2. Build the authorization URL
  const authUrl = AuthSession.buildAuthorizationUrl({
    authorizationEndpoint: "https://auth.example.com/oauth2/authorize",
    clientId: "my-client-id",
    redirectUri: AuthSession.makeRedirectUri({ scheme: "my-app" }),
    scopes: ["openid", "profile"],
    state,
    codeChallenge: pkce.codeChallenge
  });

  // 3. Start the session
  const result = await AuthSession.startAsync({ authUrl, redirectUri });
  
  // 4. Validate the response
  const validation = AuthSession.validateAuthResponse({
    result,
    expectedState: state
  });

  if (validation.ok) {
    console.log("Authorization Code:", validation.code);
  }
};
```

## Special cases

- **Ephemeral Sessions**: On iOS, you can request an ephemeral session via the `preferEphemeralSession` option (part of `AuthSessionRequest`). This prevents the browser from sharing cookies and website data with other sessions, effectively providing a "private" login mode.
- **Native Implementation**: 
  - On **iOS**, the library uses `ASWebAuthenticationSession` which provides automatic redirect capture and system-level security prompts.
  - On **Android**, it utilizes **Chrome Custom Tabs** combined with intent-polling to detect when the browser returns to the application via a deep link.
- **Web Fallback**: If the native bridge is unavailable, the library can open a standard browser popup if `allowInsecureWebPopupFallback` is enabled. Note that redirects cannot be captured automatically in this mode.

## API Reference

### `AuthSession` Methods

- `startAsync(request: AuthSessionRequest): Promise<AuthSessionResult>`
- `dismissAuthSession(): Promise<AuthSessionDismissResult>`
- `makeRedirectUri(options: MakeRedirectUriOptions): string`
- `createPKCEAsync(options?: CreatePkceOptions): Promise<AuthSessionPkcePair>`
- `generateStateAsync(options?: CreateStateOptions): Promise<string>`
- `buildAuthorizationUrl(options: BuildAuthorizationUrlOptions): string`
- `validateAuthResponse(options: ValidateAuthSessionResponseOptions): ValidateAuthSessionResponseResult`

### `AuthSessionResult` (Type)
- `type: "success" | "cancel" | "dismiss" | "error"`
- `url?: string`
- `params?: Record<string, string>`
- `errorCode?: string`
- `errorMessage?: string`
