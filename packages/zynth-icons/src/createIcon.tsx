import { createSignal, onMount, onCleanup, createComponent } from "solid-js";
import { Text, TextProps, createStyle } from "@zynthjs/components";
import { Font, platform } from "@zynthjs/apis";

// Track font loading state globally
const fontLoadState = new Map<string, "loading" | "loaded" | "error">();
const fontLoadPromises = new Map<string, Promise<void>>();
const fontLoadListeners = new Map<string, Set<() => void>>();

type WebFontSources = Record<string, string>;

function ensureWebFontSource(fontFamily: string) {
  if (typeof document === "undefined") {
    return;
  }

  const docBase = (document as Document).baseURI || "";
  const baseUrl = docBase.startsWith("http") ? docBase : import.meta.url || "";
  if (!baseUrl) {
    return;
  }

  const globalObj = globalThis as Record<string, unknown>;
  const existingSources = globalObj.__zynth_web_font_sources;
  const sources =
    existingSources !== null && typeof existingSources === "object"
      ? (existingSources as WebFontSources)
      : ((globalObj.__zynth_web_font_sources = {}) as WebFontSources);

  if (!sources[fontFamily]) {
    sources[fontFamily] = new URL(
      `../assets/fonts/${fontFamily}.ttf`,
      baseUrl,
    ).toString();
  }
}

function loadFont(fontFamily: string): Promise<void> {
  ensureWebFontSource(fontFamily);
  const state = fontLoadState.get(fontFamily);

  if (state === "loaded") {
    return Promise.resolve();
  }

  if (state === "loading") {
    return fontLoadPromises.get(fontFamily)!;
  }

  fontLoadState.set(fontFamily, "loading");

  const resourceName = `${fontFamily}.ttf`;
  const promise = Font.loadAsync(fontFamily, resourceName)
    .then(() => {
      fontLoadState.set(fontFamily, "loaded");
      const listeners = fontLoadListeners.get(fontFamily);
      if (listeners) {
        listeners.forEach((cb) => cb());
      }
    })
    .catch((error: unknown) => {
      fontLoadState.set(fontFamily, "error");
      throw error;
    });

  fontLoadPromises.set(fontFamily, promise);
  return promise;
}

function subscribeToFont(fontFamily: string, callback: () => void): () => void {
  let listeners = fontLoadListeners.get(fontFamily);
  if (!listeners) {
    listeners = new Set();
    fontLoadListeners.set(fontFamily, listeners);
  }
  listeners.add(callback);
  return () => listeners!.delete(callback);
}

function shouldLoadFontAtRuntime(): boolean {
  return platform.current !== "ios";
}

export function createIcon(glyph: string, fontFamily: string) {
  if (shouldLoadFontAtRuntime()) {
    loadFont(fontFamily).catch(() => {});
  } else if (!fontLoadState.has(fontFamily)) {
    fontLoadState.set(fontFamily, "loaded");
  }

  return (props: TextProps) => {
    const [fontRevision, setFontRevision] = createSignal(0);

    onMount(() => {
      if (!shouldLoadFontAtRuntime()) {
        return;
      }

      let cancelled = false;

      const bumpFontRevision = () => {
        if (cancelled) return;
        setFontRevision((value) => value + 1);
      };

      const unsubscribe = subscribeToFont(fontFamily, bumpFontRevision);

      loadFont(fontFamily)
        .then(bumpFontRevision)
        .catch(() => {});

      onCleanup(() => {
        cancelled = true;
        unsubscribe();
      });
    });

    const mergedStyle = createStyle(() => {
      const nextStyle = props.style;
      return typeof nextStyle === "function" ? nextStyle() : nextStyle;
    });

    return createComponent(Text, {
      ...props,
      get text() {
        return glyph;
      },
      get style() {
        fontRevision();
        const base = mergedStyle() || {};
        return {
          ...base,
          fontFamily,
          height:
            platform.current === "android"
              ? base.fontSize || 16
              : base.height,
        };
      },
    });
  };
}
