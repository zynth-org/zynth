import type { HostNode, StyleProp } from "@zynth/core";
import type { JSX } from "solid-js";
import type {
  FlingGestureEvent,
  LongPressGestureEvent,
  PanGestureEvent,
  PinchGestureEvent,
  RotationGestureEvent,
  TapGestureEvent,
} from "./types";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "zynth-gesture-detector": {
        style?: StyleProp;
        pointerEvents?: "auto" | "none" | "box-none" | "box-only";
        panSharedSignalX?: number;
        panSharedSignalY?: number;
        testID?: string;
        longPressMinDurationMs?: number;
        flingMinVelocity?: number;
        ref?: (node: HostNode | null) => void;
        onTapGesture?: (event: TapGestureEvent) => void;
        onLongPressGesture?: (event: LongPressGestureEvent) => void;
        onRotationGesture?: (event: RotationGestureEvent) => void;
        onPinchGesture?: (event: PinchGestureEvent) => void;
        onFlingGesture?: (event: FlingGestureEvent) => void;
        onPanGesture?: (event: PanGestureEvent) => void;
        children?: JSX.Element;
      };
    }
  }
}
