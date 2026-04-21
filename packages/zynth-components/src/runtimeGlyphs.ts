import { Glyphs } from "@zynth/apis";
import { Platform } from "@zynth/core";
import {
  runtimeGlyphMap,
  runtimeFontFamily,
  runtimeFontFile,
} from "./runtimeGlyphMap";

let webSource: string | undefined;
if (Platform.isWeb) {
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
    `[RuntimeGlyphs] runtimeGlyphMap is empty. Ensure @zynth/components is rebuilt after generating the runtime font.`
  );
}

Glyphs.registerRuntime(runtimeFontFamily, runtimeGlyphMap, {
  resourceName: runtimeFontFile,
  webSource,
});
