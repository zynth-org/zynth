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

export interface ImagePickerAPI {
  getCameraPermissionsAsync: () => Promise<PermissionResponse>;
  requestCameraPermissionsAsync: () => Promise<PermissionResponse>;
  launchCameraAsync: (options?: ImagePickerOptions) => Promise<ImagePickerResult>;
  launchImageLibraryAsync: (options?: ImagePickerOptions) => Promise<ImagePickerResult>;
}
