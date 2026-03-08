import { type ParentComponent } from "solid-js";
import type { Style, StyleProp } from "@zynth/core";
import { createStyle } from "./hooks/createStyle";

type PointerEvents = "auto" | "none" | "box-none" | "box-only";

// Re-export StyleProp for external use
export type { StyleProp };
export { createStyle };

export const View: ParentComponent<{
  style?: StyleProp;
  onPress?: () => void;
  pointerEvents?: PointerEvents;
}> = (p) => {
  const style = createStyle(() => p.style);
  return (
    <view style={style()} onPress={p.onPress} pointerEvents={p.pointerEvents}>
      {p.children}
    </view>
  );
};

export const Text: ParentComponent<{ style?: StyleProp }> = (p) => {
  const style = createStyle(() => p.style);
  return <text style={style()}>{p.children}</text>;
};
