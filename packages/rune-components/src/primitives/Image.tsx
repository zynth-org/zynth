import type { Component } from "solid-js";
import type {
  Style,
  ImageAssetSource as CoreImageAssetSource,
  ImageUriSource as CoreImageUriSource,
  ImageAssetDescriptor,
} from "@rune/core";

export type ImageResizeMode = "cover" | "contain" | "stretch" | "center";

export type ImageUriSource = CoreImageUriSource;

export type ImageAssetSource = CoreImageAssetSource;

export type ImageBase64Source = {
  data: string;
  mimeType?: string;
};

export type ImageDescriptorSource = ImageAssetDescriptor;

export type ImageSource =
  | string
  | ImageUriSource
  | ImageAssetSource
  | ImageBase64Source
  | ImageDescriptorSource;

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
  const normalizedSource = () => normalizeImageSource(props.source);
  return (
    <image
      style={props.style as any}
      source={normalizedSource()}
      resizeMode={props.resizeMode}
      tintColor={props.tintColor}
      onLoad={props.onLoad}
      onError={props.onError}
    />
  );
};

function normalizeImageSource(
  input: ImageSource | ImageSource[]
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
    return descriptorToNativeSource(source as ImageDescriptorSource);
  }
  return source;
}

function descriptorToNativeSource(
  descriptor: ImageDescriptorSource
): ImageSource {
  const devUrl = (globalThis as any).__RUNE_DEV_SERVER_URL;
  if (devUrl && descriptor.devPath) {
    const encodedPath = encodeDevPath(descriptor.devPath);
    return {
      uri: `${devUrl}/@fs/${encodedPath}?hash=${descriptor.hash}`,
    } satisfies ImageUriSource;
  }

  const assetId = descriptor.hash
    ? `${descriptor.name}-${descriptor.hash}`
    : descriptor.name;
  return {
    asset: assetId,
    scale: descriptor.scale,
  } satisfies ImageAssetSource;
}

function encodeDevPath(filePath: string): string {
  return filePath
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
