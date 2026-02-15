import { createEffect, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import type { SkiaSkottie, SkiaSkottieSource } from "./types";
import {
  createNativeSkottieFromData,
  createNativeSkottieFromString,
  getNativeSkottieInfo,
  releaseNativeSkottie,
} from "./native";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function createSkiaSkottie(
  animationId: number,
  info: {
    width: number;
    height: number;
    duration: number;
    fps: number;
    version: string;
  },
): SkiaSkottie {
  let disposed = false;
  return {
    __skiaSkottie: true,
    id: animationId,
    width() {
      return info.width;
    },
    height() {
      return info.height;
    },
    duration() {
      return info.duration;
    },
    fps() {
      return info.fps;
    },
    version() {
      return info.version;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseNativeSkottie(animationId);
    },
  };
}

function resolveSkottieInfoOrThrow(animationId: number): {
  width: number;
  height: number;
  duration: number;
  fps: number;
  version: string;
} {
  const info = getNativeSkottieInfo(animationId);
  if (!info) {
    throw new Error("Failed to read Skottie animation info");
  }
  return info;
}

function resolveSourceUri(
  source: Exclude<SkiaSkottieSource, object> | { uri: string } | { data: string },
): string {
  if (typeof source === "string") {
    return source;
  }
  if ("uri" in source && typeof source.uri === "string") {
    return source.uri;
  }
  if ("data" in source && typeof (source as any).data === "string") {
    const mimeType = (source as any).mimeType ?? "application/json";
    return `data:${mimeType};base64,${(source as any).data}`;
  }
  throw new Error("createSkottie received an unsupported source");
}

async function createSkottieFromSource(source: SkiaSkottieSource): Promise<SkiaSkottie> {
  if (typeof source === "string" && source.trim().startsWith("{")) {
    return makeSkottieFromString(source);
  }

  if (typeof source === "object" && source !== null && !("uri" in source) && !("data" in source)) {
    return makeSkottieFromString(JSON.stringify(source));
  }

  const uri = resolveSourceUri(source as any);
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`createSkottie failed to fetch animation: ${response.status}`);
  }
  const text = await response.text();
  return makeSkottieFromString(text);
}

export function createSkottie(
  source: SkiaSkottieSource | Accessor<SkiaSkottieSource>,
  onError?: (error: Error) => void,
): Accessor<SkiaSkottie | null> {
  const readSource = typeof source === "function"
    ? (source as Accessor<SkiaSkottieSource>)
    : () => source;
  const [animation, setAnimation] = createSignal<SkiaSkottie | null>(null);
  let requestId = 0;
  let currentAnimation: SkiaSkottie | null = null;

  createEffect(() => {
    const next = readSource();
    requestId += 1;
    const activeRequest = requestId;
    setAnimation(null);

    void createSkottieFromSource(next).then((resolved) => {
      if (activeRequest !== requestId) {
        resolved.dispose();
        return;
      }
      currentAnimation?.dispose();
      currentAnimation = resolved;
      setAnimation(() => resolved);
    }).catch((error) => {
      if (activeRequest !== requestId) return;
      onError?.(error instanceof Error ? error : new Error(String(error)));
      setAnimation(null);
    });
  });

  onCleanup(() => {
    requestId += 1;
    currentAnimation?.dispose();
    currentAnimation = null;
  });

  return animation;
}

/** @deprecated Use createSkottie instead */
export const useSkottie = createSkottie;

export function makeSkottieFromString(source: string): SkiaSkottie {
  const animationId = createNativeSkottieFromString(source);
  const info = resolveSkottieInfoOrThrow(animationId);
  return createSkiaSkottie(animationId, info);
}

export function makeSkottieFromData(data: { toBytes(): Uint8Array }): SkiaSkottie {
  const bytes = data.toBytes();
  const animationId = createNativeSkottieFromData(toArrayBuffer(bytes));
  const info = resolveSkottieInfoOrThrow(animationId);
  return createSkiaSkottie(animationId, info);
}

export function makeSkottie(source: string | { toBytes(): Uint8Array }): SkiaSkottie {
  if (typeof source === "string") {
    return makeSkottieFromString(source);
  }
  if (source && typeof source === "object" && typeof source.toBytes === "function") {
    return makeSkottieFromData(source);
  }
  throw new Error("Skia.Skottie.Make expects a JSON string or data object");
}
