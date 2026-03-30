# @zynth/webview

Native WebView primitive for Zynth with a unified iOS/Android API.

## Features

- Loads remote URLs with optional request headers
- Loads inline HTML strings with optional base URL
- Unified lifecycle events (`onLoadStart`, `onLoad`, `onLoadEnd`, `onError`)
- Navigation state events (`onNavigationStateChange`)
- Bidirectional messaging (`onMessage`, `postMessage`)
- Imperative controller API (`reload`, `goBack`, `goForward`, `stopLoading`, `injectJavaScript`, `postMessage`)

## Usage

```tsx
import { WebView, createWebViewController } from "@zynth/webview";

const controller = createWebViewController();

<WebView
  style={{ flex: 1 }}
  source={{ uri: "https://zynthai.com" }}
  controller={controller}
  onNavigationStateChange={(event) => {
    console.log("URL", event.nativeEvent.url);
  }}
  onMessage={(event) => {
    console.log("From page:", event.nativeEvent.data);
  }}
/>;
```

### Send a message into the page

```ts
controller.postMessage("hello from native");
```

### Receive a message from the page

In page JavaScript:

```js
window.ZynthWebView.postMessage("hello from web");
```

`window.ReactNativeWebView.postMessage(...)` is also available for compatibility.
