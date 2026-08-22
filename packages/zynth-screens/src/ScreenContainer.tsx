import {
  children as resolveChildren,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import type { ParentComponent } from "solid-js";
import type { HostNode, Style } from "@zynthjs/core";
import { setProperty } from "@zynthjs/core";
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
  // 1. Maintain proxy tracking: DO NOT destructure props
  const local = props;

  const resolved = resolveChildren(() => local.children);

  // 2. Configure hostNode signal with ownedWrite: true (set from refProp)
  const [hostNode, setHostNode] = createSignal<HostNode | null>(null, {
    ownedWrite: true,
  });

  // Always include flex: 1 to ensure proper layout
  const resolvedStyle = createMemo<Style>(() => ({
    flex: 1,
    ...local.style,
  }));

  // 3. Apply initial properties SYNCHRONOUSLY during node creation
  const refProp = (node: HostNode | null) => {
    if (node) {
      const st = resolvedStyle();
      if (st != null) setProperty(node, "style", st);
    }
    setHostNode(node);
  };

  // 4. Subsequent updates applied IMPERATIVELY via 2-arg createEffect
  createEffect(
    () => ({ node: hostNode(), st: resolvedStyle() }),
    ({ node, st }) => {
      if (node && st != null) setProperty(node, "style", st);
    }
  );

  onCleanup(() => {
    setHostNode(null);
  });

  // 5. Keep intrinsic JSX tag clean (no dynamic attribute expressions)
  return (
    <zynth-screen-container ref={refProp}>
      {resolved()}
    </zynth-screen-container>
  );
};
