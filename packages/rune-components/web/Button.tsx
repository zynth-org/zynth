/** @jsxImportSource solid-js */
import { createMemo, splitProps, JSX, Show } from "solid-js";
import { registerComponent } from "./utils";
import type { Style } from "@rune/core";

export type ButtonType = "button" | "submit";
export type Variant = "solid" | "outline" | "ghost" | "link";
export type Tone =
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "danger"
  | "neutral";
export type Size = "xs" | "sm" | "md" | "lg" | "xl";

export type ButtonProps = {
  children?: JSX.Element;
  label?: string;
  startIcon?: JSX.Element;
  endIcon?: JSX.Element;
  iconOnly?: boolean;
  type?: ButtonType;
  disabled?: boolean;
  loading?: boolean;
  variant?: Variant;
  tone?: Tone;
  size?: Size;
  fullWidth?: boolean;
  rounded?: "none" | "sm" | "md" | "lg" | "pill" | "full";
  onPress?: (event: { synthetic?: boolean }) => void;
  style?: Style | Style[];
  labelStyle?: Style | Style[];
  testID?: string;
  [key: string]: any;
};

const sizeMetrics: Record<
  Size,
  {
    minHeight: number;
    paddingH: number;
    paddingV: number;
    gap: number;
    fontSize: number;
  }
> = {
  xs: { minHeight: 32, paddingH: 10, paddingV: 6, gap: 6, fontSize: 13 },
  sm: { minHeight: 36, paddingH: 12, paddingV: 8, gap: 6, fontSize: 14 },
  md: { minHeight: 44, paddingH: 14, paddingV: 10, gap: 8, fontSize: 15 },
  lg: { minHeight: 52, paddingH: 16, paddingV: 12, gap: 10, fontSize: 16 },
  xl: { minHeight: 60, paddingH: 18, paddingV: 14, gap: 12, fontSize: 17 },
};

const toneColorMap: Record<Tone, string> = {
  primary: "#7c3aed",
  secondary: "#6366f1",
  success: "#16a34a",
  warning: "#f59e0b",
  danger: "#dc2626",
  neutral: "#4b5563",
};

const Button = (props: ButtonProps) => {
  const [local, rest] = splitProps(props, [
    "children",
    "label",
    "startIcon",
    "endIcon",
    "iconOnly",
    "type",
    "disabled",
    "loading",
    "variant",
    "tone",
    "size",
    "fullWidth",
    "rounded",
    "onPress",
    "style",
    "labelStyle",
    "testID",
    "class",
  ]);

  const resolvedVariant = createMemo(() => local.variant ?? "solid");
  const resolvedTone = createMemo(() => local.tone ?? "primary");
  const resolvedSize = createMemo(() => {
    // Map native sizes back to web sizes
    const s = local.size;
    if (s === "mini") return "xs";
    if (s === "small") return "sm";
    if (s === "medium") return "md";
    if (s === "large") return "lg";
    // Fallback if generic size is passed
    return (s as Size) ?? "md";
  });
  const resolvedRounded = createMemo(() => local.rounded ?? "md");

  const baseStyle = createMemo(() => {
    const color = toneColorMap[resolvedTone()];
    const variant = resolvedVariant();

    const style: any = {
      display: "inline-flex",
      cursor: local.disabled || local.loading ? "not-allowed" : "pointer",
      opacity: local.disabled || local.loading ? 0.6 : 1,
      border: "1px solid transparent",
      outline: "none",
      transition: "all 0.2s",
      "font-family": "inherit",
      "line-height": "1.2",
      "box-sizing": "border-box",
      "-webkit-tap-highlight-color": "transparent",
    };

    if (local.fullWidth) {
      style.width = "100%";
      style.display = "flex";
    }

    if (local.iconOnly) {
      // Square shape for icon-only is handled by the primitive's style
    }

    // Border Radius
    switch (resolvedRounded()) {
      case "none":
        style["border-radius"] = "0";
        break;
      case "sm":
        style["border-radius"] = "4px";
        break;
      case "md":
        style["border-radius"] = "8px";
        break;
      case "lg":
        style["border-radius"] = "12px";
        break;
      case "pill":
        style["border-radius"] = "9999px";
        break;
      case "full":
        style["border-radius"] = "9999px";
        break;
    }

    // Variant Styles
    switch (variant) {
      case "solid":
      case "filled": // Handle native variant mapping
        style["background-color"] = color;
        style.color = "white";
        break;
      case "outline":
      case "outlined":
        style["background-color"] = "transparent";
        style["border-color"] = color;
        style.color = color;
        break;
      case "ghost":
      case "text":
      case "link":
        style["background-color"] = "transparent";
        style.color = color;
        style.border = "none";
        break;
    }

    return style;
  });

  const mergedStyle = createMemo(() => {
    const s = local.style;
    const base = baseStyle();
    if (Array.isArray(s)) {
      return Object.assign({}, base, ...s);
    }
    return Object.assign({}, base, s);
  });

  const handleClick = (e: MouseEvent) => {
    if (local.disabled || local.loading) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    local.onPress?.({ synthetic: true });
  };

  return (
    <button
      type={local.type ?? "button"}
      style={mergedStyle()}
      disabled={local.disabled || local.loading}
      onClick={handleClick}
      data-testid={local.testID}
      class={`rune-button${local.class ? ` ${local.class}` : ""}`}
      {...rest}
    >
      <span data-rune-slot style="display: contents" />

      <Show when={local.loading && props.loadingIndicator !== null}>
        <span
          class="rune-button-spinner"
          style={{
            width: "1em",
            height: "1em",
            border: "2px solid currentColor",
            "border-right-color": "transparent",
            "border-radius": "50%",
            animation: "rune-spin 0.75s linear infinite",
            display: "inline-block",
            "margin-left": "8px",
          }}
        />
        <style>
          {`
            @keyframes rune-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            .rune-button:active:not(:disabled) { opacity: 0.75 !important; transform: scale(0.98); }
          `}
        </style>
      </Show>
      <Show when={!local.loading}>
        <style>
          {`.rune-button:active:not(:disabled) { opacity: 0.75 !important; transform: scale(0.98); }`}
        </style>
      </Show>
    </button>
  );
};

registerComponent("button", Button);
