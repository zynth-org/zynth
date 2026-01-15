import { callNative, callNativeSync } from "./native";
import {
  basename,
  dirname,
  extname,
  joinPaths,
  normalizeFileUri,
  pathLikeToString,
} from "./pathUtils";
import { base64ToBytes, bytesToBase64, concatBytes } from "./encoding";
import type { DownloadOptions, FileCreateOptions, FileInfo, InfoOptions, PathLike } from "./types";
import { Directory } from "./Directory";

export class File {
  private _uri: string;

  constructor(...segments: PathLike[]) {
    if (!segments.length) {
      throw new Error("File requires at least one path segment");
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

  get extension(): string {
    return extname(this._uri);
  }

  get parentDirectory(): Directory {
    return new Directory(dirname(this._uri));
  }

  get exists(): boolean {
    return this.infoSync().exists;
  }

  get size(): number {
    const info = this.infoSync();
    return info.exists ? info.size : 0;
  }

  get creationTime(): number | null {
    const info = this.infoSync();
    return info.exists ? info.creationTime : null;
  }

  get modificationTime(): number | null {
    const info = this.infoSync();
    return info.exists ? info.modificationTime : null;
  }

  get md5(): string | null {
    const info = this.infoSync({ md5: true });
    return info.md5 ?? null;
  }

  get type(): string {
    const info = this.infoSync();
    return info.exists ? info.type : "";
  }

  async info(options?: InfoOptions): Promise<FileInfo> {
    return callNative<FileInfo>("getInfo", { uri: this._uri, options });
  }

  infoSync(options?: InfoOptions): FileInfo {
    return callNativeSync<FileInfo>("getInfo", { uri: this._uri, options });
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const bytes = await this.bytes();
    return bytes.slice().buffer;
  }

  async base64(): Promise<string> {
    return callNative<string>("readBase64", { uri: this._uri });
  }

  base64Sync(): string {
    return callNativeSync<string>("readBase64", { uri: this._uri });
  }

  async bytes(): Promise<Uint8Array> {
    const encoded = await this.base64();
    return base64ToBytes(encoded);
  }

  bytesSync(): Uint8Array {
    return base64ToBytes(this.base64Sync());
  }

  async text(): Promise<string> {
    return callNative<string>("readText", { uri: this._uri });
  }

  textSync(): string {
    return callNativeSync<string>("readText", { uri: this._uri });
  }

  readableStream(): ReadableStream<Uint8Array> {
    if (typeof ReadableStream === "undefined") {
      throw new Error("ReadableStream is not available in this runtime.");
    }
    return new ReadableStream<Uint8Array>({
      start: async (controller) => {
        try {
          const bytes = await this.bytes();
          controller.enqueue(bytes);
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });
  }

  stream(): ReadableStream<Uint8Array> {
    return this.readableStream();
  }

  writableStream(): WritableStream<Uint8Array> {
    if (typeof WritableStream === "undefined") {
      throw new Error("WritableStream is not available in this runtime.");
    }
    const chunks: Uint8Array[] = [];
    return new WritableStream<Uint8Array>({
      write: async (chunk) => {
        chunks.push(chunk);
      },
      close: async () => {
        const data = concatBytes(chunks);
        await this.write(data);
      },
    });
  }

  slice(start?: number, end?: number, contentType?: string): Blob {
    if (typeof Blob === "undefined") {
      throw new Error("Blob is not available in this runtime.");
    }
    const bytes = this.bytesSync();
    const sliceStart = start ?? 0;
    const sliceEnd = end ?? bytes.length;
    const sliced = bytes.slice(sliceStart, sliceEnd);
    return new Blob([sliced], { type: contentType ?? this.type });
  }

  async write(content: string | Uint8Array): Promise<void> {
    if (typeof content === "string") {
      await callNative<void>("writeText", { uri: this._uri, text: content });
      return;
    }
    const base64 = bytesToBase64(content);
    await callNative<void>("writeBase64", { uri: this._uri, data: base64 });
  }

  create(options?: FileCreateOptions): Promise<void> {
    return callNative<void>("createFile", { uri: this._uri, options });
  }

  delete(): Promise<void> {
    return callNative<void>("delete", { uri: this._uri, recursive: false });
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

  open(): never {
    throw new Error("FileHandle is not available yet.");
  }

  static async downloadFileAsync(
    url: string,
    destination: Directory | File | string,
    options?: DownloadOptions
  ): Promise<File> {
    if (typeof fetch !== "function") {
      throw new Error("fetch is not available in this runtime.");
    }

    const response = await fetch(url, {
      headers: options?.headers,
    });
    if (!response.ok) {
      throw new Error(`Unable to download file (status ${response.status})`);
    }

    const filename = resolveDownloadFilename(url, response.headers);
    const target = destination instanceof Directory
      ? new File(destination.uri, filename)
      : destination instanceof File
        ? destination
        : new File(pathLikeToString(destination));

    if (!options?.idempotent && target.exists) {
      throw new Error("DestinationAlreadyExists");
    }

    const buffer = await response.arrayBuffer();
    await target.write(new Uint8Array(buffer));
    return target;
  }

  static async pickFileAsync(_initialUri?: string, _mimeType?: string): Promise<File> {
    throw new Error("File picker is not available yet.");
  }
}

function resolveDestinationUri(destination: Directory | File | string, name: string): string {
  if (destination instanceof Directory) {
    return normalizeFileUri(joinPaths(destination.uri, name));
  }
  if (destination instanceof File) {
    return normalizeFileUri(destination.uri);
  }
  return normalizeFileUri(pathLikeToString(destination));
}

function resolveDownloadFilename(url: string, headers: Headers): string {
  const disposition = headers.get("content-disposition") || "";
  const match = disposition.match(/filename\*?=(?:UTF-8''|\")?([^;\"]+)/i);
  if (match && match[1]) {
    return decodeURIComponent(match[1].replace(/\"/g, "")).trim();
  }
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const base = pathname.split("/").filter(Boolean).pop();
    if (base) return base;
  } catch {
    // ignore
  }
  const fallback = url.split("?")[0].split("/").filter(Boolean).pop();
  return fallback || "download";
}
