/** @jsxImportSource solid-js */
import {
  createSignal,
  createEffect,
  For,
  Show,
  onCleanup,
  createMemo,
} from "solid-js";
import { registerComponent } from "./utils";

export const Menu = (props: any) => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [position, setPosition] = createSignal({ top: 0, left: 0, width: 0 });
  let triggerRef: HTMLDivElement | undefined;

  const toggle = (e: MouseEvent) => {
    e.stopPropagation();
    if (isOpen()) {
      setIsOpen(false);
      props.onClose?.();
    } else {
      if (triggerRef) {
        const rect = triggerRef.getBoundingClientRect();
        setPosition({
          top: rect.bottom,
          left: rect.left,
          width: rect.width,
        });
      }
      setIsOpen(true);
      props.onOpen?.();
    }
  };

  const close = () => {
    if (isOpen()) {
      setIsOpen(false);
      props.onClose?.();
    }
  };

  createEffect(() => {
    if (isOpen()) {
      window.addEventListener("click", close);
      window.addEventListener("rune-menu-close", close);
      onCleanup(() => {
        window.removeEventListener("click", close);
        window.removeEventListener("rune-menu-close", close);
      });
    }
  });

  return (
    <div style="display: contents">
      <div
        ref={triggerRef}
        style="display: inline-block; cursor: pointer;"
        onClick={toggle}
      >
        <span data-rune-slot="trigger" style="display: contents" />
      </div>

      {/* Persistent Menu Container to hold slots even when hidden */}
      <div
        style={{
          display: isOpen() ? "block" : "none",
          position: "fixed",
          top: `${position().top + 4}px`,
          left: `${position().left}px`,
          "min-width": "160px",
          width: "max-content",
          "background-color": "white",
          "border-radius": "8px",
          "box-shadow": "0 4px 12px rgba(0,0,0,0.15)",
          "z-index": "10000",
          padding: "4px 0",
          overflow: "hidden",
          animation: isOpen() ? "rune-menu-fade 0.15s ease-out" : "none",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <span data-rune-slot="items" style="display: contents" />
      </div>

      <style>
        {`@keyframes rune-menu-fade { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }`}
      </style>
    </div>
  );
};

export const MenuItem = (props: any) => {
  let itemRef: HTMLDivElement | undefined;

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (props.disabled) return;
    props.onPress?.();
    // Dispatch event to parent to close menu
    e.target?.dispatchEvent(
      new CustomEvent("rune-menu-close", { bubbles: true })
    );
  };

  // Ensure the host element (rune-web-host) doesn't capture dimensions or hide
  createEffect(() => {
    if (itemRef && itemRef.parentElement) {
      const host = itemRef.parentElement;
      if (host.tagName === "RUNE-WEB-HOST") {
        host.style.display = "contents";
      }
    }
  });

  const filteredStyle = createMemo(() => {
    const s = { ...props.style };
    // Filter out styles that are specifically used to hide the component in the primitive/native
    // Note: these are already normalized to kebab-case by utils.tsx
    delete s["display"];
    delete s["position"];
    delete s["width"];
    delete s["height"];
    delete s["opacity"];
    delete s["pointer-events"];
    return s;
  });

  return (
    <div
      ref={itemRef}
      onClick={handleClick}
      style={{
        padding: "10px 16px",
        display: "flex",
        "align-items": "center",
        gap: "12px",
        cursor: props.disabled ? "not-allowed" : "pointer",
        opacity: props.disabled ? 0.5 : 1,
        "background-color": "transparent",
        transition: "background-color 0.1s",
        color: props.destructive ? "#ff3b30" : "inherit",
        "font-size": "14px",
        ...filteredStyle(),
      }}
      onMouseEnter={(e) => {
        if (!props.disabled) e.currentTarget.style.backgroundColor = "#f5f5f5";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      <Show when={props.children}>
        <div style="display: flex; align-items: center; justify-content: center; width: 20px;">
          {props.children}
        </div>
      </Show>
      <span style="flex: 1">{props.label}</span>
    </div>
  );
};

registerComponent("menu-view", Menu);
registerComponent("menu-trigger-view", (props) => (
  <div data-rune-slot="trigger" style="display: contents" {...props} />
));
registerComponent("menu-item-view", MenuItem);
