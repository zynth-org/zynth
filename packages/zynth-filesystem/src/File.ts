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
import type {
  ChecksumAlgorithm,
  DownloadOptions,
  FileCreateOptions,
  FileInfo,
  InfoOptions,
  PathLike,
  UploadChecksumOptions,
  UploadOptions,
  UploadProgress,
  UploadStreamOptions,
} from "./types";
import { Directory } from "./Directory";

type ExtendedFetchRequestInit = RequestInit & {
  timeout?: number;
  onUploadProgress?: (progress: UploadProgress) => void;
  tls?: {
    trustedCertificatesPem?: string | readonly string[];
  };
};

const DEFAULT_UPLOAD_CHUNK_SIZE = 64 * 1024;
const MIN_UPLOAD_CHUNK_SIZE = 1024;
const MAX_UPLOAD_CHUNK_SIZE = 1024 * 1024;

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

  async checksumAsync(algorithm: ChecksumAlgorithm = "md5"): Promise<string> {
    return callNative<string>("checksum", { uri: this._uri, algorithm });
  }

  checksumSync(algorithm: ChecksumAlgorithm = "md5"): string {
    return callNativeSync<string>("checksum", { uri: this._uri, algorithm });
  }

  uploadStream(options?: UploadStreamOptions): ReadableStream<Uint8Array> {
    if (typeof ReadableStream === "undefined") {
      throw new Error("ReadableStream is not available in this runtime.");
    }

    const chunkSize = clampChunkSize(options?.chunkSize);
    const startOffset = Math.max(0, Math.floor(options?.startOffset ?? 0));
    const requestedEnd = options?.endOffset;
    const endOffset =
      requestedEnd != null ? Math.max(startOffset, Math.floor(requestedEnd)) : null;
    let offset = startOffset;
    let closed = false;

    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        if (closed) {
          controller.close();
          return;
        }
        if (endOffset != null && offset >= endOffset) {
          closed = true;
          controller.close();
          return;
        }

        const length =
          endOffset == null ? chunkSize : Math.min(chunkSize, endOffset - offset);
        if (length <= 0) {
          closed = true;
          controller.close();
          return;
        }

        try {
          const base64 = await callNative<string>("readBase64Chunk", {
            uri: this._uri,
            offset,
            length,
          });
          if (!base64) {
            closed = true;
            controller.close();
            return;
          }
          const chunk = base64ToBytes(base64);
          if (chunk.byteLength === 0) {
            closed = true;
            controller.close();
            return;
          }
          offset += chunk.byteLength;
          controller.enqueue(chunk);
        } catch (error) {
          closed = true;
          controller.error(error);
        }
      },
    });
  }

  async uploadAsync(url: string, options?: UploadOptions): Promise<Response> {
    if (typeof fetch !== "function") {
      throw new Error("fetch is not available in this runtime.");
    }

    const method = options?.method ?? "POST";
    const headers = normalizeHeaders(options?.headers);
    const chunkSize = options?.chunkSize;
    const contentType = options?.contentType ?? this.type;
    if (!headers.has("content-type") && contentType) {
      headers.set("content-type", contentType);
    }

    if (!headers.has("content-length") && this.exists) {
      headers.set("content-length", `${this.size}`);
    }

    if (options?.checksum) {
      const checksum = await resolveChecksumOption(this, options.checksum);
      const headerName = checksum.headerName;
      const headerValue = checksum.includeAlgorithmPrefix
        ? `${checksum.algorithm}:${checksum.value}`
        : checksum.value;
      if (!headers.has(headerName)) {
        headers.set(headerName, headerValue);
      }
    }

    const init: ExtendedFetchRequestInit = {
      method,
      headers: headersToRecord(headers),
      body: this.uploadStream({ chunkSize }),
      signal: options?.signal,
      timeout: options?.timeout,
      onUploadProgress: options?.onUploadProgress,
      tls: normalizeUploadTlsOptions(options?.tls),
    };

    return fetch(url, init);
  }

  readableStream(): ReadableStream<Uint8Array> {
    return this.uploadStream();
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

}

function normalizeUploadTlsOptions(
  tls:
    | {
        trustedCertificatesPem?: string | readonly string[];
      }
    | undefined
): { trustedCertificatesPem?: string | readonly string[] } | undefined {
  if (!tls) {
    return undefined;
  }
  const trustedCertificatesPem = normalizeTrustedCertificatesPem(
    tls.trustedCertificatesPem
  );
  if (!trustedCertificatesPem) {
    return undefined;
  }
  return { trustedCertificatesPem };
}

function normalizeTrustedCertificatesPem(
  value: string | readonly string[] | undefined
): string | readonly string[] | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  if (normalized.length === 0) {
    return undefined;
  }
  return normalized;
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

function clampChunkSize(value: number | undefined): number {
  if (value == null || Number.isNaN(value)) {
    return DEFAULT_UPLOAD_CHUNK_SIZE;
  }
  const parsed = Math.floor(value);
  if (parsed < MIN_UPLOAD_CHUNK_SIZE) {
    return MIN_UPLOAD_CHUNK_SIZE;
  }
  if (parsed > MAX_UPLOAD_CHUNK_SIZE) {
    return MAX_UPLOAD_CHUNK_SIZE;
  }
  return parsed;
}

function normalizeHeaders(
  headers?: Record<string, string> | Headers
): Headers {
  return headers instanceof Headers ? new Headers(headers) : new Headers(headers ?? {});
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

async function resolveChecksumOption(
  file: File,
  option: UploadChecksumOptions
): Promise<{
  algorithm: ChecksumAlgorithm;
  value: string;
  headerName: string;
  includeAlgorithmPrefix: boolean;
}> {
  if (typeof option === "string") {
    return {
      algorithm: option,
      value: await file.checksumAsync(option),
      headerName: "x-zynth-checksum",
      includeAlgorithmPrefix: true,
    };
  }

  const algorithm = option.algorithm ?? "sha256";
  return {
    algorithm,
    value: await file.checksumAsync(algorithm),
    headerName: option.headerName ?? "x-zynth-checksum",
    includeAlgorithmPrefix: option.includeAlgorithmPrefix ?? true,
  };
}
