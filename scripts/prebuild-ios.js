#!/usr/bin/env node

/**
 * Generic prebuild script for Solid Native apps
 * Usage: node ../../scripts/prebuild-ios.js
 * 
 * This script:
 * 1. Auto-detects the current app directory
 * 2. Generates iOS project from template
 * 3. Runs xcodegen and pod install
 */

const path = require('path');
const { generateIOSProject } = require('./generate-ios.js');
const { execSync } = require('child_process');

function main() {
  // Auto-detect current app directory
  const currentDir = process.cwd();
  const appDir = currentDir;
  
  console.log('🚀 Starting iOS prebuild...');
  console.log(`📱 App directory: ${appDir}`);
  
  try {
    // Step 1: Generate iOS project
    console.log('\n📦 Generating iOS project from template...');
    generateIOSProject(appDir);
    
    // Step 2: Change to iOS directory
    const iosDir = path.join(appDir, 'ios');
    process.chdir(iosDir);
    
    // Step 3: Run xcodegen
    console.log('\n⚙️  Running XcodeGen...');
    execSync('xcodegen generate --spec project.yml', { stdio: 'inherit' });
    
    // Step 4: Install pods
    console.log('\n🍎 Installing CocoaPods dependencies...');
    execSync('pod install', { stdio: 'inherit' });
    
    console.log('\n✅ iOS prebuild completed successfully!');
    console.log('📂 You can now open the .xcworkspace file in Xcode');
    
  } catch (error) {
    console.error('\n❌ Prebuild failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
