/** @jsxImportSource solid-js */
import { createMemo, splitProps } from "solid-js";
import { registerComponent } from "@zynth/core";

export const Slider = (props: any) => {
  const [local, rest] = splitProps(props, [
    "value",
    "minimumValue",
    "maximumValue",
    "step",
    "disabled",
    "minimumTrackTintColor",
    "maximumTrackTintColor",
    "thumbTintColor",
    "onValueChange",
    "onSlidingComplete",
    "style",
    "class",
  ]);

  const handleInput = (e: Event) => {
    const val = Number((e.target as HTMLInputElement).value);
    local.onValueChange?.(val);
  };

  const handleChange = (e: Event) => {
    const val = Number((e.target as HTMLInputElement).value);
    local.onSlidingComplete?.(val);
  };

  const baseStyle = createMemo(() => {
    const s = local.style;
    const base: any = {
      width: "100%",
      cursor: local.disabled ? "not-allowed" : "pointer",
      opacity: local.disabled ? 0.5 : 1,
      accentColor: local.minimumTrackTintColor || "inherit",
    };

    if (Array.isArray(s)) {
      return Object.assign(base, ...s);
    }
    return Object.assign(base, s);
  });

  return (
    <input
      type="range"
      class={`zynth-slider${local.class ? ` ${local.class}` : ""}`}
      min={local.minimumValue ?? 0}
      max={local.maximumValue ?? 1}
      step={local.step || "any"}
      value={local.value ?? 0}
      disabled={local.disabled}
      onInput={handleInput}
      onChange={handleChange}
      style={baseStyle()}
      {...rest}
    />
  );
};

registerComponent("slider-view", Slider);
