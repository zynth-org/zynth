export type PathLike = string | { uri: string };

export type PathInfo = {
  exists: boolean;
  isDirectory: boolean | null;
};

export type InfoOptions = {
  md5?: boolean;
};

export type FileInfo = {
  uri: string;
  exists: boolean;
  size: number;
  creationTime: number | null;
  modificationTime: number | null;
  md5?: string | null;
  type: string;
};

export type DirectoryInfo = {
  uri: string;
  exists: boolean;
  size: number | null;
  creationTime: number | null;
  modificationTime: number | null;
  files?: string[];
};

export type DirectoryEntryInfo = {
  name: string;
  uri: string;
  isDirectory: boolean;
};

export type FileCreateOptions = {
  intermediates?: boolean;
  overwrite?: boolean;
};

export type DirectoryCreateOptions = {
  intermediates?: boolean;
  overwrite?: boolean;
  idempotent?: boolean;
};

export type DownloadOptions = {
  headers?: Record<string, string>;
  idempotent?: boolean;
};

export type FileSignalOptions<T> = {
  initialValue: T;
  read?: () => Promise<T>;
  write?: (nextValue: T) => Promise<void>;
};

export type FileSignal<T> = {
  value: () => T;
  loading: () => boolean;
  error: () => Error | null;
  refresh: () => Promise<void>;
  setValue: (nextValue: T) => Promise<void>;
  remove: () => Promise<void>;
};

export type DirectorySignalOptions<T> = {
  initialValue?: T[];
  read?: () => Promise<T[]>;
};

export type DirectorySignal<T> = {
  entries: () => T[];
  loading: () => boolean;
  error: () => Error | null;
  refresh: () => Promise<void>;
};
