import { createEffect, createSignal, type Component } from "solid-js";
import { Platform, OS } from "@zynth/apis";
import type {
  StyleProp,
  HostNode,
  ImageAssetSource as CoreImageAssetSource,
  ImageUriSource as CoreImageUriSource,
  ImageAssetDescriptor,
} from "@zynth/core";
import { createStyleBinding } from "../hooks/styleBinding";

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
  style?: StyleProp;
  resizeMode?: ImageResizeMode;
  tintColor?: string;
  onLoad?: (event: ImageLoadEvent) => void;
  onError?: (event: ImageErrorEvent) => void;
  ref?: (node: HostNode | null) => void;
}

export type ImageElementProps = ImageProps & { children?: never };

export const Image: Component<ImageProps> = (props) => {
  const [currentSourceIndex, setCurrentSourceIndex] = createSignal(0);
  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);

  createStyleBinding(hostNode, () => props.style);

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
    const normalized = normalizeSingleSource(source);
    return normalized;
  };

  const handleError = (event: ImageErrorEvent) => {
    const sourceList = sources();
    const nextIndex = currentSourceIndex() + 1;

    // Try next source if available
    if (nextIndex < sourceList.length) {
      setCurrentSourceIndex(nextIndex);
    } else {
      // All sources failed, call the user's error handler
      props.onError?.(event);
    }
  };

  const handleLoad = (event: ImageLoadEvent) => {
    props.onLoad?.(event);
  };

  // Reset to first source when source prop changes
  createEffect(() => {
    props.source;
    setCurrentSourceIndex(0);
  });

  const refProp = (node: HostNode | null) => {
    setHostNode(node);
    props.ref?.(node);
  };

  return (
    <image
      style={undefined}
      source={normalizedSource()}
      resizeMode={props.resizeMode}
      tintColor={props.tintColor}
      onLoad={handleLoad}
      onError={handleError}
      ref={refProp}
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
  // console.log("[Image] descriptorToNativeSource", {
  //   devUrl,
  //   descriptor,
  //   hasDevPath: !!descriptor.devPath,
  // });

  if (devUrl && descriptor.devPath) {
    const encodedPath = encodeDevPath(descriptor.devPath);
    const uri = `${devUrl}/@fs/${encodedPath}?hash=${descriptor.hash}`;
    // console.log("[Image] Using dev server URL:", uri);
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
