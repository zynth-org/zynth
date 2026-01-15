import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getAppConfig } from './config-utils';

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
      idiom: "iphone",
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
  const quiet = Boolean(process.env.ZYNTH_QUIET_PREBUILD);
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
  const quiet = Boolean(process.env.ZYNTH_QUIET_PREBUILD);
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
  const quiet = Boolean(process.env.ZYNTH_QUIET_PREBUILD);
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
    
  const quiet = Boolean(process.env.ZYNTH_QUIET_PREBUILD);
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

export function generateAssets(appDir: string, platform: 'ios' | 'android'): void {
  const config = getAppConfig(appDir);
  const appJsonPath = path.join(appDir, 'app.json');
  let appConfig: any = {};
  if (fs.existsSync(appJsonPath)) {
      const json = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
      appConfig = json.zynth || json;
  }
  
  const cleanAppName = config.appName;

  if (platform === 'ios') {
      if (appConfig.icon) {
        const iconPath = path.resolve(appDir, appConfig.icon);
        generateIOSIcons(appDir, iconPath, cleanAppName);
      }
      generateIOSSplashAssets(appDir, appConfig.splash || {}, cleanAppName);
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
  }
}
