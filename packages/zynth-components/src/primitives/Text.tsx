import {
  children as resolveChildren,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import type { JSX, ParentComponent } from "solid-js";
import type { HostNode, StyleProp } from "@zynthjs/core";
import { setProperty } from "@zynthjs/core";
import { createStyle } from "../hooks/createStyle";
import { useAnimatedStyleMapper } from "../hooks/useAnimatedStyleMapper";

export interface TextProps {
  style?: StyleProp | (() => StyleProp | undefined);
  numberOfLines?: number;
  text?: string;
  ref?: (node: HostNode | null) => void;
}

export const Text: ParentComponent<TextProps> = (props) => {
  const resolvedChildren = resolveChildren(() => props.children);

  // NOTE: `props` is a SolidJS reactive proxy — do NOT destructure.
  const resolvedStyle = createStyle(() => {
    const nextStyle = props.style;
    return typeof nextStyle === "function" ? nextStyle() : nextStyle;
  });

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);

  // Reactive memo — avoids the stale closure bug of a plain `typeof props.style === "function"`.
  const hasStyleAccessor = createMemo(() => typeof props.style === "function");

  const refProp = (node: HostNode | null) => {
    setHostNode(node);
    props.ref?.(node);
  };

  // ─── Animated style mapper ─────────────────────────────────────────────────
  // Lazily attaches a native style mapper when `props.style` is an animated
  // style accessor from `createAnimatedStyle`. Zero cost for plain styles.
  useAnimatedStyleMapper(() => props.style, hostNode);

  // ─── Imperative style update for accessor-based styles ────────────────────
  createEffect(() => {
    const node = hostNode();
    if (!node) return;
    if (!hasStyleAccessor()) return;
    setProperty(node, "style", resolvedStyle() ?? {});
  });

  onCleanup(() => {
    setHostNode(null);
    props.ref?.(null);
  });

  const coalescedChildren = createMemo(() => {
    const children = resolvedChildren();
    if (Array.isArray(children)) {
      const result: unknown[] = [];
      let currentString = "";
      for (const child of children) {
        if (typeof child === "string" || typeof child === "number") {
          currentString += child;
        } else {
          if (currentString) {
            result.push(currentString);
            currentString = "";
          }
          if (child != null) result.push(child);
        }
      }
      if (currentString) result.push(currentString);
      if (result.length === 0) return "";
      if (
        result.length === 1 &&
        (typeof result[0] === "string" || typeof result[0] === "number")
      ) {
        return String(result[0]);
      }
      // Preserve arrays for mixed content so nested text nodes still compose correctly.
      return result;
    }
    return children ?? "";
  });

  const directTextContent = createMemo(() => {
    if (props.text != null) return props.text;
    const children = coalescedChildren();
    if (typeof children === "string" || typeof children === "number") {
      return String(children);
    }
    if (
      Array.isArray(children) &&
      children.length === 1 &&
      (typeof children[0] === "string" || typeof children[0] === "number")
    ) {
      return String(children[0]);
    }
    return undefined;
  });

  return (
    <text
      style={
        (hasStyleAccessor()
          ? undefined
          : (resolvedStyle() as JSX.Element)) as JSX.Element
      }
      text={directTextContent()}
      ref={refProp as unknown as any}
    >
      {directTextContent() === undefined ? coalescedChildren() : undefined}
    </text>
  );
};
