import type { StackHeaderProps } from "../core/types";
import type { ParentComponent } from "solid-js";

export const Header: ParentComponent<StackHeaderProps> = (props) => {
  return props.children ?? null;
};
