/** @jsxImportSource solid-js */
import { createEffect, createMemo, createSignal, splitProps } from "solid-js";
import { registerComponent } from "@zynthjs/core";
import type {
  ImageErrorEvent,
  ImageLoadEvent,
  ImageResizeMode,
  ImageSource,
  ImageDescriptorSource,
} from "../src/primitives/Image";
import type { Style } from "@zynthjs/core";

const TRANSPARENT_GIF =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

type ResolvedSource = {
  src?: string;
  systemName?: string;
};

function encodeDevPath(filePath: string): string {
  const normalized = filePath.startsWith("/") ? filePath.slice(1) : filePath;
  return normalized
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function descriptorToWebSource(descriptor: ImageDescriptorSource): ImageSource {
  const devUrl =
    (globalThis as any).__ZYNTH_DEV_SERVER_URL ||
    (typeof window !== "undefined" ? window.location.origin : undefined);
  if (devUrl && descriptor.devPath) {
    const encodedPath = encodeDevPath(descriptor.devPath);
    return {
      uri: `${devUrl}/@fs/${encodedPath}?hash=${descriptor.hash}`,
    };
  }
  if (descriptor.relativePath) {
    return {
      uri: `/${descriptor.relativePath.replace(/\\/g, "/")}`,
    };
  }
  return { uri: undefined } as any;
}

function normalizeSingleSource(source: ImageSource): ImageSource {
  if (typeof source === "string") {
    return { uri: source };
  }
  if (
    source &&
    typeof source === "object" &&
    (source as any).type === "asset"
  ) {
    return descriptorToWebSource(source as ImageDescriptorSource);
  }
  if (source && typeof source === "object" && "data" in source) {
    const mime = source.mimeType || "image/png";
    return { uri: `data:${mime};base64,${source.data}` };
  }
  return source;
}

function resolveSource(source: ImageSource): ResolvedSource {
  if (source && typeof source === "object" && "system" in source) {
    return {
      src: (source as any).uri ?? TRANSPARENT_GIF,
      systemName: source.system,
    };
  }
  if (source && typeof source === "object" && "uri" in source) {
    return { src: source.uri as string | undefined };
  }
  if (source && typeof source === "object" && "asset" in source) {
    return { src: (source as any).asset as string | undefined };
  }
  return { src: undefined };
}

function resolveObjectFit(resizeMode?: ImageResizeMode): string | undefined {
  switch (resizeMode) {
    case "cover":
      return "cover";
    case "contain":
      return "contain";
    case "stretch":
      return "fill";
    case "center":
      return "none";
    default:
      return undefined;
  }
}

function mergeStyle(input?: Style | Style[]): Record<string, any> | undefined {
  if (!input) return undefined;
  if (Array.isArray(input)) {
    const merged: Record<string, any> = {};
    for (const item of input) {
      if (item && typeof item === "object") {
        Object.assign(merged, item);
      }
    }
    return merged;
  }
  if (typeof input === "object") {
    return { ...(input as Record<string, any>) };
  }
  return undefined;
}

const Image = (props: {
  source: ImageSource | ImageSource[];
  style?: Style | Style[];
  resizeMode?: ImageResizeMode;
  onLoad?: (event: ImageLoadEvent) => void;
  onError?: (event: ImageErrorEvent) => void;
  [key: string]: any;
}) => {
  const [local, rest] = splitProps(props, [
    "source",
    "class",
    "style",
    "resizeMode",
    "onLoad",
    "onError",
  ]);

  const [currentSourceIndex, setCurrentSourceIndex] = createSignal(0);

  const normalizedSources = createMemo(() => {
    const src = local.source;
    const list = Array.isArray(src) ? src : [src];
    return list.map((entry) => normalizeSingleSource(entry));
  });

  const currentSource = createMemo(() => {
    const list = normalizedSources();
    const index = currentSourceIndex();
    return list[index] ?? list[0];
  });

  const resolved = createMemo(() => resolveSource(currentSource()));
  const objectFit = createMemo(() => resolveObjectFit(local.resizeMode));

  const baseStyle = createMemo(() => {
    const merged = mergeStyle(local.style) ?? {};
    if (objectFit()) {
      merged["object-fit"] = objectFit();
      if (local.resizeMode === "center") {
        merged["object-position"] = "center";
      }
    }
    return merged;
  });

  const handleLoad = (event: Event) => {
    const img = event.currentTarget as HTMLImageElement | null;
    local.onLoad?.({
      target: 0,
      width: img?.naturalWidth,
      height: img?.naturalHeight,
    });
  };

  const handleError = () => {
    const list = normalizedSources();
    const nextIndex = currentSourceIndex() + 1;
    if (nextIndex < list.length) {
      setCurrentSourceIndex(nextIndex);
      return;
    }
    local.onError?.({
      target: 0,
      message: "Failed to load image",
    });
  };

  createEffect(() => {
    local.source;
    setCurrentSourceIndex(0);
  });

  return (
    <img
      class={`zynth-image${local.class ? ` ${local.class}` : ""}`}
      src={resolved().src}
      data-system-name={resolved().systemName}
      style={baseStyle()}
      onLoad={handleLoad}
      onError={handleError}
      {...rest}
    />
  );
};

registerComponent("image", Image);
