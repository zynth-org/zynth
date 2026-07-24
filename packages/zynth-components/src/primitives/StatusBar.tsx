import {  createSignal, onCleanup, type Component } from "solid-js";
import type { HostNode } from "@zynthjs/core";
import { effect,  setProperty } from "@zynthjs/core";

export type StatusBarStyle = "default" | "light-content" | "dark-content";
export type StatusBarAnimation = "none" | "fade" | "slide";

export interface StatusBarProps {
  /** Animate status bar appearance changes where supported. */
  animated?: boolean;
  /** Background color for the status bar. */
  backgroundColor?: string;
  /** Status bar content style. */
  barStyle?: StatusBarStyle;
  /** Animation for show/hide transitions (iOS only). */
  showHideTransition?: StatusBarAnimation;
  /** Whether the status bar is hidden. */
  hidden?: boolean;
}

export const StatusBar: Component<StatusBarProps> = (props) => {
  const local = props;
  const [hostNode, setHostNode] = createSignal<HostNode | null>(null, { ownedWrite: true });

  const refProp = (node: HostNode | null) => {
    if (node) {
      setProperty(node, "animated", local.animated ?? false);
      if (local.backgroundColor != null) setProperty(node, "backgroundColor", local.backgroundColor);
      setProperty(node, "barStyle", local.barStyle ?? "default");
      setProperty(node, "showHideTransition", local.showHideTransition ?? "fade");
      setProperty(node, "hidden", local.hidden ?? false);
    }
    setHostNode(node);
  };

  effect(
    () => ({
      node: hostNode(),
      animated: local.animated ?? false,
      backgroundColor: local.backgroundColor,
      barStyle: local.barStyle ?? "default",
      showHideTransition: local.showHideTransition ?? "fade",
      hidden: local.hidden ?? false,
    }),
    ({ node, animated, backgroundColor, barStyle, showHideTransition, hidden }) => {
      if (!node) return;
      setProperty(node, "animated", animated);
      if (backgroundColor != null) setProperty(node, "backgroundColor", backgroundColor);
      setProperty(node, "barStyle", barStyle);
      setProperty(node, "showHideTransition", showHideTransition);
      setProperty(node, "hidden", hidden);
    }
  , { scope: true });

  onCleanup(() => {
    setHostNode(null);
  });

  return (
    <zynth-status-bar ref={refProp} />
  );
};
