import { createSignal, createEffect, onCleanup, createComponent } from "solid-js";
import { Text, TextProps, createStyle } from "@zynthjs/components";
import { Font, platform } from "@zynthjs/apis";

function loadFont(fontFamily: string): Promise<void> {
  return Font.ensureLoaded(fontFamily, { resourceName: `${fontFamily}.ttf` });
}

function shouldLoadFontAtRuntime(): boolean {
  return platform.current === "web";
}

export function createIcon(glyph: string, fontFamily: string) {
  if (shouldLoadFontAtRuntime()) {
    loadFont(fontFamily).catch(() => {});
  }

  return (props: TextProps) => {
    const mergedStyle = createStyle(() => {
      const nextStyle = props.style;
      return typeof nextStyle === "function" ? nextStyle() : nextStyle;
    });

    if (!shouldLoadFontAtRuntime()) {
      return createComponent(Text, {
        ...props,
        get text() {
          return glyph;
        },
        get style() {
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
    }

    const [isReady, setIsReady] = createSignal(
      Font.isLoaded(fontFamily)
    );

    createEffect(() => {
      if (Font.isLoaded(fontFamily)) {
        setIsReady(true);
        return;
      }

      let cancelled = false;

      const markReady = () => {
        if (cancelled) return;
        setIsReady(true);
      };

      const unsubscribe = Font.subscribe(fontFamily, markReady);

      loadFont(fontFamily)
        .then(markReady)
        .catch(() => {});

      onCleanup(() => {
        cancelled = true;
        unsubscribe();
      });
    });

    return createComponent(Text, {
      ...props,
      get text() {
        return isReady() ? glyph : " ";
      },
      get style() {
        const base = mergedStyle() || {};
        return {
          ...base,
          fontFamily: isReady() ? fontFamily : base.fontFamily,
          height:
            platform.current === "android"
              ? base.fontSize || 16
              : base.height,
        };
      },
    });
  };
}
