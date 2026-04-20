import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getAppConfig } from './config-utils';

// We use require for these optional but recommended optimization dependencies
// to ensure they don't break the build if they fail to load in certain environments.
let sharp: any;
try {
  sharp = require('sharp');
} catch (e) {
  // sharp is optional but highly recommended for image optimization
}

let subsetFont: any;
try {
  subsetFont = require('subset-font');
} catch (e) {
  // subset-font is optional but highly recommended for app size reduction
}

type RGBA = { r: number; g: number; b: number; a: number };

function parseHexColor(value: string): RGBA | null {
  if (!value) return null;
  let hex = value.trim();
  if (hex.startsWith('#')) {
    hex = hex.slice(1);
  }
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('') + 'ff';
  } else if (hex.length === 4) {
    hex = hex.split('').map((c) => c + c).join('');
  } else if (hex.length === 6) {
    hex = `${hex}ff`;
  }
  if (hex.length !== 8) return null;
  const raw = Number.parseInt(hex, 16);
  if (Number.isNaN(raw)) return null;
  const r = ((raw >> 24) & 0xff) / 255;
  const g = ((raw >> 16) & 0xff) / 255;
  const b = ((raw >> 8) & 0xff) / 255;
  const a = (raw & 0xff) / 255;
  return { r, g, b, a };
}

function formatColorComponent(value: number): string {
  return value.toFixed(3);
}

function resizeImage(input: string, output: string, width: number, height: number): void {
  try {
    if (process.platform === 'darwin') {
      execSync(`sips -z ${height} ${width} "${input}" --out "${output}"`, { stdio: 'ignore' });
    } else {
      console.warn('⚠️  Image resizing is only supported on macOS (requires sips). Skipping:', output);
      fs.copyFileSync(input, output);
    }
  } catch (error: any) {
    console.warn(`⚠️  Failed to resize image: ${error.message}`);
  }
}

function generateIOSIcons(appDir: string, iconPath: string, appName: string): void {
  if (!fs.existsSync(iconPath)) return;

  const assetsDir = path.join(appDir, 'ios', appName, 'Images.xcassets');
  const iconSetDir = path.join(assetsDir, 'AppIcon.appiconset');

  fs.mkdirSync(iconSetDir, { recursive: true });

  const sizes = [
    { size: 20, scale: 2 }, { size: 20, scale: 3 },
    { size: 29, scale: 2 }, { size: 29, scale: 3 },
    { size: 40, scale: 2 }, { size: 40, scale: 3 },
    { size: 60, scale: 2 }, { size: 60, scale: 3 },
    { size: 1024, scale: 1 },
  ];

  const contents: any = {
    images: [],
    info: { version: 1, author: "xcode" }
  };

  sizes.forEach(spec => {
    const dim = spec.size * spec.scale;
    const filename = `icon_${spec.size}pt@${spec.scale}x.png`;
    const target = path.join(iconSetDir, filename);
    
    resizeImage(iconPath, target, dim, dim);

    contents.images.push({
      size: `${spec.size}x${spec.size}`,
      idiom: spec.size === 1024 ? "ios-marketing" : "iphone",
      filename: filename,
      scale: `${spec.scale}x`
    });
  });
  
  const ipadSizes = [
      { size: 20, scale: 1 }, { size: 20, scale: 2 },
      { size: 29, scale: 1 }, { size: 29, scale: 2 },
      { size: 40, scale: 1 }, { size: 40, scale: 2 },
      { size: 76, scale: 1 }, { size: 76, scale: 2 },
      { size: 83.5, scale: 2 }
  ];
  
  ipadSizes.forEach(spec => {
      const dim = spec.size * spec.scale;
      const filename = `icon_ipad_${spec.size}pt@${spec.scale}x.png`;
      const target = path.join(iconSetDir, filename);
      
      resizeImage(iconPath, target, dim, dim);
      
      contents.images.push({
          size: `${spec.size}x${spec.size}`,
          idiom: "ipad",
          filename: filename,
          scale: `${spec.scale}x`
      });
  });

  fs.writeFileSync(path.join(iconSetDir, 'Contents.json'), JSON.stringify(contents, null, 2));
  const quiet = Boolean(process.env.ZYNTH_QUIET_BOOTSTRAP);
  if (!quiet) {
    console.log('  ✓ Generated iOS App Icons');
  }
}

function generateIOSSplashAssets(appDir: string, splash: any, appName: string): void {
  const assetsDir = path.join(appDir, 'ios', appName, 'Images.xcassets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const backgroundColor = splash?.backgroundColor || '#ffffff';
  const rgba = parseHexColor(backgroundColor) || { r: 1, g: 1, b: 1, a: 1 };
  const colorsetDir = path.join(assetsDir, 'LaunchBackground.colorset');
  fs.rmSync(colorsetDir, { recursive: true, force: true });
  fs.mkdirSync(colorsetDir, { recursive: true });
  const colorset = {
    colors: [
      {
        color: {
          'color-space': 'srgb',
          components: {
            alpha: formatColorComponent(rgba.a),
            blue: formatColorComponent(rgba.b),
            green: formatColorComponent(rgba.g),
            red: formatColorComponent(rgba.r),
          },
        },
        idiom: 'universal',
      },
    ],
    info: { version: 1, author: 'xcode' },
  };
  fs.writeFileSync(path.join(colorsetDir, 'Contents.json'), JSON.stringify(colorset, null, 2));

  const splashImagePath = splash?.image ? path.resolve(appDir, splash.image) : null;
  if (!splashImagePath || !fs.existsSync(splashImagePath)) {
    if (splash?.image) {
      console.warn(`⚠️  Splash image not found: ${splashImagePath}`);
    }
    return;
  }

  const imagesetDir = path.join(assetsDir, 'LaunchImage.imageset');
  fs.rmSync(imagesetDir, { recursive: true, force: true });
  fs.mkdirSync(imagesetDir, { recursive: true });
  const ext = path.extname(splashImagePath) || '.png';
  const filename = `splash${ext}`;
  fs.copyFileSync(splashImagePath, path.join(imagesetDir, filename));
  const imageset = {
    images: [
      { idiom: 'universal', filename, scale: '1x' },
      { idiom: 'universal', filename, scale: '2x' },
      { idiom: 'universal', filename, scale: '3x' },
    ],
    info: { version: 1, author: 'xcode' },
  };
  fs.writeFileSync(path.join(imagesetDir, 'Contents.json'), JSON.stringify(imageset, null, 2));
  const quiet = Boolean(process.env.ZYNTH_QUIET_BOOTSTRAP);
  if (!quiet) {
    console.log('  ✓ Generated iOS Splash Assets');
  }
}

function generateAndroidIcons(appDir: string, iconPath: string): void {
  if (!fs.existsSync(iconPath)) return;

  const resDir = path.join(appDir, 'android', 'app', 'src', 'main', 'res');
  
  const densities: Record<string, number> = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
  };

  for (const [folder, size] of Object.entries(densities)) {
    const targetDir = path.join(resDir, folder);
    fs.mkdirSync(targetDir, { recursive: true });
    
    resizeImage(iconPath, path.join(targetDir, 'ic_launcher.png'), size, size);
    resizeImage(iconPath, path.join(targetDir, 'ic_launcher_round.png'), size, size);
  }
  const quiet = Boolean(process.env.ZYNTH_QUIET_BOOTSTRAP);
  if (!quiet) {
    console.log('  ✓ Generated Android Legacy Icons');
  }
}

function generateAndroidAdaptiveIcons(appDir: string, adaptive: { foregroundImage: string, backgroundColor: string }): void {
    const resDir = path.join(appDir, 'android', 'app', 'src', 'main', 'res');
    const foregroundPath = path.resolve(appDir, adaptive.foregroundImage);
    
    if (!fs.existsSync(foregroundPath)) {
        console.warn(`⚠️  Adaptive icon foreground not found: ${foregroundPath}`);
        return;
    }

    const densities: Record<string, number> = {
        'mipmap-mdpi': 108,
        'mipmap-hdpi': 162,
        'mipmap-xhdpi': 216,
        'mipmap-xxhdpi': 324,
        'mipmap-xxxhdpi': 432,
    };

    for (const [folder, size] of Object.entries(densities)) {
        const targetDir = path.join(resDir, folder);
        fs.mkdirSync(targetDir, { recursive: true });
        resizeImage(foregroundPath, path.join(targetDir, 'ic_launcher_foreground.png'), size, size);
    }

    const valuesDir = path.join(resDir, 'values');
    fs.mkdirSync(valuesDir, { recursive: true });
    const colorsXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${adaptive.backgroundColor}</color>
</resources>`;
    fs.writeFileSync(path.join(valuesDir, 'ic_launcher_background.xml'), colorsXml);

    const anydpiDir = path.join(resDir, 'mipmap-anydpi-v26');
    fs.mkdirSync(anydpiDir, { recursive: true });

    const iconXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>`;

    fs.writeFileSync(path.join(anydpiDir, 'ic_launcher.xml'), iconXml);
    fs.writeFileSync(path.join(anydpiDir, 'ic_launcher_round.xml'), iconXml);
    
  const quiet = Boolean(process.env.ZYNTH_QUIET_BOOTSTRAP);
  if (!quiet) {
    console.log('  ✓ Generated Android Adaptive Icons');
  }
}

function normalizeAndroidColor(value: string | undefined): string {
  if (!value) return "#ffffff";
  const trimmed = value.trim();
  if (!trimmed) return "#ffffff";
  const normalized = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return parseHexColor(normalized) ? normalized : "#ffffff";
}

/**
 * Resolves paths for icon fonts from @zynth/icons based on discovery map.
 * This is needed because the fonts are not explicitly in the app's source 
 * and thus not in the fonts-manifest.json.
 */
function resolveZynthIconFonts(appDir: string, glyphMap?: Record<string, string>): string[] {
  if (!glyphMap) return [];
  
  const foundFonts: string[] = [];
  try {
    // Resolve @zynth/icons main entry point
    const mainEntry = require.resolve('@zynth/icons', { paths: [appDir] });
    // From dist/esm/index.js, go up 3 levels to reach package root
    const iconsDir = path.dirname(path.dirname(path.dirname(mainEntry)));
    const fontsSourceDir = path.join(iconsDir, 'assets', 'fonts');

    for (const familyName of Object.keys(glyphMap)) {
      if (familyName.startsWith('ZynthIcons')) {
        const fontPath = path.join(fontsSourceDir, `${familyName}.ttf`);
        if (fs.existsSync(fontPath)) {
          foundFonts.push(fontPath);
        }
      }
    }
  } catch (e: any) {
    // Ignore if not found
  }
  
  return foundFonts;
}

/**
 * Resolves all available icon fonts from @zynth/icons.
 * Used in dev mode to ensure all icons are available.
 */
function resolveAllZynthIconFonts(appDir: string): string[] {
  const foundFonts: string[] = [];
  try {
    const mainEntry = require.resolve('@zynth/icons', { paths: [appDir] });
    const iconsDir = path.dirname(path.dirname(path.dirname(mainEntry)));
    const fontsSourceDir = path.join(iconsDir, 'assets', 'fonts');

    if (fs.existsSync(fontsSourceDir)) {
      const files = fs.readdirSync(fontsSourceDir);
      for (const file of files) {
        if (file.startsWith('ZynthIcons') && file.endsWith('.ttf')) {
          foundFonts.push(path.join(fontsSourceDir, file));
        }
      }
    }
  } catch (e: any) {
    // Ignore
  }
  return foundFonts;
}

async function copyFonts(appDir: string, fonts: string[], platform: 'ios' | 'android', appName: string, glyphMap?: Record<string, string>, dev: boolean = false): Promise<void> {
  if (!fonts || !Array.isArray(fonts) || fonts.length === 0) return;

  const targetDir = platform === 'ios' 
    ? path.join(appDir, 'ios', appName, 'fonts')
    : path.join(appDir, 'android', 'app', 'src', 'main', 'assets', 'fonts');

  fs.mkdirSync(targetDir, { recursive: true });

  const quiet = Boolean(process.env.ZYNTH_QUIET_BOOTSTRAP);

  for (const fontRelativePath of fonts) {
    const sourcePath = path.resolve(appDir, fontRelativePath);
    if (!fs.existsSync(sourcePath)) {
      console.warn(`⚠️  Font not found: ${sourcePath}`);
      continue;
    }
    const fontFileName = path.basename(sourcePath);
    const destPath = path.join(targetDir, fontFileName);
    
    // Check if we can subset this font
    let subsetted = false;
    // The font family name in glyphMap might be something like "ZynthIconsBS"
    const familyMatch = fontFileName.match(/^(ZynthIcons[A-Z]{2})([.-]|$)/);
    const familyName = familyMatch ? familyMatch[1] : null;

    if (familyName && glyphMap) {
      if (!glyphMap[familyName]) {
        // Identified as a Zynth font library but it is not used in the bundle.
        // We skip copying it to save space in the final AAB.
        if (!quiet) {
          console.log(`  ✓ Excluding unused icon font: ${fontFileName}`);
        }
        continue;
      }

      // If we reach here, the font IS used in the bundle (or we're in dev mode).
      // We try to subset it if the tool is available and we're NOT in dev mode.
      if (subsetFont && glyphMap[familyName]) {
        try {
          const glyphs = glyphMap[familyName];
          const originalContent = fs.readFileSync(sourcePath);
          const subsetContent = await subsetFont(originalContent, glyphs, { targetFormat: 'truetype' });
          
          fs.writeFileSync(destPath, subsetContent);
          subsetted = true;
          
          if (!quiet) {
            const savings = Math.round((1 - subsetContent.length / originalContent.length) * 100);
            console.log(`  ✓ Subsetted and copied font: ${fontFileName} (${savings}% smaller)`);
          }
        } catch (e: any) {
          if (!quiet) {
            console.warn(`  ! Failed to subset font ${fontFileName}: ${e.message}. Copying original...`);
          }
        }
      } else if (!quiet && !process.env.ZYNTH_SUPPRESS_OPT_WARNING) {
        // Tool missing but font is used: copy original.
        // Alert once per library if subsetFont is null.
        console.warn(`  ! Note: Used font ${fontFileName} copied without subsetting because 'subset-font' is not installed.`);
      }
    }

    if (!subsetted) {
      fs.copyFileSync(sourcePath, destPath);
      // Suppress individual font logs in dev mode for ZynthIcons to avoid terminal clutter
      const isZynthIcon = fontFileName.startsWith('ZynthIcons');
      if (!quiet && (!dev || !isZynthIcon)) {
        console.log(`  ✓ Copied font: ${fontFileName}`);
      }
    }
  }
}

async function copyBundledImages(appDir: string, platform: 'ios' | 'android', appName: string): Promise<void> {
  const manifestPath = path.join(appDir, 'dist', 'assets', 'images-manifest.json');
  if (!fs.existsSync(manifestPath)) return;

  let manifest: Record<string, string> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      manifest = parsed as Record<string, string>;
    }
  } catch (_error) {
    return;
  }

  const targetRoot = platform === 'ios'
    ? path.join(appDir, 'ios', appName)
    : path.join(appDir, 'android', 'app', 'src', 'main', 'assets');
  fs.mkdirSync(targetRoot, { recursive: true });

  const quiet = Boolean(process.env.ZYNTH_QUIET_BOOTSTRAP);
  const copiedCount = { original: 0, webp: 0 };

  for (const [relativeDestPath, sourcePath] of Object.entries(manifest)) {
    if (!relativeDestPath || typeof sourcePath !== 'string' || sourcePath.length === 0) {
      continue;
    }
    if (!fs.existsSync(sourcePath)) {
      continue;
    }

    const normalizedRelative = relativeDestPath.replace(/^\/+/, '');
    const destPath = path.join(targetRoot, normalizedRelative);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    // Optimization: Convert large non-vector images to webp if sharp is available
    let optimized = false;
    const ext = path.extname(sourcePath).toLowerCase();
    const isLarge = fs.statSync(sourcePath).size > 50 * 1024; // > 50KB

    if (sharp && isLarge && (ext === '.png' || ext === '.jpg' || ext === '.jpeg')) {
      try {
        const webpDest = destPath.replace(new RegExp(`${ext}$`), '.webp');
        await sharp(sourcePath)
          .webp({ quality: 85 })
          .toFile(webpDest);
        
        // We still copy the original for backward compatibility or if needed,
        // but the app should prefer .webp if it exists.
        // Actually, to save size on Android, we can REPLACE it if we want.
        // But for now, let's just copy both or replace if it's android.
        if (platform === 'android') {
           // Swap extension in manifest logic would be better, but we can't easily change the JS source.
           // However, Zynth's AssetProvider can be updated to prefer webp.
           // For now, let's just provide both.
           fs.copyFileSync(sourcePath, destPath);
        } else {
           fs.copyFileSync(sourcePath, destPath);
        }
        optimized = true;
        copiedCount.webp++;
      } catch (e) {
        // fallback to copy
      }
    }

    if (!optimized) {
      fs.copyFileSync(sourcePath, destPath);
      copiedCount.original++;
    }
  }

  if (!quiet && (copiedCount.original > 0 || copiedCount.webp > 0)) {
    console.log(`  ✓ Copied ${copiedCount.original + copiedCount.webp} bundled image asset(s) (${copiedCount.webp} optimized to WebP)`);
  }
}

function generateAndroidSplashAssets(appDir: string, splash: any): void {
  const resDir = path.join(appDir, 'android', 'app', 'src', 'main', 'res');
  const valuesDir = path.join(resDir, 'values');
  const drawableDir = path.join(resDir, 'drawable');
  fs.mkdirSync(valuesDir, { recursive: true });
  fs.mkdirSync(drawableDir, { recursive: true });

  const backgroundColor = normalizeAndroidColor(splash?.backgroundColor);
  const colorsXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="zynth_splash_background">${backgroundColor}</color>
</resources>`;
  fs.writeFileSync(path.join(valuesDir, 'zynth_splash.xml'), colorsXml);

  const splashImagePath = splash?.image ? path.resolve(appDir, splash.image) : null;
  const hasImage = splashImagePath && fs.existsSync(splashImagePath);
  let imageRef = "";

  if (hasImage) {
    const ext = path.extname(splashImagePath as string) || '.png';
    const filename = `zynth_splash_image${ext}`;
    fs.copyFileSync(splashImagePath as string, path.join(drawableDir, filename));
    imageRef = "@drawable/zynth_splash_image";
  } else if (splash?.image) {
    console.warn(`⚠️  Splash image not found: ${splashImagePath}`);
  }

  const resizeMode = String(splash?.resizeMode || "contain")
    .trim()
    .toLowerCase();
  const gravity = resizeMode === "cover" || resizeMode === "stretch" ? "fill" : "center";

  const drawableXml = hasImage
    ? `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/zynth_splash_background" />
    <item>
        <bitmap android:src="${imageRef}" android:gravity="${gravity}" />
    </item>
</layer-list>`
    : `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/zynth_splash_background" />
</layer-list>`;

  fs.writeFileSync(path.join(drawableDir, 'zynth_splash_screen.xml'), drawableXml);
  console.log('  ✓ Generated Android Splash Assets');
}

export async function generateAssets(appDir: string, platform: 'ios' | 'android', dev: boolean = false, glyphMap?: Record<string, string>): Promise<void> {
  const quiet = Boolean(process.env.ZYNTH_QUIET_BOOTSTRAP);
  const config = getAppConfig(appDir);
  
  if (!quiet && !process.env.ZYNTH_SUPPRESS_OPT_WARNING) {
    if (!sharp) {
      console.warn("  ! Note: Image optimization (WebP conversion) is disabled because 'sharp' is not installed in zynth.");
    }
    if (!subsetFont) {
      console.warn("  ! Note: Icon font subsetting is disabled because 'subset-font' is not installed in zynth. (Unused fonts will still be excluded).");
    }
  }

  const appJsonPath = path.join(appDir, 'app.json');
  let appConfig: any = {};
  if (fs.existsSync(appJsonPath)) {
    try {
      const json = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
      appConfig = json.zynth || json;
    } catch (e) {
      // Ignore parse errors here, use empty config
    }
  }
  
  const cleanAppName = config.appName;

  // Discover fonts from manifest (generated by JS build)
  const allFonts: string[] = [];
  
  // Combine manual fonts, discovered fonts and icon fonts
  if (dev) {
    // In dev mode, we copy ALL icon fonts (unsubsetted) to ensure every icon is available
    const zynthIconFonts = resolveAllZynthIconFonts(appDir);
    allFonts.push(...(appConfig.fonts || []), ...zynthIconFonts);
    if (!quiet) {
      console.log(`  ✓ Including all ${zynthIconFonts.length} icon fonts (Dev mode)`);
    }
  } else {
    // Discovery from manifest (generated by JS build)
    const manifestPath = path.join(appDir, 'dist', 'assets', 'fonts-manifest.json');
    const discoveredFonts: string[] = [];
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        Object.values(manifest).forEach((fullPath: any) => {
          discoveredFonts.push(fullPath);
        });
      } catch (e) {
        // Ignore manifest errors
      }
    }

    // Combine manual fonts and discovered fonts
    allFonts.push(...(appConfig.fonts || []), ...discoveredFonts);

    // Auto-inject Zynth Icon fonts based on glyphMap discovery
    const zynthIconFonts = resolveZynthIconFonts(appDir, glyphMap);
    allFonts.push(...zynthIconFonts);
  }

  if (platform === 'ios') {
      if (appConfig.icon) {
        const iconPath = path.resolve(appDir, appConfig.icon);
        generateIOSIcons(appDir, iconPath, cleanAppName);
      }
      generateIOSSplashAssets(appDir, appConfig.splash || {}, cleanAppName);
      await copyBundledImages(appDir, 'ios', cleanAppName);
      if (allFonts.length > 0) {
        await copyFonts(appDir, allFonts, 'ios', cleanAppName, glyphMap, dev);
      }
  }

  if (platform === 'android') {
      if (appConfig.android?.adaptiveIcon) {
          generateAndroidAdaptiveIcons(appDir, appConfig.android.adaptiveIcon);
          // Also generate legacy icons using the foreground image as fallback (or the main icon if present)
          const legacyIcon = appConfig.icon ? path.resolve(appDir, appConfig.icon) : path.resolve(appDir, appConfig.android.adaptiveIcon.foregroundImage);
          generateAndroidIcons(appDir, legacyIcon);
      } else if (appConfig.icon) {
          const iconPath = path.resolve(appDir, appConfig.icon);
          generateAndroidIcons(appDir, iconPath);
      }
      generateAndroidSplashAssets(appDir, appConfig.splash || {});
      await copyBundledImages(appDir, 'android', cleanAppName);
      if (allFonts.length > 0) {
        await copyFonts(appDir, allFonts, 'android', cleanAppName, glyphMap, dev);
      }
  }
}
