import { createEffect, createSignal, mergeProps, onCleanup, splitProps } from "solid-js";
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
  const [boundVersion, setBoundVersion] = createSignal(0);

  const setRef = (node: HostNode | null) => {
    surface.bind(node);
    if (node) {
      setBoundVersion((value) => value + 1);
      surface.setFrameLoopEnabled(Boolean(local.frameLoop));
    }
    (local.ref ?? noopRef)(node);
  };

  createEffect(() => {
    boundVersion();
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
