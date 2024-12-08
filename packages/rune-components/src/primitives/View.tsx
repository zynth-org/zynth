import type { ParentComponent } from "solid-js";
import type { Style } from "@rune/core";

export interface ViewProps {
  style?: Style;
  onPress?: () => void;
}

export const View: ParentComponent<ViewProps> = (props) => {
  const { style, onPress, children } = props;
  return (
    <view style={style as any} onPress={onPress}>
      {children}
    </view>
  );
};
