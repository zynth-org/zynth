import { splitProps, children as resolveChildren } from "solid-js";
import type { ParentComponent } from "solid-js";
import type { ScreenContainerProps } from "./types";

/**
 * Container component that manages a stack of Screen components
 * specifically for Bottom Sheet use cases (no navigation bar, custom transitions).
 *
 * @example
 * ```tsx
 * <ScreenSheetContainer style={{ flex: 1 }}>
 *   <Screen screenKey="home" active={route === 'home'}>
 *     <HomeScreen />
 *   </Screen>
 * </ScreenSheetContainer>
 * ```
 */
export const ScreenSheetContainer: ParentComponent<ScreenContainerProps> = (
  props
) => {
  const [local] = splitProps(props, ["style", "children"]);
  const resolved = resolveChildren(() => local.children);

  // Always include flex: 1 to ensure proper layout
  const finalStyle = { flex: 1, ...local.style };

  return (
    // @ts-ignore: Custom native element
    <rune-screen-sheet-container style={finalStyle}>
      {resolved()}
    </rune-screen-sheet-container>
  );
};
