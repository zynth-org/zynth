import { createMemo, type Accessor } from "solid-js";
import { flattenStyleProp } from "@zynth/core";
import type { Style, StyleProp } from "@zynth/core";

type StyleInput = StyleProp | (() => StyleProp | undefined) | undefined;

function resolveStyleInput(input: StyleInput): StyleProp | undefined {
  if (typeof input === "function") {
    return resolveStyleInput(input());
  }
  return input;
}

/**
 * Merges an array of styles or a single style into a final Style object.
 * Properly handles SolidJS reactivity using createMemo to avoid breaking responsiveness.
 *
 * @param style - An Accessor to a StyleProp (single or array)
 * @returns A reactive memo of the merged Style object
 *
 * @example
 * ```tsx
 * const style = createStyle(() => [
 *   { color: "#FFF" },
 *   props.customStyle
 * ]);
 *
 * return <Text style={style()} />;
 * ```
 */
export const createStyle = (
  style: Accessor<StyleInput>
): Accessor<Style | undefined> => {
  return createMemo(() => {
    return flattenStyleProp(resolveStyleInput(style()));
  });
};

/**
 * Merges multiple StyleProp values into a single Style object.
 * Useful for combining base styles with conditional or responsive overrides.
 *
 * @param styles - Variable number of StyleProp or Accessor<StyleProp | undefined>
 * @returns A reactive memo of the merged Style object
 *
 * @example
 * ```tsx
 * const style = mergeStyles(
 *   { paddingHorizontal: 16 },
 *   () => isActive() ? { backgroundColor: "blue" } : { backgroundColor: "gray" },
 *   () => props.style
 * );
 *
 * return <View style={style()} />;
 * ```
 */
export const mergeStyles = (
  ...styles: (StyleProp | Accessor<StyleProp | undefined>)[]
): Accessor<Style> => {
  const memo = createMemo(() => {
    const result: Partial<Record<keyof Style, Style[keyof Style]>> = {};

    for (const style of styles) {
      // If it's an accessor, call it to get the value
      const value =
        typeof style === "function"
          ? (style as Accessor<StyleProp | undefined>)()
          : style;

      if (value === undefined || value === null) continue;
      const flattened = flattenStyleProp(value);
      if (!flattened) continue;
      for (const key of Object.keys(flattened) as Array<keyof Style>) {
        const next = flattened[key];
        if (next !== undefined) {
          result[key] = next;
        }
      }
    }

    return result as Style;
  });

  (memo as any).__zynthAnimatedStyle = {
    getMapping: () => {
      let mergedMapping: any = null;
      for (const style of styles) {
        if (typeof style === "function") {
          const animated = (style as any).__zynthAnimatedStyle;
          if (animated && animated.getMapping) {
            const mapping = animated.getMapping();
            if (mapping) {
              if (!mergedMapping) mergedMapping = {};
              Object.assign(mergedMapping, mapping);
            }
          }
        }
      }
      return mergedMapping;
    },
  };

  return memo;
};
