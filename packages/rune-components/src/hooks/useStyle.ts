import { createMemo, type Accessor } from "solid-js";
import type { Style, StyleProp } from "@rune/core";

/**
 * Merges an array of styles or a single style into a final Style object.
 * Properly handles SolidJS reactivity using createMemo to avoid breaking responsiveness.
 *
 * @param style - An Accessor to a StyleProp (single or array)
 * @returns A reactive memo of the merged Style object
 *
 * @example
 * ```tsx
 * const style = useStyle(() => [
 *   { color: "#FFF" },
 *   props.customStyle
 * ]);
 *
 * return <Text style={style()} />;
 * ```
 */
export const useStyle = (
  style: Accessor<StyleProp | undefined>
): Accessor<Style | undefined> => {
  return createMemo(() => {
    const s = style();
    if (s === undefined) return undefined;
    if (!Array.isArray(s)) return s;

    return s.reduce<Style>((acc, curr) => {
      if (!curr) return acc;
      return { ...acc, ...curr };
    }, {});
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
    const result: Style = {};

    for (const style of styles) {
      // If it's an accessor, call it to get the value
      const value =
        typeof style === "function"
          ? (style as Accessor<StyleProp | undefined>)()
          : style;

      if (value === undefined || value === null) continue;

      if (Array.isArray(value)) {
        // Merge each item in the array
        for (const item of value) {
          if (item) {
            Object.assign(result, item);
          }
        }
      } else {
        // Merge single style object
        Object.assign(result, value);
      }
    }

    return result;
  });

  (memo as any).__runeAnimatedStyle = {
    getMapping: () => {
      let mergedMapping: any = null;
      for (const style of styles) {
        if (typeof style === "function") {
          const animated = (style as any).__runeAnimatedStyle;
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
