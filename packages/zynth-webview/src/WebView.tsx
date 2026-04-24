import { createEffect, createSignal, mergeProps, onCleanup, splitProps } from "solid-js";
import type { ParentComponent } from "solid-js";
import type { HostNode } from "@zynthjs/core";
import { setProperty } from "@zynthjs/core";
import type { WebViewCommand, WebViewProps, WebViewRef } from "./types";

const noopRef = () => {};
const toNativeEvent = <T,>(event: T): { nativeEvent: T } => {
  const value = event as any;
  if (value && typeof value === "object" && "nativeEvent" in value) {
    return value as { nativeEvent: T };
  }
  return { nativeEvent: event };
};

export const WebView: ParentComponent<WebViewProps> = (props) => {
  const merged = mergeProps(
    {
      javaScriptEnabled: true,
    },
    props
  );

  const [local] = splitProps(merged, [
    "source",
    "style",
    "javaScriptEnabled",
    "userAgent",
    "onLoadStart",
    "onLoad",
    "onLoadEnd",
    "onError",
    "onMessage",
    "onNavigationStateChange",
    "onNativeReady",
    "ref",
  ]);

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);
  const hasStyleAccessor = typeof local.style === "function";
  const resolveStyle = () => {
    const style = local.style;
    return (typeof style === "function" ? style() : style) ?? {};
  };

  const [command, setCommand] = createSignal<WebViewCommand | undefined>(undefined);
  const [nativeReady, setNativeReady] = createSignal(false);
  let commandId = 0;

  const queueCommand = (type: WebViewCommand["type"], payload?: string) => {
    commandId += 1;
    setCommand({ id: commandId, type, payload });
    setTimeout(() => setCommand(undefined), 10);
  };

  const refProp = (node: HostNode | null) => {
    setHostNode(node);
    if (node) {
      const refNode = node as WebViewRef;
      refNode.reload = () => queueCommand("reload");
      refNode.goBack = () => queueCommand("goBack");
      refNode.goForward = () => queueCommand("goForward");
      refNode.stopLoading = () => queueCommand("stopLoading");
      refNode.injectJavaScript = (script: string) =>
        queueCommand("injectJavaScript", script);
      refNode.postMessage = (message: string) =>
        queueCommand("postMessage", message);
      (local.ref ?? noopRef)(refNode);
      return;
    }
    (local.ref ?? noopRef)(null);
  };

  const handleLoadStart = (event: any) =>
    local.onLoadStart?.(toNativeEvent(event));
  const handleLoad = (event: any) => local.onLoad?.(toNativeEvent(event));
  const handleLoadEnd = (event: any) =>
    local.onLoadEnd?.(toNativeEvent(event));
  const handleError = (event: any) => local.onError?.(toNativeEvent(event));
  const handleMessage = (event: any) =>
    local.onMessage?.(toNativeEvent(event));
  const handleNavigationStateChange = (event: any) =>
    local.onNavigationStateChange?.(toNativeEvent(event));
  const handleNativeReady = (event: any) => {
    setNativeReady(true);
    local.onNativeReady?.(toNativeEvent(event));
  };

  createEffect(() => {
    if (!isNativePlatform()) return;
    if (nativeReady()) return;

    const timer = setTimeout(() => {
      if (!nativeReady()) {
        console.warn(
          "[@zynthjs/webview] Native component 'zynth-webview' registration check timed out (5000ms). " +
            "This might be a false positive on slow devices, or the module is truly missing."
        );
        // We warn instead of throwing to prevent crashing if it's just slow.
        // But if it's missing, the user will see a blank screen anyway.
      }
    }, 5000);

    onCleanup(() => clearTimeout(timer));
  });

  createEffect(() => {
    if (!hasStyleAccessor) return;
    const node = hostNode();
    if (!node) return;
    setProperty(node, "style", resolveStyle());
  });

  return (
    // @ts-ignore Custom native element
    <zynth-webview
      ref={refProp}
      style={(hasStyleAccessor ? undefined : (resolveStyle() as any)) as any}
      source={local.source}
      javaScriptEnabled={local.javaScriptEnabled}
      userAgent={local.userAgent}
      command={command()}
      onLoadStart={handleLoadStart}
      onLoad={handleLoad}
      onLoadEnd={handleLoadEnd}
      onError={handleError}
      onMessage={handleMessage}
      onNavigationStateChange={handleNavigationStateChange}
      onNativeReady={handleNativeReady}
    />
  );
};

const isNativePlatform = (): boolean => {
  const platform = (globalThis as any).__ZYNTH_PLATFORM;
  if (typeof platform !== "string") return false;
  const normalized = platform.toLowerCase();
  return normalized === "ios" || normalized === "android";
};
