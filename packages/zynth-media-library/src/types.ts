export type PermissionStatus = "granted" | "denied" | "undetermined";

export type MediaLibraryPermissionResponse = {
  status: PermissionStatus;
  granted: boolean;
  canAskAgain: boolean;
};

export type RequestPermissionsOptions = {
  writeOnly?: boolean;
};

export type SaveMediaOptions = {
  uri: string;
  album?: string;
};

export type SaveMediaResult = {
  uri: string;
};
