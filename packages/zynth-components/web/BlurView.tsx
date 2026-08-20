/** @jsxImportSource solid-js */
import { createMemo } from "solid-js";
import { registerComponent } from "@zynthjs/core";

const resolvePointerEvents = (value: string | undefined) => {
  if (value === "none") return "none";
  return "auto";
};

const clampIntensity = (value: unknown) => {
  if (typeof value !== "number" || Number.isNaN(value)) return 20;
  return Math.max(0, Math.min(100, value));
};

const resolveTintBackground = (tint: string | undefined, variant: string | undefined) => {
  const isGlass = variant === "glass";
  switch (tint) {
    case "light":
      return isGlass ? "rgba(255, 255, 255, 0.20)" : "rgba(255, 255, 255, 0.14)";
    case "dark":
      return isGlass ? "rgba(8, 15, 28, 0.28)" : "rgba(12, 18, 30, 0.18)";
    default:
      return isGlass ? "rgba(255, 255, 255, 0.16)" : "rgba(255, 255, 255, 0.10)";
  }
};

export const BlurView = (props: any) => {
  const local = props;

  const baseStyle = createMemo(() => {
    const intensity = clampIntensity(local.blurIntensity);
    const saturation = local.blurVariant === "glass" ? 180 : 140;
    const backgroundColor =
      local.tintColor ?? resolveTintBackground(local.blurTint, local.blurVariant);
    const base: Record<string, any> = {
      "backdrop-filter": `blur(${intensity}px) saturate(${saturation}%)`,
      "-webkit-backdrop-filter": `blur(${intensity}px) saturate(${saturation}%)`,
      "background-color": backgroundColor,
      "pointer-events": resolvePointerEvents(local.pointerEvents),
    };

    const s = local.style;
    if (Array.isArray(s)) {
      return Object.assign(base, ...s);
    }
    return Object.assign(base, s);
  });

  return (
    <div
      class={`zynth-blur-view${local.class ? ` ${local.class}` : ""}`}
      data-interactive={local.interactive === true ? "true" : undefined}
      style={baseStyle()}
    >
      <span data-zynth-slot style="display: contents" />
    </div>
  );
};

registerComponent("blur-view", BlurView);
