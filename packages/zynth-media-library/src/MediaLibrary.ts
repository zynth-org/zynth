import { callNative, isNativeAvailable } from "./native";
import type {
  MediaLibraryPermissionResponse,
  RequestPermissionsOptions,
  SaveMediaOptions,
  SaveMediaResult,
} from "./types";

function assertUri(uri: string): void {
  if (typeof uri !== "string" || uri.trim().length === 0) {
    throw new Error("[MediaLibrary] options.uri must be a non-empty string");
  }
  const trimmed = uri.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    throw new Error("[MediaLibrary] options.uri must reference a local file URI/path");
  }
}

export const MediaLibrary = {
  isAvailable(): boolean {
    return isNativeAvailable();
  },

  async getPermissionsAsync(
    options: RequestPermissionsOptions = {}
  ): Promise<MediaLibraryPermissionResponse> {
    return callNative("getPermissionsAsync", {
      writeOnly: options.writeOnly === true,
    });
  },

  async requestPermissionsAsync(
    options: RequestPermissionsOptions = {}
  ): Promise<MediaLibraryPermissionResponse> {
    return callNative("requestPermissionsAsync", {
      writeOnly: options.writeOnly !== false,
    });
  },

  async saveImageAsync(options: SaveMediaOptions): Promise<SaveMediaResult> {
    assertUri(options.uri);
    return callNative("saveImageAsync", {
      uri: options.uri.trim(),
      album: options.album ?? undefined,
    });
  },

  async saveVideoAsync(options: SaveMediaOptions): Promise<SaveMediaResult> {
    assertUri(options.uri);
    return callNative("saveVideoAsync", {
      uri: options.uri.trim(),
      album: options.album ?? undefined,
    });
  },
};
