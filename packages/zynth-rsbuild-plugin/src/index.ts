/// <reference path="./env.d.ts" />
import type { RsbuildConfig } from "@rsbuild/core";
import { getWebConfig } from "./config-web.js";
import { getNativeConfig } from "./config-native.js";
import type { DefineZynthConfigOptions } from "./types.js";

export * from "./types.js";

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
