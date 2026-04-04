import { cpSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

type PlatformName = "android" | "ios";
type AndroidAbi = "arm64-v8a" | "x86_64";

type BuildOptions = {
  platform: PlatformName;
  profile: "debug" | "release";
  abis: AndroidAbi[];
};

const FRAMEWORK_ROOT = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(FRAMEWORK_ROOT, "..");
const AXON_ROOT = resolve(REPO_ROOT, "axon/lib");
const DEFAULT_ANDROID_ABIS: AndroidAbi[] = ["arm64-v8a", "x86_64"];
const ABI_TARGETS: Record<AndroidAbi, string> = {
  "arm64-v8a": "aarch64-linux-android",
  x86_64: "x86_64-linux-android",
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const result = spawnSync(cmd, args, {
    cwd,
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function printHelp(): void {
  console.log(`Usage:
  yarn native android
  yarn native android --debug
  yarn native android --abi arm64-v8a
  yarn native android --abi x86_64

Options:
  --debug        Build the Rust library with the debug profile
  --release      Build the Rust library with the release profile (default)
  --abi <name>   Restrict Android output to a single ABI (arm64-v8a or x86_64)

Notes:
  - Android builds copy libaxon_engine.a into axon/lib/target/android/<abi>/
  - iOS is reserved for future support in this same command`);
}

function parseArgs(argv: string[]): BuildOptions {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  const platform = argv[0];
  if (platform !== "android" && platform !== "ios") {
    fail(`Unknown platform '${platform}'. Expected 'android' or 'ios'.`);
  }

  let profile: BuildOptions["profile"] = "release";
  const abiValues: AndroidAbi[] = [];

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--debug") {
      profile = "debug";
      continue;
    }
    if (arg === "--release") {
      profile = "release";
      continue;
    }
    if (arg === "--abi") {
      const value = argv[i + 1];
      if (value !== "arm64-v8a" && value !== "x86_64") {
        fail(`Unsupported ABI '${value ?? ""}'. Expected 'arm64-v8a' or 'x86_64'.`);
      }
      abiValues.push(value);
      i += 1;
      continue;
    }
    fail(`Unknown argument '${arg}'. Use --help for usage.`);
  }

  return {
    platform,
    profile,
    abis: abiValues.length > 0 ? abiValues : DEFAULT_ANDROID_ABIS,
  };
}

function findAndroidNdkRoot(): string {
  const candidates = [
    process.env.ANDROID_NDK_HOME,
    process.env.ANDROID_NDK_ROOT,
    process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, "ndk") : undefined,
    process.env.ANDROID_SDK_ROOT ? join(process.env.ANDROID_SDK_ROOT, "ndk") : undefined,
    join(homedir(), "Library/Android/sdk/ndk"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    if (existsSync(join(candidate, "toolchains/llvm/prebuilt"))) {
      return candidate;
    }
    const versions = spawnSync("zsh", ["-lc", `find '${candidate}' -maxdepth 1 -mindepth 1 -type d | sort | tail -n 1`], {
      encoding: "utf8",
    });
    const latest = versions.stdout.trim();
    if (latest && existsSync(join(latest, "toolchains/llvm/prebuilt"))) {
      return latest;
    }
  }

  fail("Android NDK not found. Set ANDROID_NDK_HOME or install the SDK NDK.");
}

function findNdkPrebuiltBin(ndkRoot: string): string {
  const prebuiltRoot = join(ndkRoot, "toolchains/llvm/prebuilt");
  if (!existsSync(prebuiltRoot)) {
    fail(`Android NDK toolchain directory not found at ${prebuiltRoot}`);
  }
  const result = spawnSync("zsh", ["-lc", `find '${prebuiltRoot}' -maxdepth 1 -mindepth 1 -type d | sort | head -n 1`], {
    encoding: "utf8",
  });
  const prebuiltDir = result.stdout.trim();
  if (!prebuiltDir) {
    fail(`Android NDK prebuilt toolchain not found under ${prebuiltRoot}`);
  }
  return join(prebuiltDir, "bin");
}

function linkerPath(binDir: string, abi: AndroidAbi): string {
  const prefix = ABI_TARGETS[abi];
  const linker = join(binDir, `${prefix}34-clang`);
  if (!existsSync(linker)) {
    fail(`Android linker not found at ${linker}`);
  }
  return linker;
}

function cargoProfileArgs(profile: BuildOptions["profile"]): string[] {
  return profile === "release" ? ["--release"] : [];
}

function copyAndroidArtifact(target: string, abi: AndroidAbi, profile: BuildOptions["profile"]): void {
  const profileDir = profile === "release" ? "release" : "debug";
  const builtLib = join(AXON_ROOT, "target", target, profileDir, "libaxon_engine.a");
  if (!existsSync(builtLib)) {
    fail(`Built Axon library not found at ${builtLib}`);
  }
  const outputDir = join(AXON_ROOT, "target", "android", abi);
  mkdirSync(outputDir, { recursive: true });
  cpSync(builtLib, join(outputDir, "libaxon_engine.a"));
}

function buildAndroid(options: BuildOptions): void {
  const ndkRoot = findAndroidNdkRoot();
  const binDir = findNdkPrebuiltBin(ndkRoot);
  const baseEnv = {
    ...process.env,
    ANDROID_NDK_HOME: process.env.ANDROID_NDK_HOME ?? ndkRoot,
    ANDROID_NDK_ROOT: process.env.ANDROID_NDK_ROOT ?? ndkRoot,
  };

  for (const abi of options.abis) {
    const target = ABI_TARGETS[abi];
    const env = {
      ...baseEnv,
      [`CARGO_TARGET_${target.toUpperCase().replaceAll("-", "_")}_LINKER`]: linkerPath(binDir, abi),
    };
    console.log(`Building Axon for Android ${abi} (${options.profile})`);
    run("cargo", ["build", "--target", target, ...cargoProfileArgs(options.profile)], AXON_ROOT, env);
    copyAndroidArtifact(target, abi, options.profile);
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (options.platform === "ios") {
    fail("iOS build support is not implemented yet. Use 'yarn native android' for now.");
  }
  buildAndroid(options);
}

main();
