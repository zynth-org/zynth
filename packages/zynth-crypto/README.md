# @zynth/crypto

Native WebCrypto-compatible primitives for Zynth.

## API

- `Crypto.getRandomValues(typedArray)`
- `Crypto.randomUUID()`
- `Crypto.subtle.digest(algorithm, data)`
- `Crypto.subtle.importKey("raw", keyData, algorithm, extractable, usages)`
- `Crypto.subtle.exportKey("raw", key)`
- `Crypto.subtle.generateKey(algorithm, extractable, usages)`
- `Crypto.subtle.sign({ name: "HMAC" }, key, data)`
- `Crypto.subtle.verify({ name: "HMAC" }, key, signature, data)`
- `Crypto.subtle.deriveBits(algorithm, baseKey, length)`
- `Crypto.subtle.encrypt({ name: "AES-GCM", ... }, key, data)`
- `Crypto.subtle.decrypt({ name: "AES-GCM", ... }, key, data)`
- `installGlobalCrypto()`

## Usage

```ts
import { Crypto, installGlobalCrypto } from "@zynth/crypto";

installGlobalCrypto();

const bytes = new Uint8Array(32);
Crypto.getRandomValues(bytes);

const id = Crypto.randomUUID();
const digest = await Crypto.subtle.digest("SHA-256", bytes);
```
