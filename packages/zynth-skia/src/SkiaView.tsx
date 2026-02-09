import { createEffect, mergeProps, onCleanup, splitProps } from "solid-js";
import type { ParentComponent } from "solid-js";
import type { HostNode } from "@zynth/core";
import { createSkiaSurface } from "./createSkiaSurface";
import type { SkiaViewProps } from "./types";

const noopRef = () => {};

export const SkiaView: ParentComponent<SkiaViewProps> = (props) => {
  const merged = mergeProps(
    {
      clearColor: "transparent",
      frameLoop: false,
    },
    props,
  );
  const [local] = splitProps(merged, [
    "style",
    "clearColor",
    "frameLoop",
    "commands",
    "ref",
    "onNativeReady",
  ]);

  const surface = createSkiaSurface();

  const setRef = (node: HostNode | null) => {
    surface.bind(node);
    if (node) {
      const commands = local.commands;
      const next = typeof commands === "function" ? commands() : commands;
      if (next) {
        surface.submit(next);
      }
      surface.setFrameLoopEnabled(Boolean(local.frameLoop));
    }
    (local.ref ?? noopRef)(node);
  };

  createEffect(() => {
    const commands = local.commands;
    const next = typeof commands === "function" ? commands() : commands;
    if (!next) return;
    surface.submit(next);
  });

  createEffect(() => {
    surface.setFrameLoopEnabled(Boolean(local.frameLoop));
  });

  onCleanup(() => {
    surface.dispose();
  });

  const onNativeReady = (event: { nativeEvent: { available: boolean } }) => {
    const commands = local.commands;
    const next = typeof commands === "function" ? commands() : commands;
    if (next) {
      surface.submit(next);
    }
    surface.setFrameLoopEnabled(Boolean(local.frameLoop));
    local.onNativeReady?.(event);
  };

  return (
    // @ts-ignore Custom native element
    <zynth-skia-view
      ref={setRef}
      style={local.style as any}
      clearColor={local.clearColor}
      frameLoop={local.frameLoop}
      onNativeReady={onNativeReady}
    />
  );
};
