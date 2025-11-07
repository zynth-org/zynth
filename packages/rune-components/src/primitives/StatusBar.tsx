import { splitProps, type Component } from "solid-js";

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
  const [local] = splitProps(props, [
    "animated",
    "backgroundColor",
    "barStyle",
    "showHideTransition",
    "hidden",
  ]);

  return (
    <rune-status-bar
      animated={local.animated ?? false}
      backgroundColor={local.backgroundColor}
      barStyle={local.barStyle ?? "default"}
      showHideTransition={local.showHideTransition ?? "fade"}
      hidden={local.hidden ?? false}
    />
  );
};
