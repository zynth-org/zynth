import { type ParentComponent } from "solid-js";
import type { Style, StyleProp } from "@rune/core";
import { useStyle } from "./hooks/useStyle";

type PointerEvents = "auto" | "none" | "box-none" | "box-only";

// Re-export StyleProp for external use
export type { StyleProp };
export { useStyle };

export const View: ParentComponent<{
  style?: StyleProp;
  onPress?: () => void;
  pointerEvents?: PointerEvents;
}> = (p) => {
  const style = useStyle(() => p.style);
  return (
    <view style={style()} onPress={p.onPress} pointerEvents={p.pointerEvents}>
      {p.children}
    </view>
  );
};

export const Text: ParentComponent<{ style?: StyleProp }> = (p) => {
  const style = useStyle(() => p.style);
  return <text style={style()}>{p.children}</text>;
};
