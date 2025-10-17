import type { Headers } from "./Headers";
import type { AbortSignal } from "../AbortController";
import type { Blob } from "../Blob";
import type { FormData } from "../FormData";

export type HeaderInit =
  | Record<string, string>
  | Headers
  | Array<[string, string]>;

export type RequestInit = {
  method?: string;
  headers?: HeaderInit;
  body?: BodyInit;
  timeout?: number;
  signal?: AbortSignal;
  redirect?: "follow" | "error" | "manual";
};

export type BodyInit =
  | string
  | ArrayBuffer
  | Uint8Array
  | Blob
  | FormData
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
  body?: ArrayBuffer;
  streamId?: number;
};

export type FetchBridge = {
  call(name: string, method: string, args: any): any;
};

export type FetchPayload = {
  url: string;
  requestId?: number;
  method?: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer | Uint8Array | number[];
  timeout?: number;
  stream?: boolean;
};
