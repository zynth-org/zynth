import { createSignal, createEffect, createComponent, merge } from "solid-js";
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
    // NOTE: `props` is a SolidJS reactive proxy — do NOT destructure or spread.
    // `merge` keeps every source prop tracked; the trailing sources win.
    const resolvedStyle = createStyle(() => {
      const nextStyle = props.style;
      return typeof nextStyle === "function" ? nextStyle() : nextStyle;
    });

    const resolveHeight = () => {
      const base = resolvedStyle();
      return platform.current === "android"
        ? (base?.fontSize as number | undefined) || 16
        : base?.height;
    };

    if (!shouldLoadFontAtRuntime()) {
      return createComponent(
        Text,
        merge(props, {
          get text() {
            return glyph;
          },
          get style() {
            return {
              ...(resolvedStyle() || {}),
              fontFamily,
              height: resolveHeight(),
            };
          },
        }) as TextProps
      );
    }

    const [isReady, setIsReady] = createSignal(Font.isLoaded(fontFamily), {
      ownedWrite: true,
    });

    // Solid 2.0: mandatory 2-arg form. The compute tracks nothing reactive on
    // purpose — it runs once to attach native listeners; the apply callback
    // owns setup and returns its cleanup instead of using onCleanup.
    createEffect(
      () => Font.isLoaded(fontFamily),
      (loaded) => {
        if (loaded) {
          setIsReady(true);
          return;
        }

        let cancelled = false;

        const markReady = () => {
          if (!cancelled) setIsReady(true);
        };

        const unsubscribe = Font.subscribe(fontFamily, markReady);

        loadFont(fontFamily)
          .then(markReady)
          .catch(() => {});

        return () => {
          cancelled = true;
          unsubscribe();
        };
      }
    );

    return createComponent(
      Text,
      merge(props, {
        get text() {
          return isReady() ? glyph : " ";
        },
        get style() {
          return {
            ...(resolvedStyle() || {}),
            fontFamily: isReady() ? fontFamily : resolvedStyle()?.fontFamily,
            height: resolveHeight(),
          };
        },
      }) as TextProps
    );
  };
}
