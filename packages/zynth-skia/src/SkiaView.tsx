import { createEffect, createSignal, mergeProps, onCleanup, splitProps } from "solid-js";
import type { ParentComponent } from "solid-js";
import type { HostNode } from "@zynth/core";
import { createSkiaSurface } from "./createSkiaSurface";
import type { SkiaDrawCommand, SkiaViewProps } from "./types";

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
  let pendingCommands: SkiaDrawCommand[] | null = null;
  let flushHandle: number | null = null;
  let flushScheduled = false;

  const cancelFlush = () => {
    if (flushHandle == null) return;
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(flushHandle);
    } else if (typeof clearTimeout === "function") {
      clearTimeout(flushHandle as any);
    }
    flushHandle = null;
    flushScheduled = false;
  };

  const scheduleFlush = () => {
    if (flushScheduled) return;
    flushScheduled = true;
    const run = () => {
      flushScheduled = false;
      flushHandle = null;
      const commands = pendingCommands;
      if (!commands) return;
      surface.submit(commands);
    };
    if (typeof requestAnimationFrame === "function") {
      flushHandle = requestAnimationFrame(run);
      return;
    }
    if (typeof setTimeout === "function") {
      flushHandle = setTimeout(run, 16) as unknown as number;
      return;
    }
    run();
  };

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
    pendingCommands = next;
    scheduleFlush();
  });

  createEffect(() => {
    surface.setFrameLoopEnabled(Boolean(local.frameLoop));
  });

  onCleanup(() => {
    cancelFlush();
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
