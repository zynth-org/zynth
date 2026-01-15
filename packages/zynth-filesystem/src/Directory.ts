import { callNative, callNativeSync } from "./native";
import {
  basename,
  dirname,
  joinPaths,
  normalizeFileUri,
  pathLikeToString,
} from "./pathUtils";
import type {
  DirectoryCreateOptions,
  DirectoryEntryInfo,
  DirectoryInfo,
  PathLike,
} from "./types";
import { File } from "./File";

export class Directory {
  private _uri: string;

  constructor(...segments: PathLike[]) {
    if (!segments.length) {
      throw new Error("Directory requires at least one path segment");
    }
    const joined = joinPaths(...segments);
    this._uri = normalizeFileUri(joined);
  }

  get uri(): string {
    return this._uri;
  }

  get name(): string {
    return basename(this._uri);
  }

  get parentDirectory(): Directory {
    return new Directory(dirname(this._uri));
  }

  get exists(): boolean {
    return this.infoSync().exists;
  }

  get size(): number | null {
    const info = this.infoSync();
    return info.exists ? info.size ?? null : null;
  }

  async info(): Promise<DirectoryInfo> {
    return callNative<DirectoryInfo>("getInfo", { uri: this._uri });
  }

  infoSync(): DirectoryInfo {
    return callNativeSync<DirectoryInfo>("getInfo", { uri: this._uri });
  }

  async list(): Promise<Array<File | Directory>> {
    const entries = await callNative<DirectoryEntryInfo[]>("listDirectory", {
      uri: this._uri,
    });
    return entries.map((entry) =>
      entry.isDirectory ? new Directory(entry.uri) : new File(entry.uri)
    );
  }

  create(options?: DirectoryCreateOptions): Promise<void> {
    return callNative<void>("createDirectory", { uri: this._uri, options });
  }

  createDirectory(name: string): Directory {
    return new Directory(this._uri, name);
  }

  createFile(name: string, _mimeType?: string | null): File {
    return new File(this._uri, name);
  }

  delete(): Promise<void> {
    return callNative<void>("delete", { uri: this._uri, recursive: true });
  }

  async copy(destination: Directory | File | string): Promise<void> {
    const targetUri = resolveDestinationUri(destination, this.name);
    await callNative<void>("copy", { from: this._uri, to: targetUri });
  }

  async move(destination: Directory | File | string): Promise<void> {
    const targetUri = resolveDestinationUri(destination, this.name);
    await callNative<void>("move", { from: this._uri, to: targetUri });
    this._uri = targetUri;
  }

  async rename(newName: string): Promise<void> {
    const parent = dirname(this._uri);
    const nextUri = normalizeFileUri(joinPaths(parent, newName));
    await callNative<void>("move", { from: this._uri, to: nextUri });
    this._uri = nextUri;
  }

  static async pickDirectoryAsync(_initialUri?: string): Promise<Directory> {
    throw new Error("Directory picker is not available yet.");
  }
}

function resolveDestinationUri(destination: Directory | File | string, name: string): string {
  if (destination instanceof Directory) {
    return normalizeFileUri(joinPaths(destination.uri, name));
  }
  if (destination instanceof File) {
    return normalizeFileUri(destination.uri);
  }
  const dest = pathLikeToString(destination);
  return normalizeFileUri(dest);
}
