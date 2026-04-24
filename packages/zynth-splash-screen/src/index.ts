import { callNative, callNativeSync } from "@zynthjs/core";

async function callBridge(
  method: "preventAutoHide" | "hide"
): Promise<boolean> {
  try {
    if (method === "preventAutoHide") {
      try {
        callNativeSync("ZynthSplashScreen", method, {});
        return true;
      } catch (error) {
        console.warn(
          "[ZynthSplashScreen] callSync preventAutoHide failed; falling back to async.",
          error
        );
      }
    }
    await callNative("ZynthSplashScreen", method, {});
    return true;
  } catch (error) {
    console.error(`[ZynthSplashScreen] Failed to ${method}():`, error);
    return false;
  }
}

export const SplashScreen = {
  preventAutoHideAsync(): Promise<boolean> {
    return callBridge("preventAutoHide");
  },
  hideAsync(): Promise<boolean> {
    return callBridge("hide");
  },
};
