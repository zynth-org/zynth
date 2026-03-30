# Crypto

Standard-compliant native implementation of the WebCrypto API for Zynth applications, providing hardware-accelerated cryptographic primitives.

`@zynth/crypto` exposes a subset of the **W3C Web Cryptography API**, leveraging **CryptoKit/CommonCrypto** on iOS and **java.security/javax.crypto** on Android. It is designed for high-performance hashing, encryption, and key derivation.

## Basic usage

### Strong Randomness and IDs

Zynth provides native sources for cryptographically strong random values and UUIDs.

```tsx
import { Crypto } from "@zynth/crypto";

// 1. Get random bytes (max 65,536 bytes)
const bytes = new Uint8Array(32);
Crypto.getRandomValues(bytes);

// 2. Generate a random UUID (v4)
const uuid = Crypto.randomUUID();
```

### Hashing (Digest)

Compute SHA-family hashes using hardware acceleration.

```ts
const data = new TextEncoder().encode("Hello Zynth");
const hashBuffer = await Crypto.subtle.digest("SHA-256", data);
```

## Advanced

### HMAC Signing and Verification

Authenticate messages using HMAC with SHA hashes.

```tsx
const key = await Crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode("my-secret-key"),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"]
);

const signature = await Crypto.subtle.sign("HMAC", key, data);
const isValid = await Crypto.subtle.verify("HMAC", key, signature, data);
```

### Key Derivation (PBKDF2 / HKDF)

Derive high-entropy keys from passwords or master secrets.

```tsx
const masterKey = await Crypto.subtle.importKey(
  "raw",
  masterSecret,
  { name: "HKDF" },
  false,
  ["deriveBits"]
);

const derivedBits = await Crypto.subtle.deriveBits(
  {
    name: "HKDF",
    hash: "SHA-256",
    salt: new Uint8Array(16),
    info: new Int8Array(0)
  },
  masterKey,
  256 // length in bits
);
```

### Symmetric Encryption (AES-GCM)

Perform authenticated symmetric encryption using AES in GCM mode.

```tsx
const key = await Crypto.subtle.generateKey(
  { name: "AES-GCM", length: 256 },
  true,
  ["encrypt", "decrypt"]
);

const iv = Crypto.getRandomValues(new Uint8Array(12));
const ciphertext = await Crypto.subtle.encrypt(
  { name: "AES-GCM", iv },
  key,
  plaintext
);
```

## Special cases

- **Global Integration**: You can install Zynth Crypto as the global `crypto` object for compatibility with third-party libraries.
  ```ts
  import { installGlobalCrypto } from "@zynth/crypto";
  installGlobalCrypto(); // Now global.crypto is available
  ```
- **Input Limits**: To maintain stability across the JS-native bridge, single-operation inputs are capped at **16 MB**. Requesting `getRandomValues` for more than **64 KB** at once will also result in an error.
- **Base64 Encoding**: Internal communication across the bridge uses highly optimized Base64 serialization to ensure zero-latency data transfer between the Hermes engine and native security modules.

## API Reference

### `Crypto` Methods

- `getRandomValues(typedArray: T): T`
- `randomUUID(): string`
- `subtle: SubtleCrypto`

### `SubtleCrypto` Methods

- `digest(algorithm, data): Promise<ArrayBuffer>`
- `importKey(format, keyData, algorithm, extractable, usages): Promise<CryptoKey>`
- `exportKey(format, key): Promise<ArrayBuffer>`
- `generateKey(algorithm, extractable, usages): Promise<CryptoKey>`
- `sign(algorithm, key, data): Promise<ArrayBuffer>`
- `verify(algorithm, key, signature, data): Promise<boolean>`
- `deriveBits(algorithm, baseKey, length): Promise<ArrayBuffer>`
- `encrypt(algorithm, key, data): Promise<ArrayBuffer>`
- `decrypt(algorithm, key, data): Promise<ArrayBuffer>`

### Supported Algorithms

- **Hashing**: SHA-1, SHA-256, SHA-384, SHA-512.
- **HMAC**: SHA-1, SHA-256, SHA-384, SHA-512.
- **Encryption**: AES-GCM (128, 192, 256 bit keys).
- **Derivation**: HKDF, PBKDF2.
