import { Glyphs } from "@rune/apis";
import {
  runtimeGlyphMap,
  runtimeFontFamily,
  runtimeFontFile,
} from "./runtimeGlyphMap";

let webSource: string | undefined;
if (typeof document !== "undefined") {
  try {
    webSource = new URL(
      `../assets/fonts/${runtimeFontFile}`,
      import.meta.url
    ).toString();
  } catch {
    webSource = undefined;
  }
}

if (Object.keys(runtimeGlyphMap).length === 0) {
  console.warn(
    `[RuntimeGlyphs] runtimeGlyphMap is empty. Ensure @rune/components is rebuilt after generating the runtime font.`
  );
}

Glyphs.registerRuntime(runtimeFontFamily, runtimeGlyphMap, {
  resourceName: runtimeFontFile,
  webSource,
});
