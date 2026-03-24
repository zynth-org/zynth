import type { Headers } from "./Headers";
import type { AbortSignal } from "../AbortController";
import type { Blob } from "../Blob";
import type { FormData } from "../FormData";

export type ReadableStreamReaderResult<T> = {
  done: boolean;
  value?: T;
};

export type ReadableStreamReaderLike<T> = {
  read(): Promise<ReadableStreamReaderResult<T>>;
  releaseLock?(): void;
};

export type ReadableStreamLike<T> = {
  getReader(): ReadableStreamReaderLike<T>;
};

export type UploadProgress = {
  requestId: number;
  bytesSent: number;
  bytesTotal: number | null;
  chunkBytes: number;
  phase: "enqueue" | "complete";
};

export type FetchTlsInit = {
  trustedCertificatesPem?: string | readonly string[];
};

export type HeaderInit =
  | Record<string, string>
  | Headers
  | Array<[string, string]>;

export type RequestInit = {
  method?: string;
  headers?: HeaderInit;
  body?: BodyInit;
  bodyFileUri?: string;
  timeout?: number;
  signal?: AbortSignal;
  stream?: boolean;
  onUploadProgress?: (progress: UploadProgress) => void;
  redirect?: "follow" | "error" | "manual";
  tls?: FetchTlsInit;
};

export type BodyInit =
  | string
  | ArrayBuffer
  | Uint8Array
  | Blob
  | FormData
  | ReadableStreamLike<Uint8Array>
  | URLSearchParams
  | null
  | undefined;

export type FetchResult = {
  status: number;
  statusText: string;
  ok: boolean;
  url: string;
  redirected: boolean;
  headers: Record<string, string>;
  body?: ArrayBuffer | Uint8Array | number[] | string;
  streamId?: number;
};

export type FetchBridge = {
  call(
    name: string,
    method: string,
    args: any
  ): Promise<unknown> | unknown;
};

export type FetchPayload = {
  url: string;
  requestId?: number;
  method?: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer | Uint8Array | number[];
  bodyFileUri?: string;
  timeout?: number;
  stream?: boolean;
  uploadStream?: boolean;
  uploadLength?: number | null;
  tls?: {
    trustedCertificatesPem?: string[];
  };
};
