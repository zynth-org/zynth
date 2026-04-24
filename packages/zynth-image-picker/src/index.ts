import { callNative, sharedNativeEventEmitter } from "@zynthjs/core";

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

const MODULE_NAME = "ImagePicker";

export const ImagePicker = {
  getCameraPermissionsAsync: async (): Promise<PermissionResponse> => {
    try {
      return await callNative<PermissionResponse>(
        MODULE_NAME,
        "getCameraPermissionsAsync"
      );
    } catch (e) {
      return { status: "undetermined", granted: false, canAskAgain: true };
    }
  },

  requestCameraPermissionsAsync: async (): Promise<PermissionResponse> => {
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

      void callNative(MODULE_NAME, "requestCameraPermissionsAsync", {
        requestId,
      }).catch((e) => {
        subscription.remove();
        reject(e);
      });
    });
  },

  launchCameraAsync: async (
    options?: ImagePickerOptions
  ): Promise<ImagePickerResult> => {
    const requestId = Math.random().toString(36).substring(7);

    return new Promise((resolve, reject) => {
      const subscription = sharedNativeEventEmitter.addListener(
        "ImagePicker.result",
        (payload: any) => {
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

      void callNative(MODULE_NAME, "launchCameraAsync", {
        options: options || {},
        requestId,
      }).catch((e) => {
        subscription.remove();
        reject(e);
      });
    });
  },

  launchImageLibraryAsync: async (
    options?: ImagePickerOptions
  ): Promise<ImagePickerResult> => {
    const requestId = Math.random().toString(36).substring(7);

    return new Promise((resolve, reject) => {
      const subscription = sharedNativeEventEmitter.addListener(
        "ImagePicker.result",
        (payload: any) => {
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

      void callNative(MODULE_NAME, "launchImageLibraryAsync", {
        options: options || {},
        requestId,
      }).catch((e) => {
        subscription.remove();
        reject(e);
      });
    });
  },
};
