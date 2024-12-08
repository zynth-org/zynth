# Rune Components TODO

## Image component follow-ups

- Support `require()` / static asset resolution once the HMR-enabled bundler lands.
- Add request configuration (headers whitelist, HTTP method, cache policy, retry/backoff, progress events).
- Implement placeholder/render-state props (loading, error fallback, default tint handling).
- Wire accessibility roles/traits and keyboard focus semantics.
- Share caching/decoding strategy across platforms (in-memory + disk, background decode, memory warning hooks).
- Expand automated coverage (JS unit tests and native integration tests) to cover load, error, tint, and layout regression cases.
