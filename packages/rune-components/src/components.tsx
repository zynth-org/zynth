import { createMemo, type ParentComponent } from "solid-js";
import type { Style } from "@rune/core";

type PointerEvents = "auto" | "none" | "box-none" | "box-only";

export type StyleProp = Style | (Style | undefined | null)[];

const useStyle = (style: () => StyleProp | undefined) => {
  return createMemo(() => {
    const s = style();
    if (!Array.isArray(s)) return s;
    return s.reduce<Style>((acc, curr) => {
      if (!curr) return acc;
      return { ...acc, ...curr };
    }, {});
  });
};

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
