import type { Headers } from "./Headers";

export type HeaderInit =
  | Record<string, string>
  | Headers
  | Array<[string, string]>;

export type RequestInit = {
  method?: string;
  headers?: HeaderInit;
  body?: BodyInit;
  timeout?: number;
};

export type BodyInit = string | ArrayBuffer | Uint8Array | null | undefined;

export type FetchResult = {
  status: number;
  statusText: string;
  ok: boolean;
  url: string;
  redirected: boolean;
  headers: Record<string, string>;
  body: ArrayBuffer;
};

export type FetchBridge = {
  call(name: string, method: string, args: any): any;
};

export type FetchPayload = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer | Uint8Array | number[];
  timeout?: number;
};
