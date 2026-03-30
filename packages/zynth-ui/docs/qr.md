# @zynth/ui QRCode

Native-backed, dependency-free QR rendering for Zynth apps.

`QRCode` combines:

- UTF-8 byte-mode QR generation with selectable EC level (`L`, `M`, `Q`, `H`)
- Native raster output on iOS/Android (single image render path)
- Web/unsupported-native fallback renderer (no SVG)
- Optional centered logo with safety clamps by EC level

## Basic

### Install

```bash
npm i @zynth/ui
```

Regenerate native projects after adding the package.

### Basic usage

```tsx
import { QRCode } from "@zynth/ui";

<QRCode value="https://zynthai.com" />;
```

### Styled usage

```tsx
import { QRCode } from "@zynth/ui";

<QRCode
  value="https://zynthai.com/docs"
  size={220}
  level="M"
  color="#111111"
  backgroundColor="#ffffff"
  quietZone={4}
/>;
```

### Logo usage

```tsx
import { QRCode } from "@zynth/ui";
import logo from "../assets/logo.png";

<QRCode
  value="https://zynthai.com/invite/abc123"
  level="H"
  size={240}
  logoSource={logo}
  logoScale={0.18}
  logoPadding={8}
  logoBackgroundColor="#ffffff"
  logoBorderRadius={14}
/>;
```

## Advanced

### Rendering behavior (platform)

- iOS/Android:
  - `QRCode` generates the module matrix in JS and calls secure native module `ZynthUI.generateQRCode`.
  - Native returns a PNG payload that is rendered as a single `Image`.
- Web (or when native module is unavailable):
  - Falls back to JS rendering using `View` row-segments.
- No SVG path is used.

### Logo safety clamps by EC level

Logo size is clamped automatically to preserve scan reliability:

- `L`: max `8%`
- `M`: max `12%`
- `Q`: max `16%`
- `H`: max `22%`

Clamp rules:

- If `logoSize` is provided, it is clamped to the max allowed by level.
- If `logoScale` is provided, it is clamped to level max.
- If neither is provided and `logoSource` exists, default requested scale is `min(0.2, levelMax)`.

### QR version range and payload limits

Current matrix generator supports QR versions `1..10`.

- `minVersion` and `maxVersion` are constrained to that range.
- If payload does not fit selected range/level, generation throws.
- Empty `value` throws.

### Recommended settings

- No logo: `M` is a good default balance.
- With logo: prefer `H` for best real-world scan resilience.
- Keep quiet zone at `4` unless you have strict layout constraints.

## API reference

### `QRCode`

Props:

- `value: string`
  - Required payload.
- `size?: number`
  - Square size in logical pixels.
  - Default: `192`.
- `color?: string`
  - Dark module color.
  - Default: `#000000`.
- `backgroundColor?: string`
  - Light/background color.
  - Default: `#ffffff`.
- `quietZone?: number`
  - Quiet zone in module units.
  - Default: `4`.
- `level?: "L" | "M" | "Q" | "H"`
  - Error correction level.
  - Default: `"M"`.
- `minVersion?: number`
  - Lower bound for auto version selection.
- `maxVersion?: number`
  - Upper bound for auto version selection.
  - Effective support is `<= 10`.

Logo props:

- `logoSource?: ImageSource`
  - Enables centered logo overlay.
- `logoScale?: number`
  - Requested logo scale relative to `size` (`0..1`), auto-clamped by EC level.
- `logoSize?: number`
  - Fixed logo size in px (overrides `logoScale`), still clamped by EC level.
- `logoPadding?: number`
  - Padding around logo.
  - Default: `6`.
- `logoBackgroundColor?: string`
  - Background behind logo container.
  - Default: QR background color.
- `logoBorderRadius?: number`
  - Logo container radius.
  - Default: `floor(containerSize * 0.24)`.

Inherited view props:

- `style`, `onLayout`, `testID`, `accessibility*`, and standard `ViewProps` from `@zynth/components`.

## Notes

- Native generation is invoked through the secure module bridge (no direct global host-object usage).
- Public JS API is stable at component level; native implementation is intentionally internal.
