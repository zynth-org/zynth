import { children as resolveChildren,  createSignal, onCleanup } from "solid-js";
import type { Element as SolidElement, ParentComponent } from "solid-js";
import type { HostNode, Style } from "@zynthjs/core";
import { effect,  setProperty } from "@zynthjs/core";
import { platform } from "@zynthjs/apis";

export type GlassEffectStyle = "regular" | "clear" | "none";

export interface GlassViewProps {
  style?: Style;
  children?: SolidElement;
  effect?: GlassEffectStyle;
  interactive?: boolean;
  tintColor?: string;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  testID?: string;
}

export const GlassView: ParentComponent<GlassViewProps> = (props) => {
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
        if (local.effect != null) setProperty(node, "glassEffect", local.effect);
        setProperty(node, "interactive", local.interactive ?? true);
        if (local.tintColor != null) setProperty(node, "tintColor", local.tintColor);
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
      effect: local.effect,
      interactive: local.interactive ?? true,
      tintColor: local.tintColor,
    }),
    ({ node, style, pointerEvents, testID, effect, interactive, tintColor }) => {
      if (!node) return;
      if (style != null) setProperty(node, "style", style);
      if (pointerEvents != null) setProperty(node, "pointerEvents", pointerEvents);
      if (testID != null) setProperty(node, "testID", testID);
      if (!isAndroid) {
        if (effect != null) setProperty(node, "glassEffect", effect);
        setProperty(node, "interactive", interactive);
        if (tintColor != null) setProperty(node, "tintColor", tintColor);
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
    <glass-view ref={refProp}>
      {resolvedChildren()}
    </glass-view>
  );
};
