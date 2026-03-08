import type { WebViewMethods, WebViewRefHandle } from "./types";

const noop = () => {};
const noopWithString = (_value: string) => {};

export function createWebViewRefHandle(): WebViewRefHandle {
  const handle: WebViewRefHandle = {
    api: null,
    reload: () => (handle.api ?? fallbackApi).reload(),
    goBack: () => (handle.api ?? fallbackApi).goBack(),
    goForward: () => (handle.api ?? fallbackApi).goForward(),
    stopLoading: () => (handle.api ?? fallbackApi).stopLoading(),
    injectJavaScript: (script: string) =>
      (handle.api ?? fallbackApi).injectJavaScript(script),
    postMessage: (message: string) =>
      (handle.api ?? fallbackApi).postMessage(message),
  };

  return handle;
}

const fallbackApi: WebViewMethods = {
  reload: noop,
  goBack: noop,
  goForward: noop,
  stopLoading: noop,
  injectJavaScript: noopWithString,
  postMessage: noopWithString,
};
