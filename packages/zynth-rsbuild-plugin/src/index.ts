import type { RsbuildConfig } from "@rsbuild/core";
import { getWebConfig } from "./config-web";
import { getNativeConfig } from "./config-native";
import type { DefineZynthConfigOptions } from "./types";

export * from "./types";

export function defineZynthConfig(
  userConfig: RsbuildConfig = {},
  options: DefineZynthConfigOptions = {}
) {
  const platform =
    options.platform || (process.env?.ZYNTH_PLATFORM as any) || "ios";
  const isWeb = platform === "web";

  if (isWeb) {
    return getWebConfig(userConfig, options);
  } else {
    return getNativeConfig(userConfig, options);
  }
}