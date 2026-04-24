# Image

`Image` is the core primitive for displaying visual media. It supports a unified interface for remote URLs, local assets, base64 strings, and system-defined symbols (like SF Symbols on iOS). To ensure reliability, it features a built-in fallback mechanism that can rotate through multiple sources if the primary one fails to load.

## Basic Usage

The `source` prop accepts a variety of inputs, including direct strings (interpreted as URIs) or structured objects.

```tsx
import { Image, View } from "@zynthjs/components";

function ProfileHeader() {
  return (
    <View>
      {/* Remote URI */}
      <Image 
        source="https://example.com/avatar.png" 
        style={{ width: 100, height: 100 }} 
      />

      {/* Local Asset */}
      <Image 
        source={{ asset: "logo" }} 
        style={{ width: 48, height: 48 }} 
      />
    </View>
  );
}
```

## Resilience and Fallbacks

For critical assets where availability might be intermittent, `Image` allows passing an array of sources. The component will attempt to load them sequentially until one succeeds.

```tsx
<Image
  source={[
    { uri: "https://primary-cdn.com/asset.jpg" },
    { uri: "https://backup-cdn.com/asset.jpg" },
    { asset: "fallback_local" }
  ]}
  style={{ width: "100%", height: 300 }}
  onError={(e) => console.log("Final load failure:", e.message)}
/>
```

## Resize Modes

The `resizeMode` prop determines how the image should be scaled to fit its container:

- `cover`: Scales uniformly to fill the container, potentially cropping.
- `contain`: Scales uniformly to fit entirely within the container.
- `stretch`: Scales non-uniformly to fill the container exactly.
- `center`: Centers the image at its original size.

```tsx
<Image 
  source={bannerSource} 
  resizeMode="contain" 
  style={{ width: 400, height: 200 }} 
/>
```

## Tinting and Alpha Masking

Use `tintColor` to apply a solid color overlay to the image's non-transparent pixels. This is commonly used for stylizing icons or creating states without multiple assets.

```tsx
<Image 
  source={{ system: "star.fill" }} 
  tintColor="#FFD700" 
  style={{ width: 24, height: 24 }} 
/>
```

## Props

| Prop | Type | Description |
|---|---|---|
| `source` | `ImageSource \| ImageSource[]` | The image data (URI, Asset, Base64, or System). |
| `style` | `Style` | Styling for the image dimensions and boundaries. |
| `resizeMode` | `cover \| contain \| stretch \| center`| Scaling behavior. |
| `tintColor` | `string` | Color to apply to image masking. |
| `onLoad` | `(event) => void` | Triggered on successful image arrival. |
| `onError` | `(event) => void` | Triggered if all provided sources fail. |

### ImageSource Object Types

- **URI**: `{ uri: string }`
- **Asset**: `{ asset: string, scale?: number }`
- **Base64**: `{ data: string, mimeType?: string }`
- **System**: `{ system: string }` (Maps to SF Symbols or Android Drawables)
