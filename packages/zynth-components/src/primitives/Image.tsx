import { createEffect, createSignal, type Component } from "solid-js";
import { Platform, OS } from "@zynth/apis";
import type {
  Style,
  ImageAssetSource as CoreImageAssetSource,
  ImageUriSource as CoreImageUriSource,
  ImageAssetDescriptor,
} from "@zynth/core";

export type ImageResizeMode = "cover" | "contain" | "stretch" | "center";

export type ImageUriSource = CoreImageUriSource;

export type ImageAssetSource = CoreImageAssetSource;

export type ImageBase64Source = {
  data: string;
  mimeType?: string;
};

export type ImageDescriptorSource = ImageAssetDescriptor;

export type SystemIconSource = {
  system: string;
};

export type ImageSource =
  | string
  | ImageUriSource
  | ImageAssetSource
  | ImageBase64Source
  | ImageDescriptorSource
  | SystemIconSource;

export interface ImageLoadEvent {
  target: number;
  width?: number;
  height?: number;
}

export interface ImageErrorEvent {
  target: number;
  message?: string;
}

export interface ImageProps {
  source: ImageSource | ImageSource[];
  style?: Style;
  resizeMode?: ImageResizeMode;
  tintColor?: string;
  onLoad?: (event: ImageLoadEvent) => void;
  onError?: (event: ImageErrorEvent) => void;
}

export type ImageElementProps = ImageProps & { children?: never };

export const Image: Component<ImageProps> = (props) => {
  const [currentSourceIndex, setCurrentSourceIndex] = createSignal(0);

  const sources = () => {
    const src = props.source;
    return Array.isArray(src) ? src : [src];
  };

  const currentSource = () => {
    const sourceList = sources();
    const index = currentSourceIndex();
    return index < sourceList.length ? sourceList[index] : sourceList[0];
  };

  const normalizedSource = () => {
    const source = currentSource();
    // console.log(
    //   "[Image] Current source (index:",
    //   currentSourceIndex(),
    //   "):",
    //   JSON.stringify(source)
    // );
    const normalized = normalizeSingleSource(source);
    // console.log("[Image] Normalized source:", JSON.stringify(normalized));
    return normalized;
  };

  const handleError = (event: ImageErrorEvent) => {
    const sourceList = sources();
    const nextIndex = currentSourceIndex() + 1;

    // console.log(
    //   "[Image] Error loading source",
    //   currentSourceIndex(),
    //   "of",
    //   sourceList.length
    // );

    // Try next source if available
    if (nextIndex < sourceList.length) {
      console.log("[Image] Trying fallback source at index", nextIndex);
      setCurrentSourceIndex(nextIndex);
    } else {
      console.log("[Image] All sources failed, calling onError");
      // All sources failed, call the user's error handler
      props.onError?.(event);
    }
  };

  const handleLoad = (event: ImageLoadEvent) => {
    // console.log(
    //   "[Image] Successfully loaded source at index",
    //   currentSourceIndex()
    // );
    props.onLoad?.(event);
  };

  // Reset to first source when source prop changes
  createEffect(() => {
    props.source;
    setCurrentSourceIndex(0);
  });

  return (
    <image
      style={props.style as any}
      source={normalizedSource()}
      resizeMode={props.resizeMode}
      tintColor={props.tintColor}
      onLoad={handleLoad}
      onError={handleError}
    />
  );
};

function normalizeImageSource(
  input: ImageSource | ImageSource[],
): ImageSource | ImageSource[] {
  if (Array.isArray(input)) {
    return input.map(normalizeSingleSource);
  }
  return normalizeSingleSource(input);
}

function normalizeSingleSource(source: ImageSource): ImageSource {
  if (typeof source === "string") {
    return { uri: source } satisfies ImageUriSource;
  }
  if (
    source &&
    typeof source === "object" &&
    (source as any).type === "asset"
  ) {
    if (Platform.OS === OS.WEB) {
      return source as ImageDescriptorSource;
    }
    return descriptorToNativeSource(source as ImageDescriptorSource);
  }
  return source;
}

function descriptorToNativeSource(
  descriptor: ImageDescriptorSource,
): ImageSource {
  const devUrl = (globalThis as any).__ZYNTH_DEV_SERVER_URL;
  console.log("[Image] descriptorToNativeSource", {
    devUrl,
    descriptor,
    hasDevPath: !!descriptor.devPath,
  });

  if (devUrl && descriptor.devPath) {
    const encodedPath = encodeDevPath(descriptor.devPath);
    const uri = `${devUrl}/@fs/${encodedPath}?hash=${descriptor.hash}`;
    console.log("[Image] Using dev server URL:", uri);
    return {
      uri,
    } satisfies ImageUriSource;
  }

  const assetId = descriptor.hash
    ? `${descriptor.name}-${descriptor.hash}`
    : descriptor.name;
  console.log("[Image] Using asset ID:", assetId);
  return {
    asset: assetId,
    scale: descriptor.scale,
  } satisfies ImageAssetSource;
}

function encodeDevPath(filePath: string): string {
  // Remove leading slash if present to avoid double slashes in URL
  const normalized = filePath.startsWith("/") ? filePath.slice(1) : filePath;
  return normalized
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
