/** @jsxImportSource solid-js */
import { createMemo, splitProps } from "solid-js";
import { registerComponent } from "@zynth/core";

export const Switch = (props: any) => {
  const [local, rest] = splitProps(props, [
    "value",
    "onValueChange",
    "disabled",
    "trackColor",
    "style",
    "class",
  ]);

  const toggle = () => {
    if (local.disabled) return;
    local.onValueChange?.(!local.value);
  };

  const containerStyle = createMemo(() => {
    const s = local.style;
    const base: any = {
      display: "inline-block",
      width: "51px",
      height: "31px",
      "background-color": local.value
        ? local.trackColor || "#34c759"
        : "#e9e9ea",
      "border-radius": "16px",
      position: "relative",
      cursor: local.disabled ? "not-allowed" : "pointer",
      opacity: local.disabled ? 0.5 : 1,
      transition: "background-color 0.2s",
    };

    if (Array.isArray(s)) {
      return Object.assign(base, ...s);
    }
    return Object.assign(base, s);
  });

  const thumbStyle = createMemo(() => ({
    width: "27px",
    height: "27px",
    "background-color": "white",
    "border-radius": "50%",
    position: "absolute",
    top: "2px",
    left: local.value ? "22px" : "2px",
    transition: "left 0.2s",
    "box-shadow": "0 3px 8px rgba(0,0,0,0.15)",
  }));

  return (
    <div
      class={`zynth-switch${local.class ? ` ${local.class}` : ""}`}
      style={containerStyle()}
      onClick={toggle}
      {...rest}
    >
      <div style={thumbStyle() as any} />
    </div>
  );
};

registerComponent("switch-view", Switch);
