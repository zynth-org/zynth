import type { WebViewController, WebViewControllerApi } from "./types";

const noop = () => {};
const noopWithString = (_value: string) => {};

export function createWebViewController(): WebViewController {
  const controller: WebViewController = {
    api: null,
    reload: () => (controller.api ?? fallbackApi).reload(),
    goBack: () => (controller.api ?? fallbackApi).goBack(),
    goForward: () => (controller.api ?? fallbackApi).goForward(),
    stopLoading: () => (controller.api ?? fallbackApi).stopLoading(),
    injectJavaScript: (script: string) =>
      (controller.api ?? fallbackApi).injectJavaScript(script),
    postMessage: (message: string) =>
      (controller.api ?? fallbackApi).postMessage(message),
  };

  return controller;
}

const fallbackApi: WebViewControllerApi = {
  reload: noop,
  goBack: noop,
  goForward: noop,
  stopLoading: noop,
  injectJavaScript: noopWithString,
  postMessage: noopWithString,
};
