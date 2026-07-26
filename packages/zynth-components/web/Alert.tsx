/** @jsxImportSource solid-js */
import { createSignal, createEffect, For, Show, createMemo } from "solid-js";
import { registerComponent } from "@zynthjs/core";

export const Alert = (props: any) => {
  const [visible, setVisible] = createSignal(false);
  
  const buttons = createMemo(() => {
    try {
      return props.buttons ? JSON.parse(props.buttons) : [];
    } catch (e) {
      return [];
    }
  });

  createEffect(
    () => props.__command,
    (cmd) => {
      if (!cmd) return;
      try {
        const parsed = JSON.parse(cmd);
        if (parsed.type === "show") setVisible(true);
        if (parsed.type === "dismiss") {
          setVisible(false);
          props.onDismiss?.();
        }
      } catch (e) {
        // ignore
      }
    }
  );

  const handleButtonPress = (index: number) => {
    props.onButtonPress?.({ index });
    setVisible(false);
    props.onDismiss?.();
  };

  return (
    <Show when={visible()}>
      <div 
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          "background-color": "rgba(0,0,0,0.4)",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "z-index": 1000,
        }}
      >
        <div 
          style={{
            "background-color": "white",
            "border-radius": "14px",
            width: "270px",
            overflow: "hidden",
            display: "flex",
            "flex-direction": "column",
            "text-align": "center",
            "box-shadow": "0 10px 25px rgba(0,0,0,0.2)",
            animation: "zynth-alert-pop 0.2s ease-out"
          }}
        >
          <div style={{ padding: "20px 16px" }}>
            <Show when={props.title}>
              <div style={{ "font-weight": "600", "font-size": "17px", "margin-bottom": "4px" }}>
                {props.title}
              </div>
            </Show>
            <Show when={props.message}>
              <div style={{ "font-size": "13px", "line-height": "1.4" }}>
                {props.message}
              </div>
            </Show>
          </div>
          
          <div style={{ 
            display: "flex", 
            "border-top": "1px solid #e0e0e0",
            "flex-direction": buttons().length > 2 ? "column" : "row"
          }}>
            <For each={buttons()}>
              {(btn, index) => (
                <button
                  onClick={() => handleButtonPress(index())}
                  style={{
                    flex: 1,
                    padding: "12px",
                    border: "none",
                    background: "none",
                    "font-size": "17px",
                    cursor: "pointer",
                    color: btn.style === "destructive" ? "#ff3b30" : "#007aff",
                    "font-weight": btn.style === "cancel" ? "600" : "400",
                    "border-left": index() > 0 && buttons().length <= 2 ? "1px solid #e0e0e0" : "none",
                    "border-top": index() > 0 && buttons().length > 2 ? "1px solid #e0e0e0" : "none",
                  }}
                >
                  {btn.text}
                </button>
              )}
            </For>
          </div>
        </div>
        <style>
          {`@keyframes zynth-alert-pop { 
              from { transform: scale(1.1); opacity: 0; } 
              to { transform: scale(1); opacity: 1; } 
            }`}
        </style>
      </div>
    </Show>
  );
};

registerComponent("zynth-alert", Alert);
