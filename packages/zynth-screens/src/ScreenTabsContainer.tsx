import {
  children as resolveChildren,
  createEffect,
  createMemo,
  createSignal,
  merge,
  onCleanup,
  untrack,
} from "solid-js";
import type { ParentComponent } from "solid-js";
import type { HostNode, Style } from "@zynthjs/core";
import { setProperty } from "@zynthjs/core";
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
  // 1. Reactive defaults via merge (SolidJS 2.0 replaces mergeProps).
  //    Do NOT destructure: `merged` stays a reactive proxy.
  const merged = merge(
    {
      selectedIndex: 0,
      tabAnimation: "none" as const,
    },
    props
  );

  const resolved = resolveChildren(() => merged.children);

  // 2. Configure hostNode signal with ownedWrite: true (set from refProp)
  const [hostNode, setHostNode] = createSignal<HostNode | null>(null, {
    ownedWrite: true,
  });

  const resolvedStyle = createMemo<Style>(() => ({
    flex: 1,
    ...merged.style,
  }));

  // Normalize the native tab-select payload into a plain tab index.
  const handleNativeTabSelect = (event: number | { index?: number } | null) => {
    const onSelect = merged.onNativeTabSelect;
    if (!onSelect) return;
    if (typeof event === "number") {
      onSelect(event);
      return;
    }
    if (event && typeof event.index === "number") {
      onSelect(event.index);
      return;
    }
    onSelect(0);
  };

  const handleNativeTabMount = (event: {
    surfaceId: number;
    routeKey: string;
    active: boolean;
  }) => {
    merged.onNativeTabMount?.(event);
  };

  const handleNativeTabUpdate = (event: {
    surfaceId: number;
    routeKey: string;
    active?: boolean;
  }) => {
    merged.onNativeTabUpdate?.(event);
  };

  // 3. Helper to synchronize properties to the native host node.
  //    Handlers are always applied so clearing a callback propagates.
  const applyProps = (node: HostNode) => {
    if (merged.selectedIndex !== undefined)
      setProperty(node, "selectedIndex", merged.selectedIndex);
    if (merged.tabAnimation !== undefined)
      setProperty(node, "tabAnimation", merged.tabAnimation);
    if (merged.tabBarOptions !== undefined)
      setProperty(node, "tabBarOptions", merged.tabBarOptions);
    if (merged.tabBarItems !== undefined)
      setProperty(node, "tabBarItems", merged.tabBarItems);
    if (merged.nativeTabBarEnabled !== undefined)
      setProperty(node, "nativeTabBarEnabled", merged.nativeTabBarEnabled);

    setProperty(
      node,
      "onNativeTabSelect",
      merged.onNativeTabSelect ? handleNativeTabSelect : null
    );
    setProperty(
      node,
      "onNativeTabMount",
      merged.onNativeTabMount ? handleNativeTabMount : null
    );
    setProperty(
      node,
      "onNativeTabUpdate",
      merged.onNativeTabUpdate ? handleNativeTabUpdate : null
    );

    const st = resolvedStyle();
    if (st != null) setProperty(node, "style", st);
  };

  // 4. Apply initial properties SYNCHRONOUSLY during node creation
  const refProp = (node: HostNode | null) => {
    if (node) {
      untrack(() => applyProps(node));
    }
    setHostNode(node);
  };

  // 5. Subsequent updates applied IMPERATIVELY via 2-arg createEffect
  createEffect(
    () => ({
      node: hostNode(),
      selectedIndex: merged.selectedIndex,
      tabAnimation: merged.tabAnimation,
      tabBarOptions: merged.tabBarOptions,
      tabBarItems: merged.tabBarItems,
      nativeTabBarEnabled: merged.nativeTabBarEnabled,
      hasSelect: !!merged.onNativeTabSelect,
      hasMount: !!merged.onNativeTabMount,
      hasUpdate: !!merged.onNativeTabUpdate,
      st: resolvedStyle(),
    }),
    (cfg) => {
      if (!cfg.node) return;
      untrack(() => applyProps(cfg.node as HostNode));
    }
  );

  onCleanup(() => {
    setHostNode(null);
  });

  // 6. Keep intrinsic JSX tag clean (no dynamic attribute expressions)
  return (
    <zynth-screen-tabs-container ref={refProp}>
      {resolved()}
    </zynth-screen-tabs-container>
  );
};
