import type { Style } from "@zynth/core";
import type { JSX } from "solid-js";
import type {
  WebViewCommand,
  WebViewLoadEvent,
  WebViewErrorEvent,
  WebViewMessageEvent,
  WebViewNativeReadyEvent,
  WebViewSource,
} from "./types";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "zynth-webview": {
        style?: Style;
        source?: WebViewSource;
        javaScriptEnabled?: boolean;
        userAgent?: string;
        command?: WebViewCommand;
        ref?: (node: any) => void;
        onLoadStart?: (event: WebViewLoadEvent) => void;
        onLoad?: (event: WebViewLoadEvent) => void;
        onLoadEnd?: (event: WebViewLoadEvent) => void;
        onError?: (event: WebViewErrorEvent) => void;
        onMessage?: (event: WebViewMessageEvent) => void;
        onNavigationStateChange?: (event: WebViewLoadEvent) => void;
        onNativeReady?: (event: WebViewNativeReadyEvent) => void;
        children?: JSX.Element;
      };
    }
  }
}
