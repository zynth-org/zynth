import {
  callNative,
  callNativeSync,
  getNativeModule,
  unwrapNativeResult
} from "@zynth/core";

const MODULE_NAME = "Skia";

export const Skia = {
  async exampleMethod() {
    const result = await callNative(MODULE_NAME, "exampleMethod");
    return unwrapNativeResult(result);
  },

  exampleSyncMethod() {
    const result = callNativeSync(MODULE_NAME, "exampleSyncMethod");
    return unwrapNativeResult(result);
  }
};