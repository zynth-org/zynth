export type DocumentPickerAsset = {
  uri: string;
  name: string | null;
  mimeType: string | null;
  size: number | null;
};

export type DocumentPickerOptions = {
  multiple?: boolean;
  type?: string | string[];
  copyToCacheDirectory?: boolean;
};

export type DocumentPickerResult = {
  cancelled: boolean;
  assets: DocumentPickerAsset[];
};
