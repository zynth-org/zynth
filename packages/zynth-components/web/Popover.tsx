/** @jsxImportSource solid-js */
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { registerComponent } from "@zynthjs/core";

type CommandPayload =
  | {
      type: "show";
      source?: "trigger" | "anchor" | "coordinates";
      x?: number;
      y?: number;
    }
  | {
      type: "dismiss";
    };

const Popover = (props: Record<string, unknown>) => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [position, setPosition] = createSignal({ top: 0, left: 0 });
  let triggerRef: HTMLDivElement | undefined;

  const resolvedOffsetX = () => {
    const value = props.offsetX;
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };

  const resolvedOffsetY = () => {
    const value = props.offsetY;
    return typeof value === "number" && Number.isFinite(value) ? value : 8;
  };

  const openFromTrigger = () => {
    if (!triggerRef) return;
    const rect = triggerRef.getBoundingClientRect();
    setPosition({
      top: rect.bottom + resolvedOffsetY(),
      left: rect.left + resolvedOffsetX(),
    });
    setIsOpen(true);
    if (typeof props.onOpen === "function") {
      (props.onOpen as () => void)();
    }
  };

  const openFromCoordinates = (x: number, y: number) => {
    setPosition({
      top: y + resolvedOffsetY(),
      left: x + resolvedOffsetX(),
    });
    setIsOpen(true);
    if (typeof props.onOpen === "function") {
      (props.onOpen as () => void)();
    }
  };

  const dismiss = () => {
    if (!isOpen()) return;
    setIsOpen(false);
    if (typeof props.onClose === "function") {
      (props.onClose as () => void)();
    }
  };

  const handleTriggerClick = (event: MouseEvent) => {
    event.stopPropagation();
    if (isOpen()) {
      dismiss();
      return;
    }
    openFromTrigger();
  };

  createEffect(() => {
    const command = props.__command as CommandPayload | undefined;
    if (!command) return;
    if (command.type === "dismiss") {
      dismiss();
      return;
    }
    if (
      command.type === "show" &&
      command.source === "coordinates" &&
      typeof command.x === "number" &&
      typeof command.y === "number"
    ) {
      openFromCoordinates(command.x, command.y);
      return;
    }
    openFromTrigger();
  });

  createEffect(() => {
    if (!isOpen()) return;
    const close = () => dismiss();
    window.addEventListener("click", close);
    onCleanup(() => {
      window.removeEventListener("click", close);
    });
  });

  return (
    <div style="display: contents;">
      <div ref={triggerRef} style="display: inline-block;" onClick={handleTriggerClick}>
        <span data-zynth-slot="trigger" style="display: contents;" />
      </div>
      <Show when={isOpen()}>
        <div
          style={{
            position: "fixed",
            top: `${position().top}px`,
            left: `${position().left}px`,
            "z-index": "10000",
            "background-color":
              typeof props.surfaceColor === "string" ? props.surfaceColor : "#fef7ff",
            "border-radius":
              typeof props.cornerRadius === "number"
                ? `${props.cornerRadius}px`
                : "16px",
            "box-shadow":
              typeof props.elevation === "number"
                ? `0 ${Math.max(props.elevation / 2, 2)}px ${Math.max(
                    props.elevation * 1.5,
                    8
                  )}px rgba(0,0,0,0.18)`
                : "0 8px 20px rgba(0,0,0,0.18)",
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <span data-zynth-slot="content" style="display: contents;" />
        </div>
      </Show>
    </div>
  );
};

registerComponent("popover-view", Popover);
registerComponent("popover-trigger-view", (props) => (
  <div data-zynth-slot="trigger" style="display: contents;" {...props} />
));
registerComponent("popover-content-view", (props) => (
  <div data-zynth-slot="content" style="display: contents;" {...props} />
));
