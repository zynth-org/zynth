import type { ImagePickerAPI, ImagePickerOptions, ImagePickerResult, PermissionResponse } from "./types";

function createHiddenFileInput(capture?: string): Promise<ImagePickerResult> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    if (capture) {
      input.setAttribute("capture", capture);
    }
    input.style.display = "none";

    const handleChange = (e: Event) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (file) {
        const uri = URL.createObjectURL(file);
        resolve({ cancelled: false, uri });
      } else {
        resolve({ cancelled: true });
      }
      cleanup();
    };

    const handleCancel = () => {
      // Browsers don't consistently fire cancel events for file inputs.
      // We rely on focus changes as a heuristic in some complex implementations,
      // but for standard web compat, resolving on change is primary.
      // If we need a strict cancel detect, it involves tracking window focus.
      resolve({ cancelled: true });
      cleanup();
    };

    const cleanup = () => {
      input.removeEventListener("change", handleChange);
      input.removeEventListener("cancel", handleCancel);
      document.body.removeChild(input);
    };

    input.addEventListener("change", handleChange);
    input.addEventListener("cancel", handleCancel);

    document.body.appendChild(input);
    input.click();
  });
}

export const WebImagePicker: ImagePickerAPI = {
  getCameraPermissionsAsync: async (): Promise<PermissionResponse> => {
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const result = await navigator.permissions.query({ name: 'camera' as PermissionName });
        return {
          status: result.state === "prompt" ? "undetermined" : result.state,
          granted: result.state === "granted",
          canAskAgain: result.state !== "denied",
        };
      }
    } catch (e) {
      // Fallback if query fails
    }
    return { status: "undetermined", granted: false, canAskAgain: true };
  },

  requestCameraPermissionsAsync: async (): Promise<PermissionResponse> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      // Stop immediately since we just wanted to ask permission
      stream.getTracks().forEach((track) => track.stop());
      return {
        status: "granted",
        granted: true,
        canAskAgain: true,
      };
    } catch (e) {
      return {
        status: "denied",
        granted: false,
        canAskAgain: false,
      };
    }
  },

  launchCameraAsync: async (
    options?: ImagePickerOptions
  ): Promise<ImagePickerResult> => {
    if (typeof document === "undefined") {
      return { cancelled: true, error: "document is undefined" };
    }
    // Specifying "environment" prefers the back camera on mobile devices
    return createHiddenFileInput("environment");
  },

  launchImageLibraryAsync: async (
    options?: ImagePickerOptions
  ): Promise<ImagePickerResult> => {
    if (typeof document === "undefined") {
      return { cancelled: true, error: "document is undefined" };
    }
    return createHiddenFileInput();
  },
};
