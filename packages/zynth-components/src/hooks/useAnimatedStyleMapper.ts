import { createEffect, onCleanup } from "solid-js";
import type { HostNode, StyleProp } from "@zynth/core";
import {
  isNativePlatform,
  hasNativeAnimate,
  createNativeStyleMapper,
  updateNativeStyleMapper,
  removeNativeStyleMapper,
  type NativeStyleMapperConfig,
} from "@zynth/core/motion";

/**
 * Metadata attached to an animated style accessor created by `createAnimatedStyle`.
 * The `getMapping` function is backed by a SolidJS `createMemo`, so reading it
 * inside a reactive context establishes a fine-grained dependency.
 */
type AnimatedStyleMeta = {
  getMapping: () => NativeStyleMapperConfig | null;
};

/**
 * Extracts `__zynthAnimatedStyle` metadata from a style prop if present.
 * Returns `null` for plain `Style` objects, arrays, and all non-animated values.
 */
function getAnimatedStyleMeta(value: unknown): AnimatedStyleMeta | null {
  if (typeof value !== "function") return null;
  const meta = (value as { __zynthAnimatedStyle?: AnimatedStyleMeta })
    .__zynthAnimatedStyle;
  return meta ?? null;
}

/**
 * Produces a stable string key for a native style mapping so we can detect
 * when the mapping identity changes without a deep-equality check.
 * Strips the `__zynth_shared_signal_current` preview field since it changes
 * every frame and is not part of native mapping identity.
 */
function getMappingKey(mapping: NativeStyleMapperConfig): string {
  return JSON.stringify(normalizeMappingValue(mapping));
}

function normalizeMappingValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeMappingValue);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (key === "__zynth_shared_signal_current") continue;
      next[key] = normalizeMappingValue(obj[key]);
    }
    return next;
  }
  return value;
}

/**
 * Lazily attaches a native style mapper to a host node when the provided
 * style prop carries `createAnimatedStyle` metadata.
 *
 * **Behaviour summary:**
 * - If the style prop has no `__zynthAnimatedStyle` metadata: zero cost, no
 *   native allocation, plain style props are unaffected.
 * - If metadata is present: a native style mapper is created on the first
 *   reactive pass, updated in-place when the mapping identity changes, and
 *   removed on component cleanup.
 * - On web or when the native animation driver is absent: the hook is a no-op.
 *
 * **SolidJS rules:**
 * - Call inside a component body, not inside a `createEffect`.
 * - Do NOT destructure the `getStyleProp` argument — pass accessor refs only.
 *
 * @param getStyleProp - Reactive accessor returning the raw style prop value.
 *   Must be the **function reference** (e.g. `() => local.style`), not the
 *   already-called result, because `__zynthAnimatedStyle` lives on the
 *   accessor function itself.
 * @param getHostNode - Reactive accessor returning the current host node.
 */
export function useAnimatedStyleMapper(
  /**
   * Reactive accessor returning the raw style prop value — the **function
   * reference** itself when the style is an accessor, NOT its called result.
   * Typed as `unknown` to accommodate all Zynth primitive style prop shapes
   * (e.g. Pressable's state-based `(state) => Style` variant).
   */
  getStyleProp: () => unknown,
  getHostNode: () => HostNode | null,
): void {
  // Fast exit: no native platform or no native animation driver available.
  // This check is constant per runtime so the branch is eliminated after boot.
  if (!isNativePlatform() || !hasNativeAnimate()) return;

  let mapperId: number | null = null;
  let mapperNodeId: number | null = null;
  let mapperKey: string | null = null;

  const detachMapper = (): void => {
    if (mapperId !== null) {
      removeNativeStyleMapper(mapperId);
      mapperId = null;
      mapperNodeId = null;
      mapperKey = null;
    }
  };

  createEffect(() => {
    const styleProp = getStyleProp();
    const meta = getAnimatedStyleMeta(styleProp);

    if (!meta) {
      // Plain style (static object, array, or non-animated accessor).
      // Detach any previously active mapper and return — no further cost.
      detachMapper();
      return;
    }

    // `meta.getMapping()` is backed by a `createMemo` inside `createAnimatedStyle`.
    // Reading it here registers a fine-grained reactive dependency: the effect
    // re-runs whenever the mapping contents change (shared values added/removed).
    const mapping = meta.getMapping();
    const nodeId = getHostNode()?.id;

    if (!mapping || !nodeId) {
      detachMapper();
      return;
    }

    const nextKey = getMappingKey(mapping);

    if (mapperId === null || mapperNodeId !== nodeId) {
      // First attach or the host node was replaced — create a fresh mapper.
      if (mapperId !== null) {
        removeNativeStyleMapper(mapperId);
      }
      mapperId = createNativeStyleMapper(nodeId, mapping);
      mapperNodeId = nodeId;
      mapperKey = nextKey;
    } else if (mapperKey !== nextKey) {
      // Mapping identity changed (e.g. different transform properties) — update.
      updateNativeStyleMapper(mapperId, mapping);
      mapperKey = nextKey;
    }
    // If key is unchanged: mapping is identical, skip the native call.
  });

  onCleanup(detachMapper);
}
