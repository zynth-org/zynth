# WebView

The `WebView` component provides a native, high-performance web presentation layer for the Zynth framework. It relies directly on `WKWebView` for iOS and `android.webkit.WebView` for Android. Through our native bridge bindings, it grants extensive capabilities to execute JavaScript, listen for deep navigational changes, and exchange synchronous or asynchronous messages between the running JS context and native device layers.

## Basic usage

A fundamental use case is loading remote domains or local html files. You can pass the source property formatted as an object that contains either a `uri` or `html`.

```tsx
import { WebView } from "@zynthjs/webview";
import { View } from "@zynthjs/components";

export function StandardBrowser() {
  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <WebView
        style={{ flex: 1 }}
        source={{ uri: "https://zynthai.com" }}
        onLoadStart={(event) => console.log("Loading page:", event.nativeEvent.url)}
        onError={(event) => console.error("Failed to load page:", event.nativeEvent.description)}
      />
    </View>
  );
}
```

## Advanced signals and communication

The `WebView` allows deep integration between internal JavaScript and your native SolidJS component. By leveraging the component's underlying methods mapped onto its reactive ref, you can seamlessly send messages `postMessage` or directly invoke scripts through `injectJavaScript`.

The internal document exposes `window.ZynthWebView.postMessage(string)` to pass events back to the parent React context.

```tsx
import { Button, Text, View } from "@zynthjs/components";
import { WebView } from "@zynthjs/webview";
import type { WebViewRef } from "@zynthjs/webview";
import { createSignal } from "solid-js";

const PAGE_HTML = `
<!doctype html>
<html>
  <body>
    <h1>Local Application Frame</h1>
    <button onclick="window.ZynthWebView.postMessage('tapped-btn')">
      Perform native action
    </button>
  </body>
</html>
`;

export function BridgedInterface() {
  const [latestCallback, setLatestCallback] = createSignal("idle");
  let webviewRef: WebViewRef | null = null;

  const handleMessage = (event) => {
    setLatestCallback(event.nativeEvent.data);
  };

  const dispatchToPage = () => {
    if (webviewRef) {
      // Execute arbitrary JavaScript
      webviewRef.injectJavaScript("document.body.style.backgroundColor = 'red';");
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Text>Latest message: {latestCallback()}</Text>
      <Button title="Theme Frame" onPress={dispatchToPage} />
      <WebView
        ref={(node) => {
          webviewRef = node;
        }}
        style={{ flex: 1 }}
        source={{ html: PAGE_HTML }}
        onMessage={handleMessage}
      />
    </View>
  );
}
```

## Special Cases

### Web Target Considerations

Because `WebView` renders OS-level browser frames, its functionality differs greatly when the compilation target is Web. While iOS and Android handle advanced JavaScript injection and headers gracefully, attempting to mount a `WebView` on standard Web targets may fallback to a basic `<iframe>`. Certain deep navigation listeners or JavaScript injection commands may degrade or become a no-op due to strict cross-origin browser policies. Ensure your deployment accounts for these specific variations if aiming for a universal platform release.

## API Reference

### `WebView`

The default SolidJS component mapping to native platform web views.

**Type**

```tsx
function WebView(props: WebViewProps): JSX.Element;
```

**Props**

*   `source` (`WebViewSourceUri | WebViewSourceHtml`): Determines what the component renders.
    *   `uri` (`string`): The remote or local URL to navigate to.
    *   `headers` (`Record<string, string>`, optional): Extra HTTP headers to append (only applicable when passing a `uri`).
    *   `html` (`string`): A static HTML string to render.
    *   `baseUrl` (`string`, optional): The base URL employed to resolve relative paths in the `html` string.
*   `style` (`StyleProp | (() => StyleProp | undefined)`, optional): Standard style configuration.
*   `javaScriptEnabled` (`boolean`, optional): Enables JavaScript execution within the web context. Defaults to `true` dynamically on iOS.
*   `userAgent` (`string`, optional): Explicit fallback user agent.
*   `onLoadStart` (`(event: WebViewLoadEvent) => void`, optional): Triggered exactly when the load cycle initiates.
*   `onLoad` (`(event: WebViewLoadEvent) => void`, optional): Fired on successful load commitment.
*   `onLoadEnd` (`(event: WebViewLoadEvent) => void`, optional): Fired unconditionally when the load operation ends regardless of success or failure.
*   `onError` (`(event: WebViewErrorEvent) => void`, optional): Executes if standard page resolution faults or crashes.
*   `onMessage` (`(event: WebViewMessageEvent) => void`, optional): Listens to asynchronous calls passed upwards by `ZynthWebView.postMessage`.
*   `onNavigationStateChange` (`(event: WebViewLoadEvent) => void`, optional): Provides changes inside the DOM's back/forward browsing cache.
*   `onNativeReady` (`(event: WebViewNativeReadyEvent) => void`, optional): Reports when the native binding layer confirms capability.
*   `ref` (`(node: WebViewRef | null) => void`, optional): Receives a mutable reference instance exposing imperative navigation methods.

### `WebViewRef`

Underlying imperative API bindings mounted onto the node object.

**Methods**

*   `reload()`: Forcibly re-renders the current URL or source.
*   `goBack()`: Steps back chronologically in the local page browsing history.
*   `goForward()`: Moves forward inside the history.
*   `stopLoading()`: Immediately terminates connection handshakes and stops further resource rendering.
*   `injectJavaScript(script: string)`: Instantly commits raw JavaScript strings into the DOM.
*   `postMessage(message: string)`: Sends asynchronous data accessible inside the DOM's `message` event listener.
