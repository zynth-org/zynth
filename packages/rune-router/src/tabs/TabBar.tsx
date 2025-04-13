import type { TabBarProps } from "../core/types";
import type { ParentComponent } from "solid-js";

export const TabBar: ParentComponent<TabBarProps> = (props) => {
  return props.children ?? null;
};
