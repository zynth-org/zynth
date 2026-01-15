import { createSignal, onCleanup, onMount, type Component } from "solid-js";
import { Font, Glyphs } from "@zynth/apis";
import { Text, type TextProps } from "./Text";
import { useStyle } from "../hooks/useStyle";
import "../runtimeGlyphs";

export type SystemGlyphProps = TextProps & {
  name: string;
  size?: number;
  color?: string;
};

const warnedMissingGlyph = new Set<string>();
const warnedLoadFailure = new Set<string>();

export const SystemGlyph: Component<SystemGlyphProps> = (props) => {
  const resolveEntry = () => Glyphs.resolve(props.name);
  const [isReady, setIsReady] = createSignal(
    resolveEntry() ? Glyphs.isLoaded(props.name) : false
  );
  const resolvedStyle = useStyle(() => props.style);

  const scheduleReady = () => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsReady(true);
        });
      });
    } else {
      setIsReady(true);
    }
  };

  onMount(() => {
    const entry = resolveEntry();
    if (!entry) {
      if (!warnedMissingGlyph.has(props.name)) {
        warnedMissingGlyph.add(props.name);
        console.warn(
          `[SystemGlyph] Missing glyph "${props.name}". Did you generate/register the runtime font?`
        );
      }
      return;
    }
    if (Glyphs.isLoaded(props.name)) {
      setIsReady(true);
      return;
    }

    let cancelled = false;
    const unsubscribe = Font.subscribe(entry.fontFamily, () => {
      if (cancelled) return;
      scheduleReady();
    });

    Glyphs.ensureLoaded(props.name)
      .then(() => scheduleReady())
      .catch(() => {
        if (!warnedLoadFailure.has(props.name)) {
          warnedLoadFailure.add(props.name);
          console.warn(
            `[SystemGlyph] Failed to load font for "${props.name}" (${entry.fontFamily}). Check native font bundling.`
          );
        }
      });

    onCleanup(() => {
      cancelled = true;
      unsubscribe();
    });
  });

  const mergedStyle = () => {
    const base = { ...(resolvedStyle() ?? {}) } as Record<string, unknown>;
    if (props.size !== undefined) base.fontSize = props.size;
    if (props.size !== undefined) base.height = props.size;
    if (props.size !== undefined) base.width = props.size;
    if (props.color !== undefined) base.color = props.color;
    const entry = resolveEntry();
    if (isReady() && entry) base.fontFamily = entry.fontFamily;
    return base;
  };

  return (
    <Text style={mergedStyle()}>
      {isReady() ? resolveEntry()?.glyph ?? " " : " "}
    </Text>
  );
};
