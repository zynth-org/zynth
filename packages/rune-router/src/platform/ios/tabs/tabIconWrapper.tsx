import type { ParentComponent } from "solid-js";
import type { Style } from "@rune/core";
import { View } from "@rune/components";

const wrapperStyle: Style = {
  width: "100%",
  height: "100%",
  alignItems: "center",
  justifyContent: "center",
};

export const TabIconWrapper: ParentComponent = (props) => {
  return (
    <View style={wrapperStyle} pointerEvents="none">
      {props.children}
    </View>
  );
};
