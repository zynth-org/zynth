const ANDROID_BUILD_NOISE_PATTERNS = [
  /^\s*>\s*@zynth\/core@[\d.]+\s+sync:yoga\s*$/i,
  /^\s*>\s*node\s+scripts\/sync-yoga-binaries.mjs\s+sync\s*$/i,
  /^\s*◆\s*Synchronizing Yoga binaries\s*\(sync\)\s*$/i,
  /^\s*Manifest version:\s*yoga-v[\d.]+\s*$/i,
  /^\s*•\s+yoga-headers:\s+up-to-date\s*$/i,
  /^\s*•\s+android-arm64-v8a:\s+up-to-date\s*$/i,
  /^\s*•\s+android-armeabi-v7a:\s+up-to-date\s*$/i,
  /^\s*•\s+android-x86_64:\s+up-to-date\s*$/i,
  /^\s*•\s+android-x86:\s+up-to-date\s*$/i,
  /^\s*➔\s+.*:\s+synced\s*$/i,
  /^\s*•\s+.*:\s+downloading\s*$/i,
];

module.exports = {
  ANDROID_BUILD_NOISE_PATTERNS,
};
