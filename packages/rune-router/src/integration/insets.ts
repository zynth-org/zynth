import { createMemo } from "solid-js";
import { createSafeAreaInsets } from "@rune/safe-area";

const IOS_HEADER_HEIGHT = 44;
const IOS_TABBAR_HEIGHT = 50;

export interface HeaderMetrics {
  height: number;
  inset: number;
}

export interface TabBarMetrics {
  height: number;
  inset: number;
}

export function useHeaderMetrics(extraHeight = 0): () => HeaderMetrics {
  return createMemo(() => {
    const inset = createSafeAreaInsets().top;
    return {
      inset,
      height: IOS_HEADER_HEIGHT + inset + extraHeight,
    };
  });
}

export function useTabBarMetrics(extraHeight = 0): () => TabBarMetrics {
  return createMemo(() => {
    const inset = createSafeAreaInsets().bottom;
    return {
      inset,
      height: IOS_TABBAR_HEIGHT + inset + extraHeight,
    };
  });
}
