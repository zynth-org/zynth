import { children as resolveChildren,  createSignal, onCleanup } from "solid-js";
import type { Element as SolidElement, ParentComponent } from "solid-js";
import type { HostNode, Style } from "@zynthjs/core";
import { effect,  setProperty } from "@zynthjs/core";
import { platform } from "@zynthjs/apis";

export interface GlassContainerProps {
  style?: Style;
  children?: SolidElement;
  spacing?: number;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  testID?: string;
}

export const GlassContainer: ParentComponent<GlassContainerProps> = (props) => {
  const local = props;
  const resolvedChildren = resolveChildren(() => local.children);
  const [hostNode, setHostNode] = createSignal<HostNode | null>(null, { ownedWrite: true });

  const isAndroid = platform.current === "android";

  const refProp = (node: HostNode | null) => {
    if (node) {
      if (local.style != null) setProperty(node, "style", local.style);
      if (local.pointerEvents != null) setProperty(node, "pointerEvents", local.pointerEvents);
      if (local.testID != null) setProperty(node, "testID", local.testID);
      if (!isAndroid) {
        if (local.spacing != null) setProperty(node, "spacing", local.spacing);
      }
    }
    setHostNode(node);
  };

  effect(
    () => ({
      node: hostNode(),
      style: local.style,
      pointerEvents: local.pointerEvents,
      testID: local.testID,
      spacing: local.spacing,
    }),
    ({ node, style, pointerEvents, testID, spacing }) => {
      if (!node) return;
      if (style != null) setProperty(node, "style", style);
      if (pointerEvents != null) setProperty(node, "pointerEvents", pointerEvents);
      if (testID != null) setProperty(node, "testID", testID);
      if (!isAndroid) {
        if (spacing != null) setProperty(node, "spacing", spacing);
      }
    }
  , { scope: true });

  onCleanup(() => {
    setHostNode(null);
  });

  if (isAndroid) {
    return (
      <view ref={refProp}>
        {resolvedChildren()}
      </view>
    );
  }

  return (
    <glass-container ref={refProp}>
      {resolvedChildren()}
    </glass-container>
  );
};
