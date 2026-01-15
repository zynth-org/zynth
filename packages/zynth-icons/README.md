# @zynth/icons

Extensive icon library for Zynth applications.

This package provides thousands of icons from popular icon sets (FontAwesome, Ionicons, Material Design, etc.), optimized for the Zynth native runtime. It uses font-based rendering for crisp, scalable icons that respect text styling.

## Features

*   **Multiple Sets**: Includes Ai, Bi, Bs, Cg, Fa, Fi, Hi, Im, Io, Oc, Ri, Si, Tb, Ti, Vs, Wi sets.
*   **Dynamic Loading**: Only the font for the used icon set is loaded into memory.
*   **Style Integration**: Since they are font-based, you can style them using standard `Text` props like `color` and `fontSize`.

## Usage

```tsx
import { FaUser, IoSettings } from "@zynth/icons";

function MyHeader() {
  return (
    <View style={{ flexDirection: "row" }}>
      <FaUser style={{ color: "blue", fontSize: 24 }} />
      <IoSettings style={{ color: "gray", fontSize: 24 }} />
    </View>
  );
}
```

## Supported Icon Sets

*   `Fa`: Font Awesome
*   `Io`: Ionicons
*   `Ai`: Ant Design
*   `Bs`: Bootstrap Icons
*   ...and many more.