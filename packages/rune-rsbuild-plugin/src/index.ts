import type { RsbuildConfig } from "@rsbuild/core";
import { getWebConfig } from "./config-web.js";
import { getNativeConfig } from "./config-native.js";
import type { DefineRuneConfigOptions } from "./types.js";

export * from "./types.js";

export function defineRuneConfig(
  userConfig: RsbuildConfig = {},
  options: DefineRuneConfigOptions = {}
) {
  const platform =
    options.platform || (process.env?.RUNE_PLATFORM as any) || "ios";
  const isWeb = platform === "web";

  if (isWeb) {
    return getWebConfig(userConfig, options);
  } else {
    return getNativeConfig(userConfig, options);
  }
}