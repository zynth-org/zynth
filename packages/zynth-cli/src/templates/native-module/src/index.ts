import {
  callNative,
  callNativeSync,
  getNativeModule,
  unwrapNativeResult
} from "@zynthjs/core";

const MODULE_NAME = "{{MODULE_NAME_PASCAL}}";

export const {{MODULE_NAME_PASCAL}} = {
  async exampleMethod() {
    const result = await callNative(MODULE_NAME, "exampleMethod");
    return unwrapNativeResult(result);
  },

  exampleSyncMethod() {
    const result = callNativeSync(MODULE_NAME, "exampleSyncMethod");
    return unwrapNativeResult(result);
  }
};