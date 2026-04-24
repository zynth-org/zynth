import {
  createEffect,
  createMemo,
  createSignal,
  mergeProps,
  onCleanup,
  splitProps,
} from "solid-js";
import type { Component } from "solid-js";
import type { Style } from "@zynthjs/core";
import { Canvas, Skottie } from "./declarative";
import { createSkottie } from "./skottie";
import type { LayoutRectangle, SkiaSkottie, SkiaSkottieSource } from "./types";

export interface SkottieViewProps {
  /**
   * The source of the animation. Can be a JSON string, a URI object, or a base64 data object.
   */
  source: SkiaSkottieSource;
  /**
   * Current animation progress (0 to 1). If provided, internal playback is disabled.
   */
  progress?: number | (() => number);
  /**
   * Whether the animation should start playing automatically. Defaults to false.
   */
  autoPlay?: boolean;
  /**
   * Whether the animation should loop. Defaults to false.
   */
  loop?: boolean;
  /**
   * Playback speed multiplier. Defaults to 1.
   */
  speed?: number;
  /**
   * Styles for the underlying Canvas.
   */
  style?: Style;
  /**
   * Callback fired when the animation is successfully loaded.
   */
  onLoad?: (animation: SkiaSkottie) => void;
  /**
   * Callback fired if the animation fails to load.
   */
  onError?: (error: Error) => void;
}

/**
 * SkottieView is a standalone component for rendering Lottie animations using Skia's Skottie engine.
 * It provides a simplified API similar to LottieView in React Native.
 */
export const SkottieView: Component<SkottieViewProps> = (props) => {
  const merged = mergeProps({ autoPlay: false, loop: false, speed: 1 }, props);
  const [local] = splitProps(merged, [
    "source",
    "progress",
    "autoPlay",
    "loop",
    "speed",
    "style",
    "onLoad",
    "onError",
  ]);

  const animation = createSkottie(() => local.source, local.onError);
  const [internalProgress, setInternalProgress] = createSignal(0);
  const [layout, setLayout] = createSignal<LayoutRectangle | null>(null);

  createEffect(() => {
    const anim = animation();
    if (anim && local.onLoad) {
      local.onLoad(anim);
    }
  });

  createEffect(() => {
    // If progress is controlled externally, don't run internal playback
    if (local.progress !== undefined) return;
    if (!local.autoPlay) return;

    const anim = animation();
    if (!anim) return;

    const duration = anim.duration();
    if (duration <= 0) return;

    let startTime = Date.now();
    let frameHandle: number;

    const update = () => {
      const now = Date.now();
      const elapsed = (now - startTime) / 1000;
      const scaledElapsed = elapsed * local.speed;
      let progress = scaledElapsed / duration;

      if (local.loop) {
        if (progress >= 1) {
          // Reset start time to keep it smooth
          startTime = now - ((scaledElapsed % duration) / local.speed) * 1000;
          progress = progress % 1;
        }
      } else if (progress >= 1) {
        progress = 1;
      }

      setInternalProgress(progress);

      if (local.loop || progress < 1) {
        frameHandle = requestAnimationFrame(update);
      }
    };

    frameHandle = requestAnimationFrame(update);
    onCleanup(() => cancelAnimationFrame(frameHandle));
  });

  const currentProgress = () => {
    if (local.progress !== undefined) {
      return typeof local.progress === "function" ? local.progress() : local.progress;
    }
    return internalProgress();
  };

  const currentFrame = createMemo(() => {
    const anim = animation();
    if (!anim) return 0;
    const fps = anim.fps();
    const duration = anim.duration();
    const totalFrames = duration * fps;
    return currentProgress() * totalFrames;
  });

  return (
    <Canvas
      style={local.style}
      onLayout={(e) => setLayout(e.nativeEvent.layout)}
    >
      <Skottie
        animation={animation()}
        frame={currentFrame()}
        x={0}
        y={0}
        width={layout()?.width}
        height={layout()?.height}
      />
    </Canvas>
  );
};
