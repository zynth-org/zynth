#!/bin/bash
set -e

# provision-yoga.sh
# Automates the process of downloading, patching, and compiling Yoga binaries 
# with 16KB alignment and exported symbols for the Zynth framework.

YOGA_VERSION=${1:-"3.2.1"}
WORK_DIR=$(mktemp -d)
PROJECT_ROOT=$(pwd)
TARGET_DIR="$PROJECT_ROOT/packages/zynth-core/native/vendor/android"

echo "🚀 Provisioning Yoga v$YOGA_VERSION..."
echo "📂 Work directory: $WORK_DIR"

# 1. Download Yoga Source
cd "$WORK_DIR"
curl -L "https://github.com/facebook/yoga/archive/refs/tags/v$YOGA_VERSION.tar.gz" -o yoga.tar.gz
tar -xzf yoga.tar.gz
cd "yoga-$YOGA_VERSION"

# 2. Apply 16KB alignment and symbol export patches
echo "🛠 Patching CMakeLists.txt..."
sed -i '' 's/target_link_options(yoga PRIVATE -Wl,--version-script=${VERSION_SCRIPT})/target_link_options(yoga PRIVATE -Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384)/' java/CMakeLists.txt

# 3. Build for all Android ABIs
echo "🏗 Building Yoga (this may take a few minutes)..."
./gradlew :yoga:assembleRelease

# 4. Provision binaries to Zynth core
echo "📦 Provisioning binaries to $TARGET_DIR..."

mkdir -p "$TARGET_DIR/arm64-v8a"
mkdir -p "$TARGET_DIR/armeabi-v7a"
mkdir -p "$TARGET_DIR/x86"
mkdir -p "$TARGET_DIR/x86_64"

cp java/build/intermediates/stripped_native_libs/release/stripReleaseDebugSymbols/out/lib/arm64-v8a/libyoga.so "$TARGET_DIR/arm64-v8a/"
cp java/build/intermediates/stripped_native_libs/release/stripReleaseDebugSymbols/out/lib/armeabi-v7a/libyoga.so "$TARGET_DIR/armeabi-v7a/"
cp java/build/intermediates/stripped_native_libs/release/stripReleaseDebugSymbols/out/lib/x86/libyoga.so "$TARGET_DIR/x86/"
cp java/build/intermediates/stripped_native_libs/release/stripReleaseDebugSymbols/out/lib/x86_64/libyoga.so "$TARGET_DIR/x86_64/"

echo "✅ Yoga v$YOGA_VERSION provisioned successfully!"

# Cleanup
rm -rf "$WORK_DIR"
