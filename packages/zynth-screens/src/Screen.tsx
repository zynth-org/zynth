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
import type { ScreenProps } from "./types";

const DEFAULT_SCREEN_BACKGROUND = "#ffffff";

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
 *   onDidAppear={() => logger.debug('Profile appeared')}
 * >
 *   <ProfileContent />
 * </Screen>
 * ```
 */
export const Screen: ParentComponent<ScreenProps> = (props) => {
  // 1. Reactive defaults via merge (SolidJS 2.0 replaces mergeProps).
  //    Do NOT destructure: `merged` stays a reactive proxy.
  const merged = merge(
    {
      animation: "push" as const,
      gestureEnabled: true,
      style: { flex: 1 } as Style,
    },
    props
  );

  // 2. Configure hostNode signal with ownedWrite: true (set from refProp)
  const [hostNode, setHostNode] = createSignal<HostNode | null>(null, {
    ownedWrite: true,
  });

  // Use absolute positioning to ensure screens overlap and fill the container
  // instead of stacking and sharing space (which causes the "cut in half" bug).
  const resolvedStyle = createMemo<Style>(() => ({
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: DEFAULT_SCREEN_BACKGROUND,
    ...(merged.style as Style),
  }));

  const resolved = resolveChildren(() => merged.children);

  // 3. Helper to synchronize properties to the native host node
  const applyProps = (node: HostNode) => {
    if (merged.screenKey !== undefined)
      setProperty(node, "screenKey", merged.screenKey);
    if (merged.active !== undefined)
      setProperty(node, "active", merged.active);
    if (merged.covered !== undefined)
      setProperty(node, "covered", merged.covered);
    if (merged.animation !== undefined)
      setProperty(node, "animation", merged.animation);
    if (merged.gestureEnabled !== undefined)
      setProperty(node, "gestureEnabled", merged.gestureEnabled);
    if (merged.headerOptions !== undefined)
      setProperty(node, "headerOptions", merged.headerOptions);
    if (merged.onNativeBack !== undefined)
      setProperty(node, "onNativeBack", merged.onNativeBack);
    if (merged.onNativeHeaderRightPress !== undefined)
      setProperty(node, "onNativeHeaderRightPress", merged.onNativeHeaderRightPress);
    if (merged.onWillAppear !== undefined)
      setProperty(node, "onWillAppear", merged.onWillAppear);
    if (merged.onDidAppear !== undefined)
      setProperty(node, "onDidAppear", merged.onDidAppear);
    if (merged.onWillDisappear !== undefined)
      setProperty(node, "onWillDisappear", merged.onWillDisappear);
    if (merged.onDidDisappear !== undefined)
      setProperty(node, "onDidDisappear", merged.onDidDisappear);

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
      screenKey: merged.screenKey,
      active: merged.active,
      covered: merged.covered,
      animation: merged.animation,
      gestureEnabled: merged.gestureEnabled,
      headerOptions: merged.headerOptions,
      onNativeBack: merged.onNativeBack,
      onNativeHeaderRightPress: merged.onNativeHeaderRightPress,
      onWillAppear: merged.onWillAppear,
      onDidAppear: merged.onDidAppear,
      onWillDisappear: merged.onWillDisappear,
      onDidDisappear: merged.onDidDisappear,
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
    <zynth-screen ref={refProp}>{resolved()}</zynth-screen>
  );
};
