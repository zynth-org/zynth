import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { ParentComponent } from "solid-js";
import type { HostNode, StyleProp } from "@zynthjs/core";
import { setProperty } from "@zynthjs/core";
import { createStyle } from "../hooks/createStyle";
import { useAnimatedStyleMapper } from "../hooks/useAnimatedStyleMapper";

export interface TextProps {
  style?: StyleProp | (() => StyleProp | undefined);
  numberOfLines?: number;
  text?: string | number | (() => string | number | undefined);
  ref?: (node: HostNode | null) => void;
}

function extractTextContent(val: unknown): string | undefined {
  if (val == null) return undefined;
  if (typeof val === "string" || typeof val === "number") {
    return String(val);
  }
  if (typeof val === "function") {
    return extractTextContent(val());
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return "";
    let str = "";
    for (const item of val) {
      const itemStr = extractTextContent(item);
      if (itemStr === undefined) return undefined;
      str += itemStr;
    }
    return str;
  }
  return undefined;
}

export const Text: ParentComponent<TextProps> = (props) => {
  // NOTE: `props` is a SolidJS reactive proxy — do NOT destructure.
  const resolvedStyle = createStyle(() => {
    const nextStyle = props.style;
    return typeof nextStyle === "function" ? nextStyle() : nextStyle;
  });

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null, {
    ownedWrite: true,
  });

  const directTextContent = createMemo<string | undefined>(() => {
    const rawText =
      typeof props.text === "function" ? props.text() : props.text;
    if (rawText != null) return String(rawText);
    const result = extractTextContent(props.children);
    return result;
  });

  const applyTextProps = (node: HostNode) => {
    const st = resolvedStyle();
    if (st != null) setProperty(node, "style", st);
    if (props.numberOfLines != null) setProperty(node, "numberOfLines", props.numberOfLines);
    const txt = directTextContent();
    if (txt !== undefined) setProperty(node, "text", txt);
  };

  const refProp = (node: HostNode | null) => {
    if (node) {
      applyTextProps(node);
      setHostNode(node);
      props.ref?.(node);
      return;
    }
    setHostNode(null);
    props.ref?.(null);
  };

  // ─── Animated style mapper ─────────────────────────────────────────────────
  // Lazily attaches a native style mapper when `props.style` is an animated
  // style accessor from `createAnimatedStyle`. Zero cost for plain styles.
  useAnimatedStyleMapper(() => props.style, hostNode);

  // ─── Imperative property updates for host node ───────────────────────────
  createEffect(
    () => ({
      node: hostNode(),
      st: resolvedStyle(),
      text: directTextContent(),
      lines: props.numberOfLines,
    }),
    ({ node, st, text, lines }) => {
      if (!node) return;
      if (st != null) setProperty(node, "style", st);
      if (lines != null) setProperty(node, "numberOfLines", lines);
      if (text !== undefined) setProperty(node, "text", text);
    }
  );

  onCleanup(() => {
    setHostNode(null);
    props.ref?.(null);
  });

  return (
    <text ref={refProp as unknown as any}>
      {directTextContent() === undefined ? (props.children as any) : undefined}
    </text>
  );
};
