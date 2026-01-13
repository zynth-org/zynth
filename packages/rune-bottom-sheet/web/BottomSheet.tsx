/** @jsxImportSource solid-js */
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  splitProps,
  type JSX,
  type ParentComponent,
} from "solid-js";
import { registerComponent } from "@rune/core";
import { createBottomSheetController } from "../src/BottomSheet";

// Inject CSS for BottomSheet
if (
  typeof document !== "undefined" &&
  !document.getElementById("rune-bottom-sheet-styles")
) {
  const style = document.createElement("style");
  style.id = "rune-bottom-sheet-styles";
  style.textContent = `
    .rune-bottom-sheet-overlay {
      position: absolute;
      inset: 0;
      background-color: black;
      opacity: 0;
      transition: opacity 0.3s ease;
      pointer-events: none;
      z-index: 0;
    }
    .rune-bottom-sheet-overlay[data-open="true"] {
      opacity: 0.45;
      pointer-events: auto;
    }

    .rune-bottom-sheet-container {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      top: 0;
      pointer-events: none;
      z-index: 1;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      overflow: hidden;
    }

    .rune-bottom-sheet-content {
      width: 100%;
      background-color: white;
      border-top-left-radius: 16px;
      border-top-right-radius: 16px;
      box-shadow: 0 -2px 10px rgba(0,0,0,0.1);
      transform: translateY(100%);
      transition: transform 0.3s cubic-bezier(0.33, 1, 0.68, 1);
      pointer-events: auto;
      max-height: 90%;
      display: flex;
      flex-direction: column;
    }
    
    .rune-bottom-sheet-content[data-open="true"] {
      transform: translateY(0);
    }

    .rune-bottom-sheet-handle {
      width: 40px;
      height: 4px;
      background-color: #e5e7eb;
      border-radius: 2px;
      margin: 12px auto;
      flex-shrink: 0;
    }
  `;
  document.head.appendChild(style);
}

export const BottomSheet: ParentComponent<any> = (props) => {
  const [local, others] = splitProps(props, [
    "children",
    "open",
    "defaultOpen",
    "onOpenChange",
    "onDismiss",
    "overlayColor",
    "overlayOpacity",
    "snapPoints",
    "initialSnapIndex",
    "controller",
    "dismissOnOverlayPress",
  ]);

  const [isOpen, setIsOpen] = createSignal(
    local.open !== undefined ? local.open : local.defaultOpen ?? false
  );

  createEffect(() => {
    if (local.open !== undefined) {
      setIsOpen(local.open);
    }
  });

  const handleOverlayClick = () => {
    if (local.dismissOnOverlayPress !== false) {
      if (local.open === undefined) {
        setIsOpen(false);
      }
      local.onOpenChange?.(false);
      local.onDismiss?.();
    }
  };

  const overlayStyle = createMemo<JSX.CSSProperties>(() => ({
    "background-color": local.overlayColor ?? "black",
    opacity: isOpen() ? (local.overlayOpacity ?? 0.45) : 0,
    "pointer-events": isOpen() ? "auto" : "none",
  }));

  // Resolve snap points (simple version for now: max height)
  const resolvedSnapHeight = createMemo(() => {
    const points = local.snapPoints ?? ["50%"];
    const maxPoint = points[points.length - 1];
    if (typeof maxPoint === "number") return `${maxPoint}px`;
    return maxPoint;
  });

  const contentStyle = createMemo<JSX.CSSProperties>(() => ({
    height: resolvedSnapHeight(),
    transform: isOpen() ? "translateY(0)" : "translateY(100%)",
  }));

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        "pointer-events": "none",
        "z-index": 100,
        display: isOpen() || others.style?.display !== "none" ? "block" : "none",
      }}
    >
      <div
        class="rune-bottom-sheet-overlay"
        style={overlayStyle()}
        onClick={handleOverlayClick}
      />
      <div class="rune-bottom-sheet-container">
        <div
          class="rune-bottom-sheet-content"
          style={contentStyle()}
          data-open={isOpen() ? "true" : "false"}
        >
          <div class="rune-bottom-sheet-handle" />
          <div style={{ flex: 1, overflow: "auto", display: "flex", "flex-direction": "column" }}>
            <span data-rune-slot style="display: contents" />
          </div>
        </div>
      </div>
    </div>
  );
};

// Also export the controller creator for consistency
export { createBottomSheetController };

registerComponent("rune-bottom-sheet", BottomSheet);
