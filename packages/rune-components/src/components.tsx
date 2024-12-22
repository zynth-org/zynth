import type { ParentComponent } from "solid-js";
import type { Style } from "@rune/core";

type PointerEvents = "auto" | "none" | "box-none" | "box-only";

export const View: ParentComponent<{
  style?: Style;
  onPress?: () => void;
  pointerEvents?: PointerEvents;
}> = (p) => (
  <view style={p.style} onPress={p.onPress} pointerEvents={p.pointerEvents}>
    {p.children}
  </view>
);

export const Text: ParentComponent<{ style?: Style }> = (p) => (
  <text style={p.style}>{p.children}</text>
);
