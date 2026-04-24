/** @jsxImportSource solid-js */
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type JSX,
} from "solid-js";
import { registerComponent } from "@zynthjs/core";

const DEFAULT_ANIMATION = "fade";
const DEFAULT_OVERLAY_COLOR = "#000000";
const DEFAULT_OVERLAY_OPACITY = 0.45;
const ANIMATION_DURATION_MS = 200;

export const Modal = (props: any) => {
  const [isOpen, setIsOpen] = createSignal(!!props.open);
  const [lastOpen, setLastOpen] = createSignal(!!props.open);
  const [activeAnimation, setActiveAnimation] = createSignal(
    props.animation ?? DEFAULT_ANIMATION
  );
  const [isAnimatingOpen, setIsAnimatingOpen] = createSignal(!!props.open);
  const [isClosing, setIsClosing] = createSignal(false);
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let contentRef: HTMLDivElement | undefined;

  const resolvedTransparent = createMemo(() => !!props.transparent);
  const resolvedOverlayColor = createMemo(
    () => props.overlayColor ?? DEFAULT_OVERLAY_COLOR
  );
  const resolvedOverlayOpacity = createMemo(
    () => props.overlayOpacity ?? DEFAULT_OVERLAY_OPACITY
  );
  const resolvedDismissOnOverlayPress = createMemo(
    () => props.dismissOnOverlayPress ?? true
  );
  const isControlled = () => props.open !== undefined;

  const clearCloseTimer = () => {
    if (!closeTimer) return;
    clearTimeout(closeTimer);
    closeTimer = null;
    setIsClosing(false);
  };

  const startOpen = () => {
    clearCloseTimer();
    const nextAnim = props.animation ?? DEFAULT_ANIMATION;
    setActiveAnimation(nextAnim);
    setIsOpen(true);
    setIsAnimatingOpen(false);
    setIsClosing(false);

    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsAnimatingOpen(true));
      });
    } else {
      setTimeout(() => setIsAnimatingOpen(true), 16);
    }
  };

  const startClose = () => {
    clearCloseTimer();
    setIsAnimatingOpen(false);
    setIsClosing(true);

    if (activeAnimation() === "none") {
      setIsOpen(false);
      setIsClosing(false);
      return;
    }

    closeTimer = setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
      closeTimer = null;
    }, ANIMATION_DURATION_MS);
  };

  createEffect(() => {
    if (props.open === undefined) return;
    const next = !!props.open;
    const prev = lastOpen();
    if (prev && !next) {
      props.onDismiss?.();
    }
    if (next) startOpen();
    else startClose();
    setLastOpen(next);
  });

  onCleanup(() => clearCloseTimer());

  const applyOpenChange = (nextOpen: boolean) => {
    if (!isControlled()) {
      if (nextOpen) startOpen();
      else startClose();
    }
    props.onOpenChange?.({ open: nextOpen });
    if (!nextOpen && !isControlled()) {
      props.onDismiss?.();
    }
  };

  createEffect(() => {
    const cmd = props.__command;
    if (!cmd) return;
    try {
      const parsed = typeof cmd === "string" ? JSON.parse(cmd) : cmd;
      if (parsed?.type === "show") {
        applyOpenChange(true);
      }
      if (parsed?.type === "dismiss") {
        applyOpenChange(false);
      }
    } catch (e) {
      // ignore
    }
  });

  createEffect(() => {
    if (!isOpen()) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      props.onRequestClose?.();
      applyOpenChange(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown);
    });
  });

  const handleRootClick = (event: MouseEvent) => {
    if (!resolvedDismissOnOverlayPress()) return;
    const target = event.target as Node | null;
    if (contentRef && target && target instanceof HTMLElement) {
      const boxNoneTarget = target.closest('[pointerevents="box-none"]');
      if (boxNoneTarget && boxNoneTarget === target) {
        props.onRequestClose?.();
        applyOpenChange(false);
        return;
      }
      if (contentRef.contains(target)) return;
    }
    props.onRequestClose?.();
    applyOpenChange(false);
  };

  const rootStyle = createMemo<JSX.CSSProperties>(() => ({
    position: "fixed",
    inset: "0",
    "z-index": 10000,
    visibility: isOpen() || isClosing() ? "visible" : "hidden",
    opacity: isOpen() || isClosing() ? 1 : 0,
    "pointer-events": isOpen() ? ("auto" as const) : ("none" as const),
  }));

  const overlayStyle = createMemo<JSX.CSSProperties>(() => ({
    position: "absolute",
    inset: "0",
    "background-color": resolvedOverlayColor(),
    opacity: isAnimatingOpen()
      ? resolvedTransparent()
        ? 0
        : resolvedOverlayOpacity()
      : 0,
    transition:
      activeAnimation() === "none" || (!isAnimatingOpen() && !isClosing())
        ? "none"
        : "opacity 0.2s ease",
  }));

  const contentBaseStyle = createMemo<JSX.CSSProperties>(() => ({
    position: "absolute",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    display: "flex",
    "flex-direction": "column",
    ...props.style,
  }));

  const contentMotionStyle = createMemo<JSX.CSSProperties>(() => {
    const animation = activeAnimation();
    if (animation === "none") {
      return {
        opacity: 1,
        transform: "none",
      };
    }
    let transform = "translateY(0)";
    if (!isAnimatingOpen()) {
      if (animation === "slide") transform = "translateY(24px)";
      if (animation === "zoom") transform = "scale(0.96)";
    }
    return {
      opacity: isAnimatingOpen() ? 1 : 0,
      transform,
      transition:
        !isAnimatingOpen() && !isClosing()
          ? "none"
          : "opacity 0.2s ease, transform 0.2s ease",
    };
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-hidden={isOpen() ? "false" : "true"}
      data-testid={props.testID}
      style={rootStyle()}
      onClick={handleRootClick}
    >
      <div style={overlayStyle()} />

      <div style={contentMotionStyle()}>
        <div style={contentBaseStyle()}>
          <div ref={contentRef} style="display: contents">
            <span data-zynth-slot style="display: contents" />
          </div>
        </div>
      </div>
    </div>
  );
};

registerComponent("zynth-modal", Modal);
