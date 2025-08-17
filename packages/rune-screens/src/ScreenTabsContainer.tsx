import { splitProps, children as resolveChildren, mergeProps } from "solid-js";
import type { ParentComponent } from "solid-js";
import type { ScreenTabsContainerProps } from "./types";

/**
 * Container for tab-based navigation content.
 *
 * Each direct child represents a tab's content. Only the tab
 * at `selectedIndex` is visible.
 *
 * Note: This component manages the content area only. The tab bar
 * itself should be rendered separately using your UI components.
 *
 * @example
 * ```tsx
 * <View style={{ flex: 1 }}>
 *   <ScreenTabsContainer selectedIndex={selectedTab} style={{ flex: 1 }}>
 *     <HomeTab />
 *     <SearchTab />
 *     <ProfileTab />
 *   </ScreenTabsContainer>
 *   <TabBar
 *     tabs={['Home', 'Search', 'Profile']}
 *     selectedIndex={selectedTab}
 *     onSelect={setSelectedTab}
 *   />
 * </View>
 * ```
 */
export const ScreenTabsContainer: ParentComponent<ScreenTabsContainerProps> = (
  props
) => {
  const merged = mergeProps(
    {
      selectedIndex: 0,
      tabAnimation: "none" as const,
    },
    props
  );

  const [local] = splitProps(merged, [
    "selectedIndex",
    "tabAnimation",
    "style",
    "children",
  ]);

  const resolved = resolveChildren(() => local.children);

  return (
    // @ts-ignore: Custom native element
    <rune-screen-tabs-container
      selectedIndex={local.selectedIndex}
      tabAnimation={local.tabAnimation}
      style={local.style}
    >
      {resolved()}
    </rune-screen-tabs-container>
  );
};
