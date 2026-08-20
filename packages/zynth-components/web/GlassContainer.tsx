/** @jsxImportSource solid-js */
import { createMemo } from "solid-js";
import { registerComponent } from "@zynthjs/core";

const resolvePointerEvents = (value: string | undefined) => {
  if (value === "none") return "none";
  return "auto";
};

export const GlassContainer = (props: any) => {
  const local = props;

  const baseStyle = createMemo(() => {
    const base: Record<string, any> = {
      display: "flex",
      "flex-direction": "column",
      gap: local.spacing ?? undefined,
      "pointer-events": resolvePointerEvents(local.pointerEvents),
      "backdrop-filter": "blur(18px) saturate(180%)",
      "-webkit-backdrop-filter": "blur(18px) saturate(180%)",
      "background-color": "rgba(255, 255, 255, 0.12)",
    };

    const s = local.style;
    if (Array.isArray(s)) {
      return Object.assign(base, ...s);
    }
    return Object.assign(base, s);
  });

  return (
    <div
      class={`zynth-glass-container${local.class ? ` ${local.class}` : ""}`}
      style={baseStyle()}
    >
      <span data-zynth-slot style="display: contents" />
    </div>
  );
};

registerComponent("glass-container", GlassContainer);
