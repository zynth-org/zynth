import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type SuiteName = "startup" | "layout";

type Options = {
  activity: string;
  branch: string;
  buildVariant: "debug" | "release";
  iterations: number;
  layoutDumpFile: string;
  startupObserveMs: number;
  layoutMeasureMs: number;
  layoutWarmupMs: number;
  output: string;
  packageName: string;
  prepareApp: boolean;
  reinstallApp: boolean;
  startupDumpFile: string;
  suites: readonly SuiteName[];
};

type StartupSample = {
  appFirstFrameToInteractiveMs: number | null;
  appRuntimeToFirstFrameMs: number | null;
  appStartToFirstFrameMs: number | null;
  appStartToFirstInteractiveMs: number | null;
  branch: string;
  iteration: number;
  sampleId: string;
  startupTime: Record<string, unknown> | null;
};

type LayoutSample = {
  avgYogaMeasureMs: number | null;
  branch: string;
  budgetOverruns: number;
  iteration: number;
  lastYogaCalcMs: number | null;
  lastYogaMeasureMs: number | null;
  lastYogaMs: number | null;
  maxYogaMeasureMs: number | null;
  minYogaMeasureMs: number | null;
  p50YogaMeasureMs: number | null;
  p90YogaMeasureMs: number | null;
  p95YogaMeasureMs: number | null;
  p99YogaMeasureMs: number | null;
  sampleId: string;
  totalPasses: number;
  yogaMeasureSampleCount: number;
};

type NumericSummary = {
  avg: number | null;
  max: number | null;
  median: number | null;
  min: number | null;
  p95: number | null;
};

type StartupSummary = {
  appFirstFrameToInteractiveMs: NumericSummary;
  appRuntimeToFirstFrameMs: NumericSummary;
  appStartToFirstFrameMs: NumericSummary;
  appStartToFirstInteractiveMs: NumericSummary;
  deadlineMissCount: NumericSummary;
  frameCount: NumericSummary;
  launchThisTimeMs: NumericSummary;
  launchTotalTimeMs: NumericSummary;
  launchWaitTimeMs: NumericSummary;
  maxFrameMs: NumericSummary;
  p50FrameMs: NumericSummary;
  p90FrameMs: NumericSummary;
  p95FrameMs: NumericSummary;
  p99FrameMs: NumericSummary;
  sampleCount: number;
};

type LayoutSummary = {
  avgYogaMeasureMs: NumericSummary;
  budgetOverruns: NumericSummary;
  lastYogaCalcMs: NumericSummary;
  lastYogaMeasureMs: NumericSummary;
  lastYogaMs: NumericSummary;
  maxYogaMeasureMs: NumericSummary;
  minYogaMeasureMs: NumericSummary;
  p50YogaMeasureMs: NumericSummary;
  p90YogaMeasureMs: NumericSummary;
  p95YogaMeasureMs: NumericSummary;
  p99YogaMeasureMs: NumericSummary;
  sampleCount: number;
  totalPasses: NumericSummary;
  yogaMeasureSampleCount: NumericSummary;
};

type Artifact = {
  activity: string;
  branch: string;
  generatedAt: string;
  iterations: number;
  packageName: string;
  schemaVersion: 1;
  suites: {
    layout?: {
      samples: LayoutSample[];
      summary: LayoutSummary;
    };
    startup?: {
      samples: StartupSample[];
      summary: StartupSummary;
    };
  };
};

const STARTUP_METRICS_LOG_TAG = "ZynthStartupMetrics";
const LAYOUT_METRICS_LOG_TAG = "ZynthLayoutMetrics";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const COMPONENTS_APP_DIR = resolve(REPO_ROOT, "apps/components");
const COMPONENTS_ANDROID_DIR = resolve(COMPONENTS_APP_DIR, "android");
const APP_STARTUP_LOG_TAGS = [
  "MainActivity",
  "ZynthStartupMetrics",
  "ZynthLayoutMetrics",
  "AndroidRuntime",
  "Zynth",
] as const;
const runAsCapabilityCache = new Map<string, boolean>();

function printUsage(): void {
  process.stdout.write(
    [
      "Usage:",
      "  node --experimental-strip-types scripts/android-performance-benchmark.ts [options]",
      "",
      "Options:",
      "  --branch <name>",
      "  --iterations <count>",
      "  --package <android.package>",
      "  --activity <android.package/.MainActivity>",
      "  --build-variant <debug|release>",
      "  --suites <startup,layout>",
      "  --prepare-app <true|false>",
      "  --reinstall-app <true|false>",
      "  --startup-observe-ms <ms>",
      "  --layout-warmup-ms <ms>",
      "  --layout-measure-ms <ms>",
      "  --layout-dump-file <relative-path>",
      "  --startup-dump-file <relative-path>",
      "  --output <artifact-path>",
      "  --help",
      "",
    ].join("\n"),
  );
}

function parseArgs(argv: readonly string[]): Options {
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--help" || current === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) {
      continue;
    }
    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      values.set(key, "true");
      continue;
    }
    values.set(key, next);
    index += 1;
  }

  const suitesRaw = values.get("suites") ?? "startup,layout";
  const suites = suitesRaw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry): entry is SuiteName => entry === "startup" || entry === "layout");

  if (suites.length === 0) {
    throw new Error("Expected at least one suite in --suites=startup,layout");
  }

  return {
    activity: values.get("activity") ?? "com.x64bits.zynth.components/.MainActivity",
    branch: values.get("branch") ?? "unknown-branch",
    buildVariant: parseBuildVariant(values.get("build-variant") ?? "release"),
    iterations: parseInteger(values.get("iterations") ?? "100", "iterations"),
    layoutDumpFile: values.get("layout-dump-file") ?? "benchmarks/layout-metrics.json",
    startupObserveMs: parseInteger(values.get("startup-observe-ms") ?? "2500", "startup-observe-ms"),
    layoutMeasureMs: parseInteger(values.get("layout-measure-ms") ?? "5000", "layout-measure-ms"),
    layoutWarmupMs: parseInteger(values.get("layout-warmup-ms") ?? "3000", "layout-warmup-ms"),
    output: resolve(values.get("output") ?? defaultOutputPath(values.get("branch") ?? "unknown-branch")),
    packageName: values.get("package") ?? "com.x64bits.zynth.components",
    prepareApp: parseBoolean(values.get("prepare-app") ?? "true", "prepare-app"),
    reinstallApp: parseBoolean(values.get("reinstall-app") ?? "true", "reinstall-app"),
    startupDumpFile: values.get("startup-dump-file") ?? "benchmarks/startup-metrics.json",
    suites,
  };
}

function defaultOutputPath(branch: string): string {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return `artifacts/android-perf/${branch}-${timestamp}.json`;
}

function parseInteger(raw: string, label: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${label}: ${raw}`);
  }
  return value;
}

function parseBoolean(raw: string, label: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`Invalid ${label}: ${raw}. Expected true or false.`);
}

function parseBuildVariant(raw: string): "debug" | "release" {
  if (raw === "debug" || raw === "release") {
    return raw;
  }
  throw new Error(`Invalid build-variant: ${raw}. Expected debug or release.`);
}

function logStatus(message: string): void {
  process.stdout.write(`${message}\n`);
}

function formatMetric(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(1);
}

function runAdb(args: readonly string[], allowFailure = false): string {
  try {
    return execFileSync("adb", args, { encoding: "utf8" });
  } catch (error) {
    if (allowFailure) {
      return "";
    }
    const message =
      error instanceof Error && error.message ? error.message : "adb command failed";
    throw new Error(`adb ${args.join(" ")} failed: ${message}`);
  }
}

function runHostCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  label: string,
): void {
  try {
    execFileSync(command, args, {
      cwd,
      stdio: "inherit",
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : `${command} failed`;
    throw new Error(`${label} failed: ${message}`);
  }
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function ensureParentDirectory(pathname: string): void {
  mkdirSync(dirname(pathname), { recursive: true });
}

function ensureAppInstalled(options: Options): void {
  const packagePath = runAdb(["shell", "pm", "path", options.packageName], true).trim();
  if (packagePath.length === 0) {
    throw new Error(
      [
        `Android package '${options.packageName}' is not installed on the connected device.`,
        "Build and install the app first, then rerun the benchmark.",
        "Suggested command:",
        "  cd apps/components/android && ./gradlew :app:installDebug",
      ].join("\n"),
    );
  }

  const resolveOutput = runAdb(
    [
      "shell",
      "cmd",
      "package",
      "resolve-activity",
      "--brief",
      "-c",
      "android.intent.category.LAUNCHER",
      options.packageName,
    ],
    true,
  ).trim();
  if (!resolveOutput.includes("/")) {
    throw new Error(
      [
        `Android package '${options.packageName}' is installed, but no launchable activity was resolved.`,
        `Expected activity argument: ${options.activity}`,
        "Check the installed variant or pass the correct --activity explicitly.",
      ].join("\n"),
    );
  }
}

function prepareBenchmarkApp(options: Options): void {
  if (!options.prepareApp) {
    return;
  }

  logStatus(
    `[prepare] variant=${options.buildVariant} reinstall=${options.reinstallApp ? "true" : "false"}`,
  );
  logStatus("[prepare] building local Android bundle assets");
  runHostCommand("yarn", ["zynth", "build", "android"], COMPONENTS_APP_DIR, "yarn zynth build android");

  if (options.reinstallApp) {
    logStatus(`[prepare] uninstalling ${options.packageName}`);
    runAdb(["uninstall", options.packageName], true);
  }

  logStatus(`[prepare] installing ${options.buildVariant} app`);
  const apkPath = resolve(
    COMPONENTS_ANDROID_DIR,
    options.buildVariant === "release"
      ? "app/build/outputs/apk/release/app-release.apk"
      : "app/build/outputs/apk/debug/app-debug.apk",
  );

  if (options.buildVariant === "debug") {
    logStatus("[prepare] assembling debug APK");
    runHostCommand("./gradlew", [":app:assembleDebug"], COMPONENTS_ANDROID_DIR, ":app:assembleDebug");
  }

  if (!existsSync(apkPath)) {
    throw new Error(`Expected APK not found at ${apkPath}`);
  }

  runAdb(["install", "-r", apkPath]);
}

function forceStop(packageName: string): void {
  runAdb(["shell", "am", "force-stop", packageName], true);
}

function resetGfxInfo(packageName: string): void {
  runAdb(["shell", "dumpsys", "gfxinfo", packageName, "reset"], true);
}

function clearLogcat(): void {
  runAdb(["logcat", "-c"], true);
}

function internalStartupDumpPath(relativePath: string): string {
  return `files/${relativePath}`;
}

function externalStartupDumpPath(packageName: string, relativePath: string): string {
  return `/sdcard/Android/data/${packageName}/files/${relativePath}`;
}

function startActivity(
  options: Options,
  benchmarkScenario: string,
  extras: readonly string[],
): void {
  const args = [
    "shell",
    "am",
    "start",
    "-n",
    options.activity,
    "--ez",
    "ZYNTH_FORCE_LOCAL_BUNDLE",
    "true",
    "--es",
    "ZYNTH_BENCHMARK_SCENARIO",
    benchmarkScenario,
    ...extras,
  ];
  runAdb(args);
}

function startActivityAndWait(
  options: Options,
  benchmarkScenario: string,
  extras: readonly string[],
): string {
  const args = [
    "shell",
    "am",
    "start",
    "-W",
    "-n",
    options.activity,
    "--ez",
    "ZYNTH_FORCE_LOCAL_BUNDLE",
    "true",
    "--es",
    "ZYNTH_BENCHMARK_SCENARIO",
    benchmarkScenario,
    ...extras,
  ];
  return runAdb(args);
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) {
    return null;
  }
  return text.slice(start).trim();
}

function canUseRunAs(packageName: string): boolean {
  const cached = runAsCapabilityCache.get(packageName);
  if (typeof cached === "boolean") {
    return cached;
  }
  const output = runAdb(
    [
      "shell",
      "sh",
      "-c",
      `run-as ${packageName} true >/dev/null 2>&1 && echo 1 || echo 0`,
    ],
    true,
  ).trim();
  const supported = output === "1";
  runAsCapabilityCache.set(packageName, supported);
  return supported;
}

function removeInternalStartupDump(packageName: string, relativePath: string): void {
  if (!canUseRunAs(packageName)) {
    return;
  }
  const targetPath = internalStartupDumpPath(relativePath);
  if (targetPath.length === 0) {
    return;
  }
  runAdb(["shell", "run-as", packageName, "rm", "-f", targetPath], true);
}

function runAsFileExists(packageName: string, targetPath: string): boolean {
  if (!canUseRunAs(packageName)) {
    return false;
  }
  const output = runAdb(
    [
      "shell",
      "run-as",
      packageName,
      "sh",
      "-c",
      `test -f ${targetPath} && echo 1 || echo 0`,
    ],
    true,
  ).trim();
  return output === "1";
}

function readInternalStartupDump(packageName: string, relativePath: string): string | null {
  if (!canUseRunAs(packageName)) {
    return null;
  }
  const targetPath = internalStartupDumpPath(relativePath);
  if (!runAsFileExists(packageName, targetPath)) {
    return null;
  }
  const output = runAdb(["shell", "run-as", packageName, "cat", targetPath], true).trim();
  return output.length > 0 ? output : null;
}

function shellFileExists(targetPath: string): boolean {
  const output = runAdb(
    ["shell", "sh", "-c", `test -f ${targetPath} && echo 1 || echo 0`],
    true,
  ).trim();
  return output === "1";
}

function readExternalStartupDump(packageName: string, relativePath: string): string | null {
  const targetPath = externalStartupDumpPath(packageName, relativePath);
  if (!shellFileExists(targetPath)) {
    return null;
  }
  const output = runAdb(["shell", "cat", targetPath], true).trim();
  return output.length > 0 ? output : null;
}

function removeExternalStartupDump(packageName: string, relativePath: string): void {
  const targetPath = externalStartupDumpPath(packageName, relativePath);
  if (targetPath.length === 0) {
    return;
  }
  runAdb(["shell", "rm", "-f", targetPath], true);
}

function readStartupPayloadFromInternalDump(
  packageName: string,
  relativePath: string,
): Record<string, unknown> | null {
  const raw = readInternalStartupDump(packageName, relativePath);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function readStartupPayloadFromExternalDump(
  packageName: string,
  relativePath: string,
): Record<string, unknown> | null {
  const raw = readExternalStartupDump(packageName, relativePath);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function parseAmStartWaitOutput(raw: string): {
  launchState: string | null;
  thisTimeMs: number | null;
  totalTimeMs: number | null;
  waitTimeMs: number | null;
} {
  const lines = raw.split(/\r?\n/u);
  let launchState: string | null = null;
  let thisTimeMs: number | null = null;
  let totalTimeMs: number | null = null;
  let waitTimeMs: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (line.startsWith("LaunchState:")) {
      launchState = line.slice("LaunchState:".length).trim() || null;
      continue;
    }
    if (line.startsWith("ThisTime:")) {
      thisTimeMs = parseOptionalInteger(line.slice("ThisTime:".length).trim());
      continue;
    }
    if (line.startsWith("TotalTime:")) {
      totalTimeMs = parseOptionalInteger(line.slice("TotalTime:".length).trim());
      continue;
    }
    if (line.startsWith("WaitTime:")) {
      waitTimeMs = parseOptionalInteger(line.slice("WaitTime:".length).trim());
    }
  }

  return { launchState, thisTimeMs, totalTimeMs, waitTimeMs };
}

function parseOptionalInteger(raw: string): number | null {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

function readStartupMetricsLog(): Record<string, unknown> | null {
  return readMetricsLogByTag(STARTUP_METRICS_LOG_TAG);
}

function readLayoutMetricsLog(): Record<string, unknown> | null {
  return readMetricsLogByTag(LAYOUT_METRICS_LOG_TAG);
}

function readMetricsLogByTag(tag: string): Record<string, unknown> | null {
  const output = runAdb(["logcat", "-d", "-s", `${tag}:I`, "*:S"], true);
  const lines = output.split(/\r?\n/u);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line.includes(tag)) {
      continue;
    }
    const jsonText = extractJsonObject(line);
    if (!jsonText) {
      continue;
    }
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function isFreshMetricsPayload(
  payload: Record<string, unknown>,
  benchmarkScenario: string,
  minCollectedAtEpochMs: number,
): boolean {
  const payloadScenario = payload.benchmarkScenario;
  const collectedAtEpochMs = payload.collectedAtEpochMs;
  if (payloadScenario !== benchmarkScenario) {
    return false;
  }
  return (
    typeof collectedAtEpochMs === "number" &&
    Number.isFinite(collectedAtEpochMs) &&
    collectedAtEpochMs >= minCollectedAtEpochMs
  );
}

function readRelevantAppLogs(packageName: string): string {
  const filterSpecs = APP_STARTUP_LOG_TAGS.map((tag) => `${tag}:V`);
  const output = runAdb(["logcat", "-d", "-t", "200", ...filterSpecs, "*:S"], true).trim();
  if (output.length > 0) {
    return output;
  }
  return `No filtered logs found for ${packageName}.`;
}

function waitForStartupPayload(
  options: Options,
  timeoutMs: number,
  benchmarkScenario: string,
  minCollectedAtEpochMs: number,
): Record<string, unknown> | null {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const internalPayload = readStartupPayloadFromInternalDump(
      options.packageName,
      options.startupDumpFile,
    );
    if (internalPayload && isFreshMetricsPayload(internalPayload, benchmarkScenario, minCollectedAtEpochMs)) {
      return internalPayload;
    }
    const externalPayload = readStartupPayloadFromExternalDump(
      options.packageName,
      options.startupDumpFile,
    );
    if (externalPayload && isFreshMetricsPayload(externalPayload, benchmarkScenario, minCollectedAtEpochMs)) {
      return externalPayload;
    }
    const payload = readStartupMetricsLog();
    if (payload && isFreshMetricsPayload(payload, benchmarkScenario, minCollectedAtEpochMs)) {
      return payload;
    }
    sleep(100);
  }
  return null;
}

function waitForLayoutPayload(
  options: Options,
  timeoutMs: number,
  benchmarkScenario: string,
  minCollectedAtEpochMs: number,
): Record<string, unknown> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const internalPayload = readStartupPayloadFromInternalDump(
      options.packageName,
      options.layoutDumpFile,
    );
    if (internalPayload && isFreshMetricsPayload(internalPayload, benchmarkScenario, minCollectedAtEpochMs)) {
      return internalPayload;
    }
    const externalPayload = readStartupPayloadFromExternalDump(
      options.packageName,
      options.layoutDumpFile,
    );
    if (externalPayload && isFreshMetricsPayload(externalPayload, benchmarkScenario, minCollectedAtEpochMs)) {
      return externalPayload;
    }
    const payload = readLayoutMetricsLog();
    if (payload && isFreshMetricsPayload(payload, benchmarkScenario, minCollectedAtEpochMs)) {
      return payload;
    }
    sleep(100);
  }
  throw new Error(
    `Timed out waiting for layout metrics export at '${internalStartupDumpPath(options.layoutDumpFile)}', '${externalStartupDumpPath(options.packageName, options.layoutDumpFile)}', or log tag '${LAYOUT_METRICS_LOG_TAG}'`,
  );
}

function appendJsonLine(pathname: string, value: unknown): void {
  appendFileSync(pathname, `${JSON.stringify(value)}\n`, "utf8");
}

function percentile(sortedValues: readonly number[], ratio: number): number | null {
  if (sortedValues.length === 0) {
    return null;
  }
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * ratio) - 1),
  );
  return sortedValues[index] ?? null;
}

function summarizeNumbers(values: readonly number[]): NumericSummary {
  if (values.length === 0) {
    return {
      avg: null,
      max: null,
      median: null,
      min: null,
      p95: null,
    };
  }
  const sorted = [...values].sort((left, right) => left - right);
  let total = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    total += sorted[index] ?? 0;
  }
  return {
    avg: total / sorted.length,
    max: sorted[sorted.length - 1] ?? null,
    median: percentile(sorted, 0.5),
    min: sorted[0] ?? null,
    p95: percentile(sorted, 0.95),
  };
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNumberOrNull(record: Record<string, unknown> | null, key: string): number | null {
  if (!record) {
    return null;
  }
  return readNumber(record, key);
}

function parseLayoutPayload(payload: Record<string, unknown>): Omit<LayoutSample, "branch" | "iteration" | "sampleId"> {
  const nativeYoga =
    payload.nativeYoga && typeof payload.nativeYoga === "object"
      ? (payload.nativeYoga as Record<string, unknown>)
      : {};
  return {
    avgYogaMeasureMs: readNumber(nativeYoga, "avgYogaMeasureMs"),
    budgetOverruns: readNumber(nativeYoga, "budgetOverruns") ?? 0,
    lastYogaCalcMs: readNumber(nativeYoga, "lastYogaCalcMs"),
    lastYogaMeasureMs: readNumber(nativeYoga, "lastYogaMeasureMs"),
    lastYogaMs: readNumber(nativeYoga, "lastYogaMs"),
    maxYogaMeasureMs: readNumber(nativeYoga, "maxYogaMeasureMs"),
    minYogaMeasureMs: readNumber(nativeYoga, "minYogaMeasureMs"),
    p50YogaMeasureMs: readNumber(nativeYoga, "p50YogaMeasureMs"),
    p90YogaMeasureMs: readNumber(nativeYoga, "p90YogaMeasureMs"),
    p95YogaMeasureMs: readNumber(nativeYoga, "p95YogaMeasureMs"),
    p99YogaMeasureMs: readNumber(nativeYoga, "p99YogaMeasureMs"),
    totalPasses: readNumber(nativeYoga, "totalPasses") ?? 0,
    yogaMeasureSampleCount: readNumber(nativeYoga, "yogaMeasureSampleCount") ?? 0,
  };
}

function runStartupSuite(options: Options): { samples: StartupSample[]; summary: StartupSummary } {
  const rawPath = options.output.replace(/\.json$/u, ".startup.raw.jsonl");
  const samples: StartupSample[] = [];
  logStatus(
    `[startup] branch=${options.branch} iterations=${options.iterations} observeMs=${options.startupObserveMs}`,
  );

  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    logStatus(`[startup] ${iteration}/${options.iterations} launching AppHub`);
    const sampleId = `${options.branch}-startup-${iteration}`;
    const benchmarkScenario = "startup-apphub";
    forceStop(options.packageName);
    resetGfxInfo(options.packageName);
    clearLogcat();
    const launchStartedAtEpochMs = Date.now();
    const launchOutput = startActivityAndWait(options, benchmarkScenario, [
      "--ez",
      "ZYNTH_STARTUP_METRICS",
      "true",
      "--es",
      "ZYNTH_STARTUP_METRICS_DUMP_FILE",
      options.startupDumpFile,
    ]);
    const startupPayload = waitForStartupPayload(
      options,
      options.startupObserveMs + 5000,
      benchmarkScenario,
      launchStartedAtEpochMs,
    );
    sleep(options.startupObserveMs);
    const startupFrameStats = parseFrameStats(
      runAdb(["shell", "dumpsys", "gfxinfo", options.packageName, "framestats"]),
    );
    const launch = parseAmStartWaitOutput(launchOutput);
    const startupSnapshot =
      startupPayload?.startupTime && typeof startupPayload.startupTime === "object"
        ? (startupPayload.startupTime as Record<string, unknown>)
        : null;
    const appStartToFirstFrameMs = readNumberOrNull(startupSnapshot, "startToFirstFrameMs");
    const appRuntimeToFirstFrameMs = readNumberOrNull(startupSnapshot, "runtimeToFirstFrameMs");
    const appFirstFrameToInteractiveMs = readNumberOrNull(
      startupSnapshot,
      "firstFrameToFirstInteractiveMs",
    );
    const appStartToFirstInteractiveMs = readNumberOrNull(
      startupSnapshot,
      "startToFirstInteractiveMs",
    );
    const startupTime: Record<string, unknown> = {
      launchState: launch.launchState,
      launchThisTimeMs: launch.thisTimeMs,
      launchTotalTimeMs: launch.totalTimeMs,
      launchWaitTimeMs: launch.waitTimeMs,
      frameCount: startupFrameStats.frameCount,
      deadlineMissCount: startupFrameStats.deadlineMissCount,
      maxFrameMs: startupFrameStats.maxFrameMs,
      p50FrameMs: startupFrameStats.p50FrameMs,
      p90FrameMs: startupFrameStats.p90FrameMs,
      p95FrameMs: startupFrameStats.p95FrameMs,
      p99FrameMs: startupFrameStats.p99FrameMs,
      startupObserveMs: options.startupObserveMs,
    };
    const sample: StartupSample = {
      appFirstFrameToInteractiveMs,
      appRuntimeToFirstFrameMs,
      appStartToFirstFrameMs,
      appStartToFirstInteractiveMs,
      branch: options.branch,
      iteration,
      sampleId,
      startupTime,
    };
    samples.push(sample);
    appendJsonLine(rawPath, sample);
    logStatus(
      `[startup] ${iteration}/${options.iterations} ThisTime=${formatMetric(launch.thisTimeMs)}ms TotalTime=${formatMetric(launch.totalTimeMs)}ms AppTTI=${formatMetric(appStartToFirstInteractiveMs)}ms p95=${formatMetric(startupFrameStats.p95FrameMs)}ms misses=${startupFrameStats.deadlineMissCount}`,
    );
    if (!startupPayload) {
      logStatus(
        `[startup] ${iteration}/${options.iterations} app startup payload unavailable on this build/branch; shell launch metrics only`,
      );
    }
    forceStop(options.packageName);
  }

  const appFirstFrameToInteractiveMs: number[] = [];
  const appRuntimeToFirstFrameMs: number[] = [];
  const appStartToFirstFrameMs: number[] = [];
  const appStartToFirstInteractiveMs: number[] = [];
  const launchThisTimeMs: number[] = [];
  const launchTotalTimeMs: number[] = [];
  const launchWaitTimeMs: number[] = [];
  const frameCount: number[] = [];
  const deadlineMissCount: number[] = [];
  const maxFrameMs: number[] = [];
  const p50FrameMs: number[] = [];
  const p90FrameMs: number[] = [];
  const p95FrameMs: number[] = [];
  const p99FrameMs: number[] = [];

  for (let index = 0; index < samples.length; index += 1) {
    const startup = samples[index]?.startupTime;
    if (!startup) {
      continue;
    }
    collectNumber(appFirstFrameToInteractiveMs, samples[index]?.appFirstFrameToInteractiveMs ?? null);
    collectNumber(appRuntimeToFirstFrameMs, samples[index]?.appRuntimeToFirstFrameMs ?? null);
    collectNumber(appStartToFirstFrameMs, samples[index]?.appStartToFirstFrameMs ?? null);
    collectNumber(appStartToFirstInteractiveMs, samples[index]?.appStartToFirstInteractiveMs ?? null);
    collectNumber(launchThisTimeMs, readNumber(startup, "launchThisTimeMs"));
    collectNumber(launchTotalTimeMs, readNumber(startup, "launchTotalTimeMs"));
    collectNumber(launchWaitTimeMs, readNumber(startup, "launchWaitTimeMs"));
    collectNumber(frameCount, readNumber(startup, "frameCount"));
    collectNumber(deadlineMissCount, readNumber(startup, "deadlineMissCount"));
    collectNumber(maxFrameMs, readNumber(startup, "maxFrameMs"));
    collectNumber(p50FrameMs, readNumber(startup, "p50FrameMs"));
    collectNumber(p90FrameMs, readNumber(startup, "p90FrameMs"));
    collectNumber(p95FrameMs, readNumber(startup, "p95FrameMs"));
    collectNumber(p99FrameMs, readNumber(startup, "p99FrameMs"));
  }

  return {
    samples,
    summary: {
      appFirstFrameToInteractiveMs: summarizeNumbers(appFirstFrameToInteractiveMs),
      appRuntimeToFirstFrameMs: summarizeNumbers(appRuntimeToFirstFrameMs),
      appStartToFirstFrameMs: summarizeNumbers(appStartToFirstFrameMs),
      appStartToFirstInteractiveMs: summarizeNumbers(appStartToFirstInteractiveMs),
      deadlineMissCount: summarizeNumbers(deadlineMissCount),
      frameCount: summarizeNumbers(frameCount),
      launchThisTimeMs: summarizeNumbers(launchThisTimeMs),
      launchTotalTimeMs: summarizeNumbers(launchTotalTimeMs),
      launchWaitTimeMs: summarizeNumbers(launchWaitTimeMs),
      maxFrameMs: summarizeNumbers(maxFrameMs),
      p50FrameMs: summarizeNumbers(p50FrameMs),
      p90FrameMs: summarizeNumbers(p90FrameMs),
      p95FrameMs: summarizeNumbers(p95FrameMs),
      p99FrameMs: summarizeNumbers(p99FrameMs),
      sampleCount: samples.length,
    },
  };
}

function collectNumber(list: number[], value: number | null): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    list.push(value);
  }
}

function runLayoutSuite(options: Options): { samples: LayoutSample[]; summary: LayoutSummary } {
  const rawPath = options.output.replace(/\.json$/u, ".layout.raw.jsonl");
  const samples: LayoutSample[] = [];
  logStatus(
    `[layout] branch=${options.branch} iterations=${options.iterations} warmupMs=${options.layoutWarmupMs} measureMs=${options.layoutMeasureMs}`,
  );

  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    logStatus(`[layout] ${iteration}/${options.iterations} launching AppHub`);
    const sampleId = `${options.branch}-layout-${iteration}`;
    const benchmarkScenario = "layout-apphub";
    forceStop(options.packageName);
    removeInternalStartupDump(options.packageName, options.layoutDumpFile);
    removeExternalStartupDump(options.packageName, options.layoutDumpFile);
    clearLogcat();
    const startedAtEpochMs = Date.now();
    startActivity(options, benchmarkScenario, [
      "--es",
      "ZYNTH_LAYOUT_METRICS_DUMP_FILE",
      options.layoutDumpFile,
      "--el",
      "ZYNTH_LAYOUT_METRICS_WARMUP_MS",
      `${options.layoutWarmupMs}`,
      "--el",
      "ZYNTH_LAYOUT_METRICS_MEASURE_MS",
      `${options.layoutMeasureMs}`,
    ]);
    const payload = waitForLayoutPayload(
      options,
      options.layoutWarmupMs + options.layoutMeasureMs + 3_000,
      benchmarkScenario,
      startedAtEpochMs,
    );
    forceStop(options.packageName);
    const parsed = parseLayoutPayload(payload);
    const sample: LayoutSample = {
      avgYogaMeasureMs: parsed.avgYogaMeasureMs,
      branch: options.branch,
      budgetOverruns: parsed.budgetOverruns,
      iteration,
      lastYogaCalcMs: parsed.lastYogaCalcMs,
      lastYogaMeasureMs: parsed.lastYogaMeasureMs,
      lastYogaMs: parsed.lastYogaMs,
      maxYogaMeasureMs: parsed.maxYogaMeasureMs,
      minYogaMeasureMs: parsed.minYogaMeasureMs,
      p50YogaMeasureMs: parsed.p50YogaMeasureMs,
      p90YogaMeasureMs: parsed.p90YogaMeasureMs,
      p95YogaMeasureMs: parsed.p95YogaMeasureMs,
      p99YogaMeasureMs: parsed.p99YogaMeasureMs,
      sampleId,
      totalPasses: parsed.totalPasses,
      yogaMeasureSampleCount: parsed.yogaMeasureSampleCount,
    };
    samples.push(sample);
    appendJsonLine(rawPath, sample);
    logStatus(
      `[layout] ${iteration}/${options.iterations} passes=${parsed.totalPasses} avgMeasure=${formatMetric(parsed.avgYogaMeasureMs)}ms p95Measure=${formatMetric(parsed.p95YogaMeasureMs)}ms lastMeasure=${formatMetric(parsed.lastYogaMeasureMs)}ms overruns=${parsed.budgetOverruns}`,
    );
  }

  return {
    samples,
    summary: {
      avgYogaMeasureMs: summarizeNumbers(selectNumbers(samples.map((entry) => entry.avgYogaMeasureMs))),
      budgetOverruns: summarizeNumbers(samples.map((entry) => entry.budgetOverruns)),
      lastYogaCalcMs: summarizeNumbers(selectNumbers(samples.map((entry) => entry.lastYogaCalcMs))),
      lastYogaMeasureMs: summarizeNumbers(selectNumbers(samples.map((entry) => entry.lastYogaMeasureMs))),
      lastYogaMs: summarizeNumbers(selectNumbers(samples.map((entry) => entry.lastYogaMs))),
      maxYogaMeasureMs: summarizeNumbers(selectNumbers(samples.map((entry) => entry.maxYogaMeasureMs))),
      minYogaMeasureMs: summarizeNumbers(selectNumbers(samples.map((entry) => entry.minYogaMeasureMs))),
      p50YogaMeasureMs: summarizeNumbers(selectNumbers(samples.map((entry) => entry.p50YogaMeasureMs))),
      p90YogaMeasureMs: summarizeNumbers(selectNumbers(samples.map((entry) => entry.p90YogaMeasureMs))),
      p95YogaMeasureMs: summarizeNumbers(selectNumbers(samples.map((entry) => entry.p95YogaMeasureMs))),
      p99YogaMeasureMs: summarizeNumbers(selectNumbers(samples.map((entry) => entry.p99YogaMeasureMs))),
      sampleCount: samples.length,
      totalPasses: summarizeNumbers(samples.map((entry) => entry.totalPasses)),
      yogaMeasureSampleCount: summarizeNumbers(samples.map((entry) => entry.yogaMeasureSampleCount)),
    },
  };
}

function selectNumbers(values: readonly (number | null)[]): number[] {
  const selected: number[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (typeof value === "number" && Number.isFinite(value)) {
      selected.push(value);
    }
  }
  return selected;
}

function parseFrameStats(raw: string): {
  deadlineMissCount: number;
  frameCount: number;
  maxFrameMs: number | null;
  p50FrameMs: number | null;
  p90FrameMs: number | null;
  p95FrameMs: number | null;
  p99FrameMs: number | null;
} {
  const lines = raw.split(/\r?\n/u);
  let headerIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.includes("IntendedVsync") && lines[index]?.includes("FrameCompleted")) {
      headerIndex = index;
      break;
    }
  }
  if (headerIndex === -1) {
    throw new Error("Unable to locate gfxinfo framestats header");
  }

  const headers = (lines[headerIndex] ?? "").split(",");
  const flagsIndex = headers.indexOf("Flags");
  const intendedVsyncIndex = headers.indexOf("IntendedVsync");
  const frameCompletedIndex = headers.indexOf("FrameCompleted");
  const frameDeadlineIndex = headers.indexOf("FrameDeadline");

  if (intendedVsyncIndex === -1 || frameCompletedIndex === -1) {
    throw new Error("framestats is missing required columns");
  }

  const frameDurations: number[] = [];
  let deadlineMissCount = 0;

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line || !line.includes(",")) {
      continue;
    }
    const columns = line.split(",");
    if (columns.length <= frameCompletedIndex) {
      continue;
    }
    if (flagsIndex !== -1 && columns[flagsIndex] !== "0") {
      continue;
    }
    const intendedVsync = Number(columns[intendedVsyncIndex]);
    const frameCompleted = Number(columns[frameCompletedIndex]);
    if (!Number.isFinite(intendedVsync) || !Number.isFinite(frameCompleted)) {
      continue;
    }
    const durationMs = Math.max(0, (frameCompleted - intendedVsync) / 1_000_000);
    frameDurations.push(durationMs);
    if (frameDeadlineIndex !== -1) {
      const frameDeadline = Number(columns[frameDeadlineIndex]);
      if (Number.isFinite(frameDeadline) && frameCompleted > frameDeadline) {
        deadlineMissCount += 1;
      }
    }
  }

  const sorted = [...frameDurations].sort((left, right) => left - right);
  return {
    deadlineMissCount,
    frameCount: sorted.length,
    maxFrameMs: sorted.length > 0 ? sorted[sorted.length - 1] ?? null : null,
    p50FrameMs: percentile(sorted, 0.5),
    p90FrameMs: percentile(sorted, 0.9),
    p95FrameMs: percentile(sorted, 0.95),
    p99FrameMs: percentile(sorted, 0.99),
  };
}

function formatTableNumber(value: number | null, digits = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(digits);
}

function padCell(value: string, width: number): string {
  if (value.length >= width) {
    return value;
  }
  return `${value}${" ".repeat(width - value.length)}`;
}

function renderTable(headers: readonly string[], rows: readonly string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const separator = widths.map((width) => "-".repeat(width)).join("  ");
  return [
    headers.map((header, index) => padCell(header, widths[index] ?? header.length)).join("  "),
    separator,
    ...rows.map((row) =>
      row.map((cell, index) => padCell(cell, widths[index] ?? cell.length)).join("  "),
    ),
  ].join("\n");
}

function printArtifactSummary(artifact: Artifact): void {
  const rows: string[][] = [];
  const startupSummary = artifact.suites.startup?.summary;
  const layoutSummary = artifact.suites.layout?.summary;

  if (startupSummary) {
    rows.push([
      "startup",
      `${startupSummary.sampleCount}`,
      formatTableNumber(startupSummary.launchTotalTimeMs.avg),
      formatTableNumber(startupSummary.frameCount.avg),
      formatTableNumber(startupSummary.deadlineMissCount.avg),
      formatTableNumber(startupSummary.p95FrameMs.avg),
      formatTableNumber(startupSummary.p99FrameMs.avg),
      formatTableNumber(startupSummary.maxFrameMs.avg),
    ]);
  }

  if (layoutSummary) {
    rows.push([
      "layout",
      `${layoutSummary.sampleCount}`,
      formatTableNumber(layoutSummary.avgYogaMeasureMs.avg),
      formatTableNumber(layoutSummary.totalPasses.avg),
      formatTableNumber(layoutSummary.budgetOverruns.avg),
      formatTableNumber(layoutSummary.p95YogaMeasureMs.avg),
      formatTableNumber(layoutSummary.p99YogaMeasureMs.avg),
      formatTableNumber(layoutSummary.maxYogaMeasureMs.avg),
    ]);
  }

  if (rows.length === 0) {
    return;
  }

  logStatus("[summary]");
  process.stdout.write(
    `${renderTable(
      [
        "suite",
        "samples",
        "avgPrimaryMs",
        "avgCount",
        "avgOverruns",
        "avgP95Ms",
        "avgP99Ms",
        "avgMaxMs",
      ],
      rows,
    )}\n`,
  );
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  ensureParentDirectory(options.output);
  prepareBenchmarkApp(options);
  ensureAppInstalled(options);
  logStatus(
    `[benchmark] package=${options.packageName} activity=${options.activity} variant=${options.buildVariant} output=${options.output}`,
  );

  const artifact: Artifact = {
    activity: options.activity,
    branch: options.branch,
    generatedAt: new Date().toISOString(),
    iterations: options.iterations,
    packageName: options.packageName,
    schemaVersion: 1,
    suites: {},
  };

  if (options.suites.includes("startup")) {
    artifact.suites.startup = runStartupSuite(options);
  }
  if (options.suites.includes("layout")) {
    artifact.suites.layout = runLayoutSuite(options);
  }

  writeFileSync(options.output, JSON.stringify(artifact, null, 2), "utf8");
  printArtifactSummary(artifact);
  logStatus(`[benchmark] wrote artifact ${options.output}`);
  process.stdout.write(`${options.output}\n`);
}

main();
