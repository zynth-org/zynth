import { createEffect, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import type { SkiaSVG } from "./types";
import {
  createNativeSVGFromData,
  createNativeSVGFromString,
  getNativeSVGSize,
  releaseNativeSVG,
} from "./native";

type SVGAssetDescriptor = {
  type: "asset";
  name: string;
  hash: string;
  scale?: number;
  relativePath?: string;
  devPath?: string;
};

export type SkiaSVGSource =
  | string
  | { uri: string }
  | { data: string; mimeType?: string }
  | { asset: string; scale?: number }
  | SVGAssetDescriptor;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function stringToBytes(value: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value);
  }
  const maybeBuffer = (globalThis as { Buffer?: { from(input: string, encoding: string): Uint8Array } }).Buffer;
  if (maybeBuffer) {
    return new Uint8Array(maybeBuffer.from(value, "utf8"));
  }
  const escaped = unescape(encodeURIComponent(value));
  const bytes = new Uint8Array(escaped.length);
  for (let i = 0; i < escaped.length; i += 1) {
    bytes[i] = escaped.charCodeAt(i);
  }
  return bytes;
}

function bytesToString(bytes: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder("utf-8").decode(bytes);
  }
  const maybeBuffer = (globalThis as {
    Buffer?: { from(input: Uint8Array): { toString(encoding: string): string } };
  }).Buffer;
  if (maybeBuffer) {
    return maybeBuffer.from(bytes).toString("utf8");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return decodeURIComponent(escape(binary));
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  const maybeBuffer = (globalThis as { Buffer?: { from(input: string, encoding: string): Uint8Array } }).Buffer;
  if (maybeBuffer) {
    return new Uint8Array(maybeBuffer.from(value, "base64"));
  }
  throw new Error("No base64 decoder available");
}

function isDataUri(value: string): boolean {
  return value.startsWith("data:");
}

function dataUriToBytes(uri: string): Uint8Array {
  const commaIndex = uri.indexOf(",");
  if (commaIndex <= 4) {
    throw new Error("createSVG received an invalid data URI");
  }
  const metadata = uri.slice(5, commaIndex);
  const payload = uri.slice(commaIndex + 1);
  const isBase64 = metadata.split(";").some((part) => part.trim().toLowerCase() === "base64");
  if (isBase64) {
    return base64ToBytes(payload);
  }
  return stringToBytes(decodeURIComponent(payload));
}

function parseAssetModuleDescriptor(source: string): SVGAssetDescriptor | null {
  const trimmed = source.trim();
  const exportPrefix = "export default";
  const jsonCandidate = trimmed.startsWith(exportPrefix)
    ? trimmed.slice(exportPrefix.length).trim().replace(/;$/, "")
    : trimmed;
  if (!jsonCandidate.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(jsonCandidate) as Partial<SVGAssetDescriptor> | null;
    if (!parsed || parsed.type !== "asset") return null;
    if (typeof parsed.name !== "string" || typeof parsed.hash !== "string") return null;
    return {
      type: "asset",
      name: parsed.name,
      hash: parsed.hash,
      scale: typeof parsed.scale === "number" ? parsed.scale : undefined,
      relativePath: typeof parsed.relativePath === "string" ? parsed.relativePath : undefined,
      devPath: typeof parsed.devPath === "string" ? parsed.devPath : undefined,
    };
  } catch {
    return null;
  }
}

function dataUriFromSource(source: { data: string; mimeType?: string }): string {
  const mimeType = source.mimeType ?? "image/svg+xml";
  if (isInlineSVG(source.data)) {
    return `data:${mimeType};utf8,${encodeURIComponent(source.data)}`;
  }
  return `data:${mimeType};base64,${source.data}`;
}

function encodeDevPath(filePath: string): string {
  const normalized = filePath.startsWith("/") ? filePath.slice(1) : filePath;
  return normalized
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function descriptorToUri(descriptor: SVGAssetDescriptor): string | null {
  const globalObj = globalThis as {
    __ZYNTH_DEV_SERVER_URL?: string;
    location?: { origin?: string };
  };
  const devUrl = globalObj.__ZYNTH_DEV_SERVER_URL
    ?? globalObj.location?.origin;
  if (devUrl && descriptor.devPath) {
    const encodedPath = encodeDevPath(descriptor.devPath);
    return `${devUrl}/@fs/${encodedPath}?hash=${descriptor.hash}`;
  }
  if (descriptor.devPath) {
    const encodedPath = encodeDevPath(descriptor.devPath);
    return `/@fs/${encodedPath}?hash=${descriptor.hash}`;
  }
  if (descriptor.relativePath) {
    return `/${descriptor.relativePath.replace(/\\/g, "/")}`;
  }
  return null;
}

function isInlineSVG(value: string): boolean {
  const trimmed = value.trimStart();
  return trimmed.startsWith("<svg") || trimmed.startsWith("<?xml");
}

function resolveSourceUri(source: SkiaSVGSource): string {
  if (typeof source === "string") {
    return source;
  }
  if ("uri" in source && typeof source.uri === "string") {
    return source.uri;
  }
  if ("data" in source && typeof source.data === "string") {
    return dataUriFromSource(source);
  }
  if ("type" in source && source.type === "asset") {
    const uri = descriptorToUri(source);
    if (uri) return uri;
    throw new Error("createSVG could not resolve asset descriptor to a URI");
  }
  if ("asset" in source && typeof source.asset === "string") {
    throw new Error("createSVG does not support { asset } source without a URI");
  }
  throw new Error("createSVG received an unsupported SVG source");
}

async function loadSVGFromSource(source: SkiaSVGSource): Promise<SkiaSVG> {
  if (typeof source === "string" && isInlineSVG(source)) {
    return makeSVGFromString(source);
  }
  const uri = resolveSourceUri(source);
  if (isDataUri(uri)) {
    const bytes = dataUriToBytes(uri);
    const decoded = bytesToString(bytes);
    if (isInlineSVG(decoded)) {
      return makeSVGFromString(decoded);
    }
    const descriptor = parseAssetModuleDescriptor(decoded);
    if (descriptor) {
      const resolvedUri = descriptorToUri(descriptor);
      if (!resolvedUri) {
        throw new Error("createSVG could not resolve asset module descriptor to a URI");
      }
      const response = await fetch(resolvedUri);
      if (!response.ok) {
        throw new Error(`createSVG failed to fetch SVG asset: ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      return makeSVGFromData({ toBytes: () => new Uint8Array(buffer) });
    }
    return makeSVGFromData({ toBytes: () => bytes });
  }
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`createSVG failed to fetch SVG: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return makeSVGFromData({ toBytes: () => new Uint8Array(buffer) });
}

function createSkiaSVG(svgId: number, width: number, height: number): SkiaSVG {
  let disposed = false;
  return {
    __skiaSVG: true,
    id: svgId,
    width() {
      return width;
    },
    height() {
      return height;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseNativeSVG(svgId);
    },
  };
}

function resolveSVGSizeOrThrow(svgId: number): { width: number; height: number } {
  const size = getNativeSVGSize(svgId);
  if (!size) {
    throw new Error("Failed to read Skia SVG size");
  }
  return size;
}

export function createSVG(
  source: SkiaSVGSource | Accessor<SkiaSVGSource>,
  onError?: (error: Error) => void,
): Accessor<SkiaSVG | null> {
  const readSource = typeof source === "function"
    ? source as Accessor<SkiaSVGSource>
    : () => source;
  const [svg, setSVG] = createSignal<SkiaSVG | null>(null);
  let requestId = 0;
  let currentSVG: SkiaSVG | null = null;

  createEffect(() => {
    const next = readSource();
    requestId += 1;
    const activeRequest = requestId;
    setSVG(null);

    void loadSVGFromSource(next).then((resolved) => {
      if (activeRequest !== requestId) {
        resolved.dispose();
        return;
      }
      currentSVG?.dispose();
      currentSVG = resolved;
      setSVG(() => resolved);
    }).catch((error) => {
      if (activeRequest !== requestId) return;
      onError?.(error instanceof Error ? error : new Error(String(error)));
      setSVG(null);
    });
  });

  onCleanup(() => {
    requestId += 1;
    currentSVG?.dispose();
    currentSVG = null;
  });

  return svg;
}

/** @deprecated Use createSVG instead */
export const useSVG = createSVG;

export function makeSVGFromString(
  source: string,
  _fontMgr?: unknown,
  _resources?: Record<string, { toBytes(): Uint8Array } | Uint8Array>,
): SkiaSVG {
  let svgId = 0;
  try {
    svgId = createNativeSVGFromString(source);
  } catch {
    svgId = createNativeSVGFromData(toArrayBuffer(stringToBytes(source)));
  }
  const size = resolveSVGSizeOrThrow(svgId);
  return createSkiaSVG(svgId, size.width, size.height);
}

export function makeSVGFromData(
  data: { toBytes(): Uint8Array },
  _fontMgr?: unknown,
  _resources?: Record<string, { toBytes(): Uint8Array } | Uint8Array>,
): SkiaSVG {
  const bytes = data.toBytes();
  let svgId = 0;
  try {
    svgId = createNativeSVGFromData(toArrayBuffer(bytes));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("createSVGFromData")) {
      throw error;
    }
    svgId = createNativeSVGFromString(bytesToString(bytes));
  }
  const size = resolveSVGSizeOrThrow(svgId);
  return createSkiaSVG(svgId, size.width, size.height);
}
