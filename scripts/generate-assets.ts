import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getAppConfig } from './config-utils';

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
  console.log('  ✓ Generated iOS App Icons');
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
  console.log('  ✓ Generated Android Legacy Icons');
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
    
    console.log('  ✓ Generated Android Adaptive Icons');
}

export function generateAssets(appDir: string, platform: 'ios' | 'android'): void {
  const config = getAppConfig(appDir);
  const appJsonPath = path.join(appDir, 'app.json');
  let appConfig: any = {};
  if (fs.existsSync(appJsonPath)) {
      const json = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
      appConfig = json.rune || json;
  }
  
  const cleanAppName = config.appName;

  if (platform === 'ios') {
      if (appConfig.icon) {
        const iconPath = path.resolve(appDir, appConfig.icon);
        generateIOSIcons(appDir, iconPath, cleanAppName);
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
  }
}
