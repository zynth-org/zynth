#!/usr/bin/env node --experimental-strip-types

import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import sax from "sax";
import svgtofont from "svgtofont";

(sax as any).MAX_BUFFER_LENGTH = 1024 * 1024;

type IconDef = {
  name: string;
  attributes: Record<string, string | number | undefined>;
  content: string;
};

type BuiltFont = {
  glyphMap: Record<string, string>;
  fontFamily: string;
  ttfPath: string | null;
  dist: string | null;
};

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, "..");
const solidIconsMain = require.resolve("solid-icons");
const solidIconsRoot = dirname(dirname(solidIconsMain));
const solidIconsLibEntry = join(solidIconsRoot, "lib", "index.cjs");
const metaOutputDir = join(pkgRoot, "dist", "icons-meta");
const fontOutputDir = join(pkgRoot, "dist", "fonts");
const assetsFontsDir = join(pkgRoot, "assets", "fonts");
const srcOutputDir = join(pkgRoot, "src");
const iosFontsDir = join(pkgRoot, "ios", "Fonts");
const androidFontsDir = join(
  pkgRoot,
  "android",
  "src",
  "main",
  "assets",
  "fonts"
);
const runtimeComponentsRoot = resolve(pkgRoot, "..", "rune-components");
const runtimeComponentsFontsDir = join(
  runtimeComponentsRoot,
  "assets",
  "fonts"
);
const runtimeComponentsIosFontsDir = join(
  runtimeComponentsRoot,
  "ios",
  "Fonts"
);
const runtimeComponentsAndroidFontsDir = join(
  runtimeComponentsRoot,
  "android",
  "RuneComponents",
  "src",
  "main",
  "assets",
  "fonts"
);
const runtimeGlyphMapPath = join(
  runtimeComponentsRoot,
  "src",
  "runtimeGlyphMap.ts"
);
const runtimeOutputDefault = runtimeComponentsFontsDir;
const webOutputDir = join(pkgRoot, "web");

function decodeGlyph(data: any): string {
  const encoded: string | undefined = data?.encodedCode || data?.unicode;
  if (!encoded) return "";
  if (encoded.startsWith("&#")) {
    const num = parseInt(encoded.replace(/[^\d]/g, ""), 10);
    return Number.isFinite(num) ? String.fromCharCode(num) : "";
  }
  const match = encoded.match(/\\u?([0-9a-fA-F]+)/);
  if (match?.[1]) {
    return String.fromCharCode(parseInt(match[1], 16));
  }
  if (encoded.length === 1) return encoded;
  return "";
}

function sanitizeContent(content: string): string {
  if (!content) return "";
  return content
    .replace(/<\?xml[^>]*\?>/gi, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .trim();
}

function filterCaseInsensitiveDuplicates(
  packName: string,
  icons: IconDef[]
): IconDef[] {
  const seen = new Map<string, string>();
  const filtered: IconDef[] = [];
  for (const icon of icons) {
    const key = icon.name.toLowerCase();
    if (seen.has(key)) {
      console.warn(
        `Skipping duplicate icon "${
          icon.name
        }" in pack "${packName}" (conflicts with "${seen.get(key)}")`
      );
      continue;
    }
    seen.set(key, icon.name);
    filtered.push(icon);
  }
  return filtered;
}

function isSvgOnly(icon: IconDef): boolean {
  const attrKeys = Object.keys(icon.attributes || {});
  const attrHasOpacity = attrKeys.some(
    (key) => /opacity/i.test(key) || /fill-opacity/i.test(key)
  );
  const content = icon.content || "";
  const lower = content.toLowerCase();
  const contentHasOpacity =
    lower.includes("fill-opacity") ||
    lower.includes('opacity="') ||
    lower.includes("opacity='");
  return attrHasOpacity || contentHasOpacity;
}

function iconToSource(name: string, glyph: string, fontFamily: string): string {
  const glyphLiteral = JSON.stringify(glyph);
  return `export const ${name} = createIcon(${glyphLiteral}, "${fontFamily}");`;
}

async function discoverPacks(): Promise<string[]> {
  const entries = await readdir(solidIconsRoot, { withFileTypes: true });
  const packs: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "lib") continue;

    const cjsPath = join(solidIconsRoot, entry.name, "index.cjs");
    try {
      await stat(cjsPath);
      packs.push(entry.name);
    } catch {
      // Not a pack, skip
    }
  }

  return packs;
}

function extractPack(packName: string): IconDef[] {
  const icons = new Map<string, IconDef>();
  const packPath = join(solidIconsRoot, packName, "index.cjs");
  const libPath = solidIconsLibEntry;
  const originalLib = (require.cache as Record<string, any>)[libPath];

  (require.cache as Record<string, any>)[libPath] = {
    exports: {
      IconTemplate: (iconSrc: any, props: Record<string, any> = {}) => {
        const name = props.__name || "unknown";
        icons.set(name, {
          name,
          attributes: iconSrc?.a || {},
          content: iconSrc?.c || "",
        });
        return {};
      },
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(packPath);

  for (const [name, factory] of Object.entries(mod)) {
    if (typeof factory !== "function") continue;
    try {
      (factory as (p: any) => void)({ __name: name });
    } catch (error) {
      console.warn(
        `Failed to execute icon "${name}" in pack "${packName}":`,
        error
      );
    }
  }

  if (originalLib) {
    (require.cache as Record<string, any>)[libPath] = originalLib;
  } else {
    delete (require.cache as Record<string, any>)[libPath];
  }

  return Array.from(icons.values());
}

async function emitPackSource(
  packName: string,
  icons: IconDef[],
  glyphMap: Record<string, string>,
  fontFamily: string
): Promise<void> {
  const imports = ['import { createIcon } from "./createIcon";'];
  const header =
    "// AUTO-GENERATED by packages/rune-icons/scripts/generate.ts. Do not edit.\n" +
    imports.join("\n") +
    "\n\n";

  const body = icons
    .map((icon) => {
      const glyph = glyphMap[icon.name];
      if (!glyph) {
        throw new Error(
          `Missing glyph for icon ${icon.name} in pack ${packName}`
        );
      }
      return iconToSource(icon.name, glyph, fontFamily);
    })
    .join("\n");

  const contents = header + body + "\n";
  const target = join(srcOutputDir, `${packName}.tsx`);
  await writeFile(target, contents, "utf8");
}

async function emitFontInputSvgs(
  packName: string,
  icons: IconDef[]
): Promise<string> {
  const base = join(fontOutputDir, "input", packName);
  await mkdir(base, { recursive: true });
  const tasks = icons.map(async (icon) => {
    const attrs = Object.entries(icon.attributes || {})
      .map(([key, value]) => `${key}="${value}"`)
      .join(" ");
    const svg = `<svg ${attrs}>${sanitizeContent(icon.content)}</svg>\n`;
    const target = join(base, `${icon.name}.svg`);
    await writeFile(target, svg, "utf8");
  });
  await Promise.all(tasks);
  return base;
}

async function pruneUnusedFontOutputs(dist: string, fontFamily: string) {
  const keep = new Set([`${fontFamily}.ttf`, "glyph-map.json", "info.json"]);
  const files = await readdir(dist);
  const deletions = files
    .filter((file) => !keep.has(file))
    .map((file) => unlink(join(dist, file)).catch(() => {}));
  await Promise.all(deletions);
}

async function buildFontForPack(
  packName: string,
  iconsForFont: IconDef[]
): Promise<BuiltFont> {
  if (!iconsForFont.length) {
    return {
      glyphMap: {},
      fontFamily: `RuneIcons${packName.toUpperCase()}`,
      ttfPath: null,
      dist: null,
    };
  }

  const src = await emitFontInputSvgs(packName, iconsForFont);
  const dist = join(fontOutputDir, packName);
  const fontFamily = `RuneIcons${packName.toUpperCase()}`;

  try {
    await svgtofont({
      src,
      dist,
      fontName: fontFamily,
      css: false,
      website: undefined,
      log: false,
      logger: (msg: string) => console.log(`[${packName}] ${msg}`),
      emptyDist: true,
      startUnicode: 0xea01,
      svgicons2svgfont: {
        normalize: true,
        fontHeight: 1000,
        centerHorizontally: true,
      },
      outSVGReact: false,
      outSVGVue: false,
      outSVGReactNative: false,
      generateInfoData: true,
    });
  } catch (error: any) {
    throw new Error(
      `Font build failed for pack "${packName}": ${error.message}`
    );
  }

  const infoPath = join(dist, "info.json");
  const rawInfo = await readFile(infoPath, "utf8");
  const info = JSON.parse(rawInfo);

  const glyphMap: Record<string, string> = {};
  for (const [name, data] of Object.entries(info)) {
    const glyph = decodeGlyph(data);
    if (glyph) {
      glyphMap[name] = glyph;
    }
  }

  await writeFile(
    join(dist, "glyph-map.json"),
    JSON.stringify(glyphMap, null, 2) + "\n"
  );
  await pruneUnusedFontOutputs(dist, fontFamily);

  const ttfPath = join(dist, `${fontFamily}.ttf`);
  return { glyphMap, fontFamily, ttfPath, dist };
}

async function buildRuntimeFont(
  fontFamily: string,
  iconsForFont: IconDef[],
  outputDir: string
): Promise<BuiltFont> {
  if (!iconsForFont.length) {
    return {
      glyphMap: {},
      fontFamily,
      ttfPath: null,
      dist: null,
    };
  }

  const src = await emitFontInputSvgs("runtime", iconsForFont);
  await mkdir(outputDir, { recursive: true });

  try {
    await svgtofont({
      src,
      dist: outputDir,
      fontName: fontFamily,
      css: false,
      website: undefined,
      log: false,
      logger: (msg: string) => console.log(`[runtime] ${msg}`),
      emptyDist: true,
      startUnicode: 0xea01,
      svgicons2svgfont: {
        normalize: true,
        fontHeight: 1000,
        centerHorizontally: true,
      },
      outSVGReact: false,
      outSVGVue: false,
      outSVGReactNative: false,
      generateInfoData: true,
    });
  } catch (error: any) {
    throw new Error(
      `Runtime font build failed for "${fontFamily}": ${error.message}`
    );
  }

  const infoPath = join(outputDir, "info.json");
  const rawInfo = await readFile(infoPath, "utf8");
  const info = JSON.parse(rawInfo);

  const glyphMap: Record<string, string> = {};
  for (const [name, data] of Object.entries(info)) {
    const glyph = decodeGlyph(data);
    if (glyph) {
      glyphMap[name] = glyph;
    }
  }

  await writeFile(
    join(outputDir, "glyph-map.json"),
    JSON.stringify(glyphMap, null, 2) + "\n"
  );
  await pruneUnusedFontOutputs(outputDir, fontFamily);

  const ttfPath = join(outputDir, `${fontFamily}.ttf`);
  return { glyphMap, fontFamily, ttfPath, dist: outputDir };
}

async function copyRuntimeFontToComponents(ttfPath: string): Promise<void> {
  const fileName = basename(ttfPath);
  await mkdir(runtimeComponentsFontsDir, { recursive: true });
  await mkdir(runtimeComponentsIosFontsDir, { recursive: true });
  await mkdir(runtimeComponentsAndroidFontsDir, { recursive: true });
  await Promise.all([
    copyFile(ttfPath, join(runtimeComponentsFontsDir, fileName)),
    copyFile(ttfPath, join(runtimeComponentsIosFontsDir, fileName)),
    copyFile(ttfPath, join(runtimeComponentsAndroidFontsDir, fileName)),
  ]);
}

async function emitRuntimeGlyphMap(
  fontFamily: string,
  glyphMap: Record<string, string>
): Promise<void> {
  const contents =
    "// AUTO-GENERATED by packages/rune-icons/scripts/generate.ts. Do not edit.\n" +
    `export const runtimeGlyphMap: Record<string, string> = ${JSON.stringify(
      glyphMap,
      null,
      2
    )};\n` +
    `export const runtimeFontFamily = ${JSON.stringify(fontFamily)};\n` +
    `export const runtimeFontFile = ${JSON.stringify(`${fontFamily}.ttf`)};\n`;
  await writeFile(runtimeGlyphMapPath, contents, "utf8");
}

async function copyFontToPlatforms(ttfPath: string | null) {
  if (!ttfPath) return;
  const fileName = basename(ttfPath);
  await mkdir(assetsFontsDir, { recursive: true });
  await mkdir(iosFontsDir, { recursive: true });
  await mkdir(androidFontsDir, { recursive: true });
  await Promise.all([
    copyFile(ttfPath, join(assetsFontsDir, fileName)),
    copyFile(ttfPath, join(iosFontsDir, fileName)),
    copyFile(ttfPath, join(androidFontsDir, fileName)),
  ]);
}

async function cleanAssetsFonts() {
  await mkdir(assetsFontsDir, { recursive: true });
  const entries = await readdir(assetsFontsDir, { withFileTypes: true });
  const deletions = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ttf"))
    .map((entry) => unlink(join(assetsFontsDir, entry.name)).catch(() => {}));
  await Promise.all(deletions);
}

async function cleanTempInputs() {
  const inputDir = join(fontOutputDir, "input");
  await rm(inputDir, { recursive: true, force: true });
}

function parseIconNames(raw: string): string[] {
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

async function collectAllIcons(): Promise<Map<string, IconDef>> {
  const packs = await discoverPacks();
  const allIcons = new Map<string, IconDef>();
  const duplicates = new Set<string>();

  for (const pack of packs) {
    const rawIcons = extractPack(pack);
    const icons = filterCaseInsensitiveDuplicates(pack, rawIcons).filter(
      (icon) => !isSvgOnly(icon)
    );
    for (const icon of icons) {
      if (allIcons.has(icon.name)) {
        duplicates.add(icon.name);
        continue;
      }
      allIcons.set(icon.name, icon);
    }
  }

  if (duplicates.size > 0) {
    console.warn(
      "Warning: duplicate icon names found across packs:",
      Array.from(duplicates).join(", ")
    );
  }

  return allIcons;
}

async function runRuntimeGenerator() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const fontFamily = (await rl.question("Font family: ")).trim();
  const iconInput = (await rl.question("Icons (comma-separated): ")).trim();
  const outputInput = (
    await rl.question(
      `Output directory (default: ${runtimeOutputDefault}): `
    )
  ).trim();
  rl.close();

  if (!fontFamily) {
    console.error("Font family is required.");
    process.exit(1);
  }

  const iconNames = parseIconNames(iconInput);
  if (!iconNames.length) {
    console.error("At least one icon name is required.");
    process.exit(1);
  }

  const outputDir = outputInput
    ? resolve(process.cwd(), outputInput)
    : runtimeOutputDefault;

  const allIcons = await collectAllIcons();
  const missing: string[] = [];
  const selected: IconDef[] = [];
  const seen = new Set<string>();

  for (const name of iconNames) {
    if (seen.has(name)) continue;
    seen.add(name);
    const icon = allIcons.get(name);
    if (!icon) {
      missing.push(name);
      continue;
    }
    selected.push(icon);
  }

  if (missing.length) {
    console.error(`Missing icons: ${missing.join(", ")}`);
    const confirmRl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const confirm = await confirmRl.question(
      "Continue with available icons? (y/N): "
    );
    confirmRl.close();
    if (!confirm.trim().toLowerCase().startsWith("y")) {
      process.exit(1);
    }
  }

  if (!selected.length) {
    console.error("No valid icons selected.");
    process.exit(1);
  }

  const { ttfPath, glyphMap } = await buildRuntimeFont(
    fontFamily,
    selected,
    outputDir
  );
  await cleanTempInputs();

  if (!ttfPath) {
    console.error("Runtime font generation failed.");
    process.exit(1);
  }

  await copyRuntimeFontToComponents(ttfPath);
  await emitRuntimeGlyphMap(fontFamily, glyphMap);

  console.log(`Runtime font generated at ${outputDir}`);
  console.log(`Font file: ${ttfPath}`);
  console.log(`Glyph map: ${join(outputDir, "glyph-map.json")}`);
  console.log(`Runtime glyph map: ${runtimeGlyphMapPath}`);
}

async function emitIndex(packs: string[]) {
  const header =
    "// AUTO-GENERATED by packages/rune-icons/scripts/generate.ts. Do not edit.\n";
  const exports = packs.map((pack) => `export * from "./${pack}";`).join("\n");
  const contents = `${header}export * from "./createIcon";\n${exports}\n`;
  const target = join(srcOutputDir, "index.ts");
  await writeFile(target, contents, "utf8");
}

async function emitWebIndex(packs: string[]) {
  const header =
    "// AUTO-GENERATED by packages/rune-icons/scripts/generate.ts. Do not edit.\n";
  const mappings = packs
    .map((pack) => {
      const fontFamily = `RuneIcons${pack.toUpperCase()}`;
      const fileName = `${fontFamily}.ttf`;
      return `  ${fontFamily}: new URL("../assets/fonts/${fileName}", import.meta.url).toString(),`;
    })
    .join("\n");

  const contents = `${header}type WebFontSources = Record<string, string>;\n\nconst sources: WebFontSources = {\n${mappings}\n};\n\nconst globalObj =\n  typeof globalThis !== "undefined"\n    ? (globalThis as any)\n    : (window as any);\n\nconst existing = globalObj.__rune_web_font_sources;\nif (existing && typeof existing === "object") {\n  Object.assign(existing, sources);\n} else {\n  globalObj.__rune_web_font_sources = sources;\n}\n`;
  const target = join(webOutputDir, "index.ts");
  await writeFile(target, contents, "utf8");
}

async function emitWebEntry() {
  const header =
    "// AUTO-GENERATED by packages/rune-icons/scripts/generate.ts. Do not edit.\n";
  const contents = `${header}import "../web/index";\n\nexport * from "./index";\n`;
  const target = join(srcOutputDir, "index.web.ts");
  await writeFile(target, contents, "utf8");
}

async function main() {
  if (process.argv.slice(2).includes("runtime")) {
    await runRuntimeGenerator();
    return;
  }

  const packs = await discoverPacks();
  if (!packs.length) {
    console.error("No solid-icons packs found.");
    process.exit(1);
  }

  await cleanAssetsFonts();

  const result: Record<string, IconDef[]> = {};
  let total = 0;

  for (const pack of packs) {
    const rawIcons = extractPack(pack);
    const icons = filterCaseInsensitiveDuplicates(pack, rawIcons).filter(
      (icon) => !isSvgOnly(icon)
    );
    const fontIcons = icons;
    total += icons.length;
    result[pack] = icons;
    console.log(`${pack}: ${icons.length} icons (${fontIcons.length} font)`);
    const { glyphMap, fontFamily, ttfPath } = await buildFontForPack(
      pack,
      fontIcons
    );
    await emitPackSource(pack, icons, glyphMap, fontFamily);
    await copyFontToPlatforms(ttfPath);
  }

  await emitIndex(packs);
  await emitWebIndex(packs);
  await emitWebEntry();

  await mkdir(metaOutputDir, { recursive: true });
  const outputPath = join(metaOutputDir, "solid-icons.json");
  await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n");

  console.log(`\nExtracted ${total} icons across ${packs.length} packs`);
  console.log(`Metadata saved to ${outputPath}`);
  console.log(`Packs written to ${srcOutputDir}`);
  await cleanTempInputs();
}

main().catch((error) => {
  console.error("Generation failed:", error);
  process.exit(1);
});
