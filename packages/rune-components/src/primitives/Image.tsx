import type { Component } from "solid-js";
import type { Style } from "@rune/core";

export type ImageResizeMode = "cover" | "contain" | "stretch" | "center";

export type ImageUriSource = {
  uri: string;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  cache?: "default" | "reload" | "force-cache" | "only-if-cached";
};

export type ImageAssetSource = {
  asset: string;
  bundle?: string;
  scale?: number;
};

export type ImageBase64Source = {
  data: string;
  mimeType?: string;
};

export type ImageSource =
  | string
  | ImageUriSource
  | ImageAssetSource
  | ImageBase64Source;

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
  const { style, source, resizeMode, tintColor, onLoad, onError } = props;
  return (
    <image
      style={style as any}
      source={source}
      resizeMode={resizeMode}
      tintColor={tintColor}
      onLoad={onLoad}
      onError={onError}
    />
  );
};
