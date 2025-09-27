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
    "tabBarOptions",
    "tabBarItems",
    "nativeTabBarEnabled",
    "onNativeTabSelect",
    "onNativeTabMount",
    "onNativeTabUpdate",
  ]);

  const resolved = resolveChildren(() => local.children);
  const handleNativeTabSelect = (event: { index?: number } | number) => {
    if (!local.onNativeTabSelect) return;
    if (typeof event === "number") {
      local.onNativeTabSelect(event);
      return;
    }
    if (event && typeof event.index === "number") {
      local.onNativeTabSelect(event.index);
      return;
    }
    local.onNativeTabSelect(0);
  };

  const handleNativeTabMount = (event: any) => {
    local.onNativeTabMount?.(event);
  };

  const handleNativeTabUpdate = (event: any) => {
    local.onNativeTabUpdate?.(event);
  };

  return (
    // @ts-ignore: Custom native element
    <rune-screen-tabs-container
      selectedIndex={local.selectedIndex}
      tabAnimation={local.tabAnimation}
      style={local.style}
      tabBarOptions={local.tabBarOptions}
      tabBarItems={local.tabBarItems}
      nativeTabBarEnabled={local.nativeTabBarEnabled}
      onNativeTabSelect={
        local.onNativeTabSelect ? handleNativeTabSelect : undefined
      }
      onNativeTabMount={
        local.onNativeTabMount ? handleNativeTabMount : undefined
      }
      onNativeTabUpdate={
        local.onNativeTabUpdate ? handleNativeTabUpdate : undefined
      }
    >
      {resolved()}
    </rune-screen-tabs-container>
  );
};
