import { createMemo } from "solid-js";
import { createSafeAreaInsets } from "@rune/safe-area";
import {
  createTabBarMetricsAccessor,
  type TabBarMetrics,
} from "../core/tabMetrics";

const IOS_HEADER_HEIGHT = 44;

export interface HeaderMetrics {
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

export function createTabBarMetrics(extraHeight = 0): () => TabBarMetrics {
  return createTabBarMetricsAccessor(undefined, extraHeight);
}
