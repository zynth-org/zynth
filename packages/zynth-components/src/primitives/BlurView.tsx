import { children as resolveChildren,  createSignal, onCleanup } from "solid-js";
import type { Element as SolidElement, ParentComponent } from "solid-js";
import type { HostNode, Style } from "@zynthjs/core";
import { effect,  setProperty } from "@zynthjs/core";

export type BlurViewTint = "default" | "light" | "dark";
export type BlurViewVariant = "blur" | "glass";

export interface BlurViewProps {
  style?: Style;
  children?: SolidElement;
  intensity?: number;
  tint?: BlurViewTint;
  variant?: BlurViewVariant;
  interactive?: boolean;
  tintColor?: string;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  testID?: string;
}

export const BlurView: ParentComponent<BlurViewProps> = (props) => {
  const local = props;
  const resolvedChildren = resolveChildren(() => local.children);
  const [hostNode, setHostNode] = createSignal<HostNode | null>(null, { ownedWrite: true });

  const refProp = (node: HostNode | null) => {
    if (node) {
      if (local.style != null) setProperty(node, "style", local.style);
      if (local.intensity != null) setProperty(node, "blurIntensity", local.intensity);
      if (local.tint != null) setProperty(node, "blurTint", local.tint);
      if (local.variant != null) setProperty(node, "blurVariant", local.variant);
      setProperty(node, "interactive", local.interactive ?? false);
      if (local.tintColor != null) setProperty(node, "tintColor", local.tintColor);
      if (local.pointerEvents != null) setProperty(node, "pointerEvents", local.pointerEvents);
      if (local.testID != null) setProperty(node, "testID", local.testID);
    }
    setHostNode(node);
  };

  effect(
    () => ({
      node: hostNode(),
      style: local.style,
      intensity: local.intensity,
      tint: local.tint,
      variant: local.variant,
      interactive: local.interactive ?? false,
      tintColor: local.tintColor,
      pointerEvents: local.pointerEvents,
      testID: local.testID,
    }),
    ({ node, style, intensity, tint, variant, interactive, tintColor, pointerEvents, testID }) => {
      if (!node) return;
      if (style != null) setProperty(node, "style", style);
      if (intensity != null) setProperty(node, "blurIntensity", intensity);
      if (tint != null) setProperty(node, "blurTint", tint);
      if (variant != null) setProperty(node, "blurVariant", variant);
      setProperty(node, "interactive", interactive);
      if (tintColor != null) setProperty(node, "tintColor", tintColor);
      if (pointerEvents != null) setProperty(node, "pointerEvents", pointerEvents);
      if (testID != null) setProperty(node, "testID", testID);
    }
  , { scope: true });

  onCleanup(() => {
    setHostNode(null);
  });

  return (
    <blur-view ref={refProp}>
      {resolvedChildren()}
    </blur-view>
  );
};
