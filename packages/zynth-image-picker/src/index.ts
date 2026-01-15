import { sharedNativeEventEmitter } from "@zynth/core";

type ModulesBridge = {
  call?(
    name: string,
    method: string,
    args?: unknown
  ): Promise<unknown> | unknown;
};

function getGlobalObject(): Record<string, unknown> {
  if (typeof globalThis !== "undefined") {
    return globalThis as any;
  }
  try {
    const fallback = Function("return this")();
    if (fallback && typeof fallback === "object") {
      return fallback as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

function getModulesBridge(): ModulesBridge | null {
  const globalObj = getGlobalObject();
  const maybeBridge = globalObj.__modules;
  if (!maybeBridge || typeof maybeBridge !== "object") {
    return null;
  }
  return maybeBridge as ModulesBridge;
}

export interface ImagePickerOptions {
  // Placeholder for future options
}

export interface ImagePickerResult {
  cancelled: boolean;
  uri?: string;
  error?: string;
}

export interface PermissionResponse {
  status: "granted" | "denied" | "undetermined";
  granted: boolean;
  canAskAgain: boolean;
}

export const ImagePicker = {
  getCameraPermissionsAsync: async (): Promise<PermissionResponse> => {
    const bridge = getModulesBridge();
    if (!bridge || !bridge.call)
      return { status: "undetermined", granted: false, canAskAgain: true };
    return (await bridge.call(
      "ImagePicker",
      "getCameraPermissionsAsync"
    )) as PermissionResponse;
  },

  requestCameraPermissionsAsync: async (): Promise<PermissionResponse> => {
    const bridge = getModulesBridge();
    if (!bridge || !bridge.call)
      return { status: "undetermined", granted: false, canAskAgain: true };

    const requestId = Math.random().toString(36).substring(7);

    return new Promise((resolve, reject) => {
      const subscription = sharedNativeEventEmitter.addListener(
        "ImagePicker.result",
        (payload: any) => {
          if (payload && payload.requestId === requestId) {
            subscription.remove();
            resolve({
              status: payload.status,
              granted: !!payload.granted,
              canAskAgain: !!payload.canAskAgain,
            });
          }
        }
      );

      try {
        if (!bridge || !bridge.call) {
          return false;
        }
        bridge.call("ImagePicker", "requestCameraPermissionsAsync", {
          requestId,
        });
      } catch (e) {
        subscription.remove();
        reject(e);
      }
    });
  },

  launchCameraAsync: async (
    options?: ImagePickerOptions
  ): Promise<ImagePickerResult> => {
    const bridge = getModulesBridge();
    if (!bridge || !bridge.call) {
      console.warn(
        "[Zynth] Native modules bridge not available. ImagePicker skipped."
      );
      return { cancelled: true, error: "Bridge not available" };
    }

    const requestId = Math.random().toString(36).substring(7);

    return new Promise((resolve, reject) => {
      // Set up listener before calling native to avoid race conditions
      console.log(
        `[ImagePicker] Listening for result with requestId: ${requestId}`
      );
      const subscription = sharedNativeEventEmitter.addListener(
        "ImagePicker.result",
        (payload: any) => {
          console.log(`[ImagePicker] Received event:`, JSON.stringify(payload));
          if (payload && payload.requestId === requestId) {
            console.log(
              `[ImagePicker] Match found for requestId: ${requestId}`
            );
            subscription.remove();

            if (payload.error) {
              if (payload.cancelled) {
                resolve({ cancelled: true });
              } else {
                reject(new Error(payload.error));
              }
            } else {
              resolve({
                cancelled: !!payload.cancelled,
                uri: payload.uri,
              });
            }
          } else {
            console.log(
              `[ImagePicker] Ignored event (requestId mismatch):`,
              payload?.requestId
            );
          }
        }
      );

      try {
        console.log(`[ImagePicker] Calling native launchCameraAsync...`);
        if (!bridge || !bridge.call) {
          return false;
        }
        bridge.call("ImagePicker", "launchCameraAsync", {
          options: options || {},
          requestId,
        });
      } catch (e) {
        console.error(`[ImagePicker] Native call failed:`, e);
        subscription.remove();
        reject(e);
      }
    });
  },

  launchImageLibraryAsync: async (
    options?: ImagePickerOptions
  ): Promise<ImagePickerResult> => {
    const bridge = getModulesBridge();
    if (!bridge || !bridge.call) {
      console.warn(
        "[Zynth] Native modules bridge not available. ImagePicker skipped."
      );
      return { cancelled: true, error: "Bridge not available" };
    }

    const requestId = Math.random().toString(36).substring(7);

    return new Promise((resolve, reject) => {
      console.log(
        `[ImagePicker] Listening for library result with requestId: ${requestId}`
      );
      const subscription = sharedNativeEventEmitter.addListener(
        "ImagePicker.result",
        (payload: any) => {
          console.log(`[ImagePicker] Received event:`, JSON.stringify(payload));
          if (payload && payload.requestId === requestId) {
            subscription.remove();

            if (payload.error) {
              if (payload.cancelled) {
                resolve({ cancelled: true });
              } else {
                reject(new Error(payload.error));
              }
            } else {
              resolve({
                cancelled: !!payload.cancelled,
                uri: payload.uri,
              });
            }
          }
        }
      );

      try {
        console.log(`[ImagePicker] Calling native launchImageLibraryAsync...`);
        if (!bridge || !bridge.call) {
          return false;
        }
        bridge.call("ImagePicker", "launchImageLibraryAsync", {
          options: options || {},
          requestId,
        });
      } catch (e) {
        console.error(`[ImagePicker] Native call failed:`, e);
        subscription.remove();
        reject(e);
      }
    });
  },
};
