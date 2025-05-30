import type { ParentComponent } from "solid-js";
import type { TabBarProps } from "../core/types";

export const TabBar: ParentComponent<TabBarProps> = (props) => {
  return props.children ?? null;
};
