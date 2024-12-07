import type { ParentComponent } from "solid-js";
import type { Style } from "@rune/core";

export const View: ParentComponent<{ style?: Style; onPress?: () => void }> = (p) => (
  <view style={p.style} onPress={p.onPress}>
    {p.children}
  </view>
);

export const Text: ParentComponent<{ style?: Style }> = (p) => (
  <text style={p.style}>{p.children}</text>
);
