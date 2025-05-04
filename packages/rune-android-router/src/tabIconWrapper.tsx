import type { ParentComponent } from "solid-js";
import type { Style } from "@rune/core";

const wrapperStyle: Style = {
  width: "100%",
  height: "100%",
  alignItems: "center",
  justifyContent: "center",
};

export const TabIconWrapper: ParentComponent = (props) => {
  return (
    <view style={wrapperStyle as any} pointerEvents="none">
      {props.children}
    </view>
  );
};
