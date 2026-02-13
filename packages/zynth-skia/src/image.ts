import { createEffect, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import type {
  SkiaImage,
  SkiaImageInfo,
} from "./types";
import {
  createNativeImageFromEncoded,
  createNativeImageFromPixels,
  getNativeImageInfo,
  releaseNativeImage,
} from "./native";

type ImageAssetDescriptor = {
  type: "asset";
  name: string;
  hash: string;
  scale?: number;
  relativePath?: string;
  devPath?: string;
};

export type SkiaImageSource =
  | string
  | { uri: string }
  | { data: string; mimeType?: string }
  | { asset: string; scale?: number }
  | ImageAssetDescriptor;

export type SkiaData = {
  readonly bytes: Uint8Array;
  toBytes(): Uint8Array;
  toBase64(): string;
};

function toUint8Array(input: ArrayBuffer | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) return new Uint8Array(input);
  return new Uint8Array(input);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary);
  }
  const maybeBuffer = (globalThis as { Buffer?: { from(input: Uint8Array): { toString(fmt: string): string } } }).Buffer;
  if (maybeBuffer) {
    return maybeBuffer.from(bytes).toString("base64");
  }
  throw new Error("No base64 encoder available");
}

function dataUriFromSource(source: { data: string; mimeType?: string }): string {
  const mimeType = source.mimeType ?? "image/png";
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

function descriptorToUri(descriptor: ImageAssetDescriptor): string | null {
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

function resolveSourceUri(source: SkiaImageSource): string {
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
    throw new Error("createImage could not resolve asset descriptor to a URI");
  }
  if ("asset" in source && typeof source.asset === "string") {
    throw new Error("createImage does not support { asset } source without a URI");
  }
  throw new Error("createImage received an unsupported image source");
}

async function loadBytesFromSource(source: SkiaImageSource): Promise<Uint8Array> {
  const uri = resolveSourceUri(source);
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`createImage failed to fetch image: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

function createData(bytes: Uint8Array): SkiaData {
  const copy = new Uint8Array(bytes);
  return {
    bytes: copy,
    toBytes() {
      return new Uint8Array(copy);
    },
    toBase64() {
      return bytesToBase64(copy);
    },
  };
}

function createSkiaImage(
  imageId: number,
  info: SkiaImageInfo,
  encodedBytes?: Uint8Array,
  pixelBytes?: Uint8Array,
): SkiaImage {
  let disposed = false;
  return {
    __skiaImage: true,
    id: imageId,
    width() {
      return info.width;
    },
    height() {
      return info.height;
    },
    getImageInfo() {
      return { ...info };
    },
    encodeToBytes() {
      if (encodedBytes) return new Uint8Array(encodedBytes);
      if (pixelBytes) return new Uint8Array(pixelBytes);
      return new Uint8Array(0);
    },
    encodeToBase64() {
      const bytes = this.encodeToBytes();
      return bytesToBase64(bytes);
    },
    readPixels() {
      if (pixelBytes) return new Uint8Array(pixelBytes);
      return new Uint8Array(0);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseNativeImage(imageId);
    },
  };
}

function resolveImageInfoOrThrow(imageId: number): SkiaImageInfo {
  const info = getNativeImageInfo(imageId);
  if (!info) {
    throw new Error("Failed to read Skia image info");
  }
  return info;
}

async function createImageFromSource(source: SkiaImageSource): Promise<SkiaImage> {
  const bytes = await loadBytesFromSource(source);
  const imageId = createNativeImageFromEncoded(toArrayBuffer(bytes));
  const info = resolveImageInfoOrThrow(imageId);
  return createSkiaImage(imageId, info, bytes);
}

export function createImage(
  source: SkiaImageSource | Accessor<SkiaImageSource>,
  onError?: (error: Error) => void,
): Accessor<SkiaImage | null> {
  const readSource = typeof source === "function"
    ? source as Accessor<SkiaImageSource>
    : () => source;
  const [image, setImage] = createSignal<SkiaImage | null>(null);
  let requestId = 0;
  let currentImage: SkiaImage | null = null;

  createEffect(() => {
    const next = readSource();
    requestId += 1;
    const activeRequest = requestId;
    setImage(null);

    void createImageFromSource(next).then((resolved) => {
      if (activeRequest !== requestId) {
        resolved.dispose();
        return;
      }
      currentImage?.dispose();
      currentImage = resolved;
      setImage(() => resolved);
    }).catch((error) => {
      if (activeRequest !== requestId) return;
      onError?.(error instanceof Error ? error : new Error(String(error)));
      setImage(null);
    });
  });

  onCleanup(() => {
    requestId += 1;
    currentImage?.dispose();
    currentImage = null;
  });

  return image;
}

/** @deprecated Use createImage instead */
export const useImage = createImage;

export const CubicSampling = { B: 0, C: 0 } as const;

export const FilterMode = {
  Nearest: "nearest",
  Linear: "linear",
} as const;

export const MipmapMode = {
  None: "none",
  Nearest: "nearest",
  Linear: "linear",
} as const;

export const AlphaType = {
  Unknown: 0,
  Opaque: 1,
  Premul: 2,
  Unpremul: 3,
} as const;

export const ColorType = {
  Unknown: 0,
  Alpha8: 1,
  RGB565: 2,
  RGBA_8888: 4,
  BGRA_8888: 6,
  RGBA_F16: 10,
} as const;

export function makeSkiaDataFromBytes(bytes: ArrayBuffer | Uint8Array): SkiaData {
  return createData(toUint8Array(bytes));
}

export function makeSkiaDataFromBase64(base64: string): SkiaData {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return createData(bytes);
  }
  const maybeBuffer = (globalThis as { Buffer?: { from(input: string, encoding: string): Uint8Array } }).Buffer;
  if (maybeBuffer) {
    return createData(new Uint8Array(maybeBuffer.from(base64, "base64")));
  }
  throw new Error("No base64 decoder available");
}

export function makeImageFromEncoded(data: { toBytes(): Uint8Array }): SkiaImage {
  const bytes = data.toBytes();
  const imageId = createNativeImageFromEncoded(toArrayBuffer(bytes));
  const info = resolveImageInfoOrThrow(imageId);
  return createSkiaImage(imageId, info, bytes);
}

export function makeImage(
  info: { width: number; height: number; alphaType: number; colorType: number },
  data: { toBytes(): Uint8Array },
  rowBytes: number,
): SkiaImage {
  const bytes = data.toBytes();
  const imageId = createNativeImageFromPixels(
    info.width,
    info.height,
    info.alphaType,
    info.colorType,
    rowBytes,
    toArrayBuffer(bytes),
  );
  const nativeInfo = resolveImageInfoOrThrow(imageId);
  return createSkiaImage(imageId, nativeInfo, undefined, bytes);
}
