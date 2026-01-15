import { splitProps, children as resolveChildren } from "solid-js";
import type { ParentComponent } from "solid-js";
import type { ScreenContainerProps } from "./types";

/**
 * Container component that manages a stack of Screen components.
 *
 * Place Screen components as children. Only the topmost active
 * screen will be visible, with animations handled automatically.
 *
 * @example
 * ```tsx
 * <ScreenContainer style={{ flex: 1 }}>
 *   <Screen screenKey="home" active={route === 'home'}>
 *     <HomeScreen />
 *   </Screen>
 *   <Screen screenKey="details" active={route === 'details'}>
 *     <DetailsScreen />
 *   </Screen>
 * </ScreenContainer>
 * ```
 */
export const ScreenContainer: ParentComponent<ScreenContainerProps> = (
  props
) => {
  const [local] = splitProps(props, ["style", "children"]);
  const resolved = resolveChildren(() => local.children);

  // Always include flex: 1 to ensure proper layout
  const finalStyle = { flex: 1, ...local.style };

  return (
    // @ts-ignore: Custom native element
    <zynth-screen-container style={finalStyle}>
      {resolved()}
    </zynth-screen-container>
  );
};
