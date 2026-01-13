import { splitProps, children as resolveChildren, mergeProps } from "solid-js";
import type { ParentComponent } from "solid-js";
import type { ScreenProps } from "./types";
import type { Style } from "@rune/core";

/**
 * Individual screen primitive with built-in animations.
 *
 * Use inside a ScreenContainer. Set `active={true}` to show
 * the screen, `active={false}` to hide it. Transitions are
 * animated automatically based on the `animation` prop.
 *
 * @example
 * ```tsx
 * <Screen
 *   screenKey="profile"
 *   active={currentRoute === 'profile'}
 *   animation="push"
 *   gestureEnabled={true}
 *   onDidAppear={() => console.log('Profile appeared')}
 * >
 *   <ProfileContent />
 * </Screen>
 * ```
 */
export const Screen: ParentComponent<ScreenProps> = (props) => {
  const merged = mergeProps(
    {
      animation: "push" as const,
      gestureEnabled: true,
      style: { flex: 1 },
    },
    props
  );

  const [local] = splitProps(merged, [
    "screenKey",
    "active",
    "covered",
    "animation",
    "gestureEnabled",
    "headerOptions",
    "onNativeBack",
    "onNativeHeaderRightPress",
    "onWillAppear",
    "onDidAppear",
    "onWillDisappear",
    "onDidDisappear",
    "style",
    "children",
  ]);

  // Use absolute positioning to ensure screens overlap and fill the container
  // instead of stacking and sharing space (which causes the "cut in half" bug).
  const finalStyle: Style = {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: DEFAULT_SCREEN_BACKGROUND,
    ...(local.style as Style),
  };

  const resolved = resolveChildren(() => local.children);

  return (
    // @ts-ignore: Custom native element
    <rune-screen
      screenKey={local.screenKey}
      active={local.active}
      covered={local.covered}
      animation={local.animation}
      gestureEnabled={local.gestureEnabled}
      headerOptions={local.headerOptions}
      onNativeBack={local.onNativeBack}
      onNativeHeaderRightPress={local.onNativeHeaderRightPress}
      onWillAppear={local.onWillAppear}
      onDidAppear={local.onDidAppear}
      onWillDisappear={local.onWillDisappear}
      onDidDisappear={local.onDidDisappear}
      style={finalStyle}
    >
      {resolved()}
    </rune-screen>
  );
};
const DEFAULT_SCREEN_BACKGROUND = "#ffffff";
