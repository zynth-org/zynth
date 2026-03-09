import { createEffect, onCleanup, type Accessor } from "solid-js";
import {
  createStyleGraphBinding,
  flattenStyleProp,
  type HostNode,
  type Style,
  type StyleProp,
  withHostBatch,
} from "@zynth/core";
import { setProperty } from "@zynth/core";

type StyleKey = keyof Style;
type MutableStyle = Partial<Record<StyleKey, Style[StyleKey]>>;

function clearStyleKey(node: HostNode, key: StyleKey): void {
  // Android style parser currently ignores null for some style props.
  // boxShadow is cleared reliably when passed as an empty string.
  if (key === "boxShadow") {
    setProperty(node, key, "");
    return;
  }
  setProperty(node, key, null);
}

function applyStyleDiff(
  node: HostNode,
  previous: MutableStyle,
  next: MutableStyle
): void {
  const previousKeys = Object.keys(previous) as StyleKey[];
  const nextKeys = Object.keys(next) as StyleKey[];
  const seen = new Set<StyleKey>();

  for (const key of nextKeys) {
    seen.add(key);
    const nextValue = next[key];
    const previousValue = previous[key];
    if (nextValue === undefined) continue;
    if (Object.is(previousValue, nextValue)) continue;
    setProperty(node, key, nextValue);
  }

  for (const key of previousKeys) {
    if (seen.has(key)) continue;
    clearStyleKey(node, key);
  }
}

function cloneStyle(style: MutableStyle): MutableStyle {
  return { ...style };
}

export function createStyleBinding(
  node: Accessor<HostNode | null>,
  styleInput: Accessor<StyleProp | undefined>
): void {
  let previousApplied: MutableStyle = {};
  let detachDynamic: (() => void) | null = null;

  createEffect(() => {
    const hostNode = node();
    const style = styleInput();

    if (detachDynamic) {
      detachDynamic();
      detachDynamic = null;
    }

    if (!hostNode) {
      previousApplied = {};
      return;
    }

    const binding = createStyleGraphBinding(style);
    const nextInitial = cloneStyle(binding.initial) as MutableStyle;
    withHostBatch(
      { kind: "style-init", scope: "style", target: hostNode.id },
      () => applyStyleDiff(hostNode, previousApplied, nextInitial)
    );
    previousApplied = nextInitial;

    if (!binding.hasDynamic) {
      return;
    }

    detachDynamic = binding.attach((patch) => {
      withHostBatch(
        { kind: "style-patch", scope: "style", target: hostNode.id },
        () => {
          const changedKeys = Object.keys(patch.changed) as StyleKey[];
          for (const key of changedKeys) {
            const value = patch.changed[key];
            if (value !== undefined) {
              setProperty(hostNode, key, value);
              previousApplied[key] = value;
            }
          }
          for (const key of patch.removed) {
            clearStyleKey(hostNode, key);
            delete previousApplied[key];
          }
        }
      );
    });
  });

  onCleanup(() => {
    if (detachDynamic) {
      detachDynamic();
      detachDynamic = null;
    }
  });
}

export function createFunctionStyleDiffBinding(
  node: Accessor<HostNode | null>,
  styleInput: Accessor<StyleProp | undefined>
): void {
  let previousApplied: MutableStyle = {};

  createEffect(() => {
    const hostNode = node();
    if (!hostNode) {
      previousApplied = {};
      return;
    }
    const next = (flattenStyleProp(styleInput()) ?? {}) as MutableStyle;
    withHostBatch(
      { kind: "style-function-diff", scope: "style", target: hostNode.id },
      () => applyStyleDiff(hostNode, previousApplied, next)
    );
    previousApplied = next;
  });
}
