import type { JSX } from "solid-js";
import type { HostNode, StyleProp } from "@zynth/core";

export interface WebViewNavigationState {
  url: string;
  title?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface WebViewLoadEvent {
  nativeEvent: WebViewNavigationState;
}

export interface WebViewErrorEvent {
  nativeEvent: WebViewNavigationState & {
    code: number;
    domain: string;
    description: string;
  };
}

export interface WebViewMessageEvent {
  nativeEvent: {
    data: string;
    url: string;
  };
}

export interface WebViewNativeReadyEvent {
  nativeEvent: {
    available: boolean;
  };
}

export type WebViewSourceUri = {
  uri: string;
  headers?: Record<string, string>;
};

export type WebViewSourceHtml = {
  html: string;
  baseUrl?: string;
};

export type WebViewSource = WebViewSourceUri | WebViewSourceHtml;

export type WebViewCommandType =
  | "reload"
  | "goBack"
  | "goForward"
  | "stopLoading"
  | "injectJavaScript"
  | "postMessage";

export interface WebViewCommand {
  id: number;
  type: WebViewCommandType;
  payload?: string;
}

export interface WebViewControllerApi {
  reload: () => void;
  goBack: () => void;
  goForward: () => void;
  stopLoading: () => void;
  injectJavaScript: (script: string) => void;
  postMessage: (message: string) => void;
}

export interface WebViewController extends WebViewControllerApi {
  api: WebViewControllerApi | null;
}

export interface WebViewProps {
  source: WebViewSource;
  style?: StyleProp | (() => StyleProp | undefined);
  javaScriptEnabled?: boolean;
  userAgent?: string;
  onLoadStart?: (event: WebViewLoadEvent) => void;
  onLoad?: (event: WebViewLoadEvent) => void;
  onLoadEnd?: (event: WebViewLoadEvent) => void;
  onError?: (event: WebViewErrorEvent) => void;
  onMessage?: (event: WebViewMessageEvent) => void;
  onNavigationStateChange?: (event: WebViewLoadEvent) => void;
  onNativeReady?: (event: WebViewNativeReadyEvent) => void;
  controller?: WebViewController;
  key?: string | number;
  ref?: (node: HostNode | null) => void;
  children?: JSX.Element;
}
