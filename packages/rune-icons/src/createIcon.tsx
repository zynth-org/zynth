import { Text, TextProps } from "@rune/components";
import { Font } from "@rune/apis";

// Cache loaded fonts to avoid repeated native calls
const loadedFonts = new Set<string>();

export function createIcon(glyph: string, fontFamily: string) {
  // Trigger font load if not already requested
  if (!loadedFonts.has(fontFamily)) {
    loadedFonts.add(fontFamily);
    // The resource name typically matches the font family + .ttf in our generation script
    const resourceName = `${fontFamily}.ttf`;

    Font.loadAsync(fontFamily, resourceName).catch((err) => {
      console.log(
        `Failed to load icon font ${fontFamily}:`,
        JSON.stringify(err)
      );
    });
  }

  return (props: TextProps) => {
    // Merge fontFamily with any incoming style; avoid destructuring props to keep reactivity intact
    const mergedStyle = {
      ...(props.style as Record<string, unknown>),
      fontFamily,
    };
    return (
      <Text
        {...props}
        style={{
          ...mergedStyle,
          fontWeight: undefined,
        }}
      >
        {glyph}
      </Text>
    );
  };
}
