export type FileIntentFile = {
  uri: string;
  mimeType?: string | null;
  filename?: string | null;
};

export type OpenFileOptions = {
  uri: string;
  mimeType?: string | null;
  filename?: string | null;
};

export type ShareFilesOptions = {
  files?: FileIntentFile[];
  text?: string;
  subject?: string;
};

export type ExportTarget = "files" | "downloads";

export type ExportFileOptions = {
  uri: string;
  mimeType?: string | null;
  suggestedName?: string | null;
  target: ExportTarget;
};

export type ExportFileResult = {
  cancelled: boolean;
  destinationUri?: string;
};
