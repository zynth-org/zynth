import { createSignal, onMount, onCleanup } from "solid-js";
import { Text, TextProps } from "@rune/components";
import { Font } from "@rune/apis";

// Track font loading state globally
const fontLoadState = new Map<string, "loading" | "loaded" | "error">();
const fontLoadPromises = new Map<string, Promise<void>>();
const fontLoadListeners = new Map<string, Set<() => void>>();

function loadFont(fontFamily: string): Promise<void> {
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
      // Notify all listeners that font is ready
      const listeners = fontLoadListeners.get(fontFamily);
      if (listeners) {
        listeners.forEach((cb) => cb());
      }
    })
    .catch((err) => {
      fontLoadState.set(fontFamily, "error");
      console.log(
        `Failed to load icon font ${fontFamily}:`,
        JSON.stringify(err)
      );
      throw err;
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

export function createIcon(glyph: string, fontFamily: string) {
  // Eagerly start loading at module init time
  loadFont(fontFamily);

  return (props: TextProps) => {
    const [isReady, setIsReady] = createSignal(
      fontLoadState.get(fontFamily) === "loaded"
    );

    onMount(() => {
      // If already loaded, we're good (initialized to true)
      if (fontLoadState.get(fontFamily) === "loaded") {
        return;
      }

      let cancelled = false;

      const checkAndSetReady = () => {
        if (cancelled) return;
        // Use double requestAnimationFrame to ensure we're past the next paint
        // This gives the native side ample time to update the FontRegistry
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!cancelled) {
              setIsReady(true);
            }
          });
        });
      };

      // Subscribe to font load completion
      const unsubscribe = subscribeToFont(fontFamily, checkAndSetReady);

      // Ensure loading is triggered
      loadFont(fontFamily)
        .then(checkAndSetReady)
        .catch(() => {});

      onCleanup(() => {
        cancelled = true;
        unsubscribe();
      });
    });

    // Always render the same Text element to avoid layout thrashing
    // Use a space character as placeholder until font is ready
    // This maintains proper text composition in the native layer
    return (
      <Text
        {...props}
        style={{
          ...(props.style as object),
          fontFamily: isReady() ? fontFamily : undefined,
        }}
      >
        {isReady() ? glyph : " "}
      </Text>
    );
  };
}
