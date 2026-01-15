/** @jsxImportSource solid-js */
import { createMemo, splitProps } from "solid-js";
import { registerComponent } from "@zynth/core";

const resolvePointerEvents = (value: string | undefined) => {
  if (value === "none") return "none";
  return "auto";
};

const effectStyle = (effect: string | undefined) => {
  switch (effect) {
    case "clear":
      return {
        "backdrop-filter": "blur(12px) saturate(160%)",
        "-webkit-backdrop-filter": "blur(12px) saturate(160%)",
        "background-color": "rgba(255, 255, 255, 0.08)",
      };
    case "none":
      return {
        "backdrop-filter": "none",
        "-webkit-backdrop-filter": "none",
        "background-color": "transparent",
      };
    default:
      return {
        "backdrop-filter": "blur(18px) saturate(180%)",
        "-webkit-backdrop-filter": "blur(18px) saturate(180%)",
        "background-color": "rgba(255, 255, 255, 0.18)",
      };
  }
};

export const GlassView = (props: any) => {
  const [local] = splitProps(props, [
    "style",
    "effect",
    "interactive",
    "tintColor",
    "pointerEvents",
    "class",
  ]);

  const baseStyle = createMemo(() => {
    const base: Record<string, any> = {
      ...effectStyle(local.effect),
      "pointer-events":
        local.interactive === false ? "none" : resolvePointerEvents(local.pointerEvents),
    };

    if (local.tintColor) {
      base["background-color"] = local.tintColor;
    }

    const s = local.style;
    if (Array.isArray(s)) {
      return Object.assign(base, ...s);
    }
    return Object.assign(base, s);
  });

  return (
    <div
      class={`zynth-glass-view${local.class ? ` ${local.class}` : ""}`}
      style={baseStyle()}
    >
      <span data-zynth-slot style="display: contents" />
    </div>
  );
};

registerComponent("glass-view", GlassView);
