import fs from "node:fs/promises";
import path from "node:path";
import type {
  ZynthBuildFeature,
  ZynthBuildFeatureContext,
  ZynthGeneratedModuleFeature,
} from "./types.js";

const DEFAULT_FEATURES_OUTPUT_DIR = ".zynth/features";

export function isGeneratedModuleFeature(
  feature: ZynthBuildFeature,
): feature is ZynthGeneratedModuleFeature {
  return feature.kind === "generated-module";
}

export function resolveFeatureOutputFile(
  feature: ZynthGeneratedModuleFeature,
  appRoot: string,
): string {
  if (feature.outputPath) {
    return path.isAbsolute(feature.outputPath)
      ? feature.outputPath
      : path.join(appRoot, feature.outputPath);
  }

  const sanitizedModuleId = feature.moduleId
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_");
  return path.join(
    appRoot,
    DEFAULT_FEATURES_OUTPUT_DIR,
    `${sanitizedModuleId}.generated.ts`,
  );
}

export async function writeGeneratedModuleFile(
  filePath: string,
  source: string,
) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source, "utf8");
}

export function registerGeneratedModule(
  aliases: Record<string, string>,
  replacements: Array<{ request: string; target: string }>,
  moduleId: string,
  outputFile: string,
) {
  aliases[moduleId] = outputFile;
  aliases[`${moduleId}$`] = outputFile;
  replacements.push({ request: moduleId, target: outputFile });
}

export function resolveFeaturePlatform(
  isWeb: boolean,
): ZynthBuildFeatureContext["platform"] {
  if (isWeb) {
    return "web";
  }
  const fromEnv = process.env?.ZYNTH_PLATFORM;
  if (fromEnv === "android") {
    return "android";
  }
  return "ios";
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
