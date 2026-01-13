/** @jsxImportSource solid-js */
import { registerComponent } from "@rune/core";

export const ProgressIndicator = (props: any) => {
  const size = () => (props.size === "large" ? "36px" : "20px");
  const color = () => props.color || "#8e8e93";

  return (
    <div
      style={{
        "display": "inline-flex",
        "align-items": "center",
        "justify-content": "center",
        "width": size(),
        "height": size(),
        ...props.style
      }}
    >
      <div
        style={{
          "width": "100%",
          "height": "100%",
          "border": "2px solid rgba(0, 0, 0, 0.1)",
          "border-top-color": color(),
          "border-radius": "50%",
          "box-sizing": "border-box",
          "animation": props.animating !== false ? "rune-spinner 0.75s linear infinite" : "none",
        }}
      />
      <style>
        {`@keyframes rune-spinner { 
          from { transform: rotate(0deg); } 
          to { transform: rotate(360deg); } 
        }`}
      </style>
    </div>
  );
};

registerComponent("progress-indicator", ProgressIndicator);
