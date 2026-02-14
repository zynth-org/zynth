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
  const devUrl = (globalThis as { __ZYNTH_DEV_SERVER_URL?: string }).__ZYNTH_DEV_SERVER_URL;
  if (devUrl && descriptor.devPath) {
    const encodedPath = encodeDevPath(descriptor.devPath);
    return `${devUrl}/@fs/${encodedPath}?hash=${descriptor.hash}`;
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
  const svgId = createNativeSVGFromData(toArrayBuffer(bytes));
  const size = resolveSVGSizeOrThrow(svgId);
  return createSkiaSVG(svgId, size.width, size.height);
}
