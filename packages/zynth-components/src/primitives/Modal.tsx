import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type ParentComponent,
  type Element as SolidElement,
} from "solid-js";
import type { HostNode, Style } from "@zynthjs/core";
import { setProperty } from "@zynthjs/core";
import { viewport } from "@zynthjs/apis";
import { View } from "./View";

export type ModalAnimation = "fade" | "slide" | "zoom" | "none";

export interface ModalRef {
  open: () => void;
  dismiss: () => void;
  /** @internal */
  __attachHost?: (node: HostNode | null) => void;
}

type ModalCommand = { type: "show" } | { type: "dismiss" };

type InternalRef = ModalRef & {
  __attachHost: (node: HostNode | null) => void;
};

export interface ModalProps {
  open?: boolean;
  defaultOpen?: boolean;
  ref?: (node: (HostNode & ModalRef) | null) => void;
  animation?: ModalAnimation;
  transparent?: boolean;
  overlayColor?: string;
  overlayOpacity?: number;
  dismissOnOverlayPress?: boolean;
  onOpenChange?: (open: boolean) => void;
  onRequestClose?: () => void;
  onDismiss?: () => void;
  style?: Style;
  children?: SolidElement;
  testID?: string;
}

const DEFAULT_MODAL_STYLE: Style = {
  position: "absolute",
  top: 0,
  left: 0,
};

const DEFAULT_ANIMATION: ModalAnimation = "fade";
const DEFAULT_OVERLAY_COLOR = "#000000";
const DEFAULT_OVERLAY_OPACITY = 0.45;

const sendCommand = (host: HostNode | null, command: ModalCommand) => {
  if (!host) return;
  setProperty(host, "__command", JSON.stringify(command));
};

export const createModalRef = (): ModalRef => {
  let host: HostNode | null = null;

  const handle: InternalRef = {
    open: () => {
      sendCommand(host, { type: "show" });
    },
    dismiss: () => {
      sendCommand(host, { type: "dismiss" });
    },
    __attachHost: (node) => {
      host = node;
    },
  };

  return handle;
};

export const useModalRef = () => createModalRef();

export const Modal: ParentComponent<ModalProps> = (props) => {
  const local = props;

  let host: HostNode | null = null;
  const [uncontrolledOpen, setUncontrolledOpen] = createSignal(
    local.defaultOpen ?? false
  );
  const isControlled = () => local.open !== undefined;
  const resolvedOpen = () =>
    isControlled() ? !!local.open : uncontrolledOpen();

  const resolvedAnimation = () => local.animation ?? DEFAULT_ANIMATION;
  const resolvedTransparent = () => !!local.transparent;
  const resolvedDismissOnOverlayPress = () =>
    local.dismissOnOverlayPress ?? true;
  const resolvedOverlayColor = () =>
    local.overlayColor ?? DEFAULT_OVERLAY_COLOR;
  const resolvedOverlayOpacity = () =>
    local.overlayOpacity ?? DEFAULT_OVERLAY_OPACITY;

  const [screenSize, setScreenSize] = createSignal(viewport.screen);

  createEffect(
    () => null,
    () => {
      const unsubscribe = viewport.observe("screen", (metrics) => {
        setScreenSize(metrics);
      });
      onCleanup(unsubscribe);
    }
  );

  const modalStyle = createMemo<Style>(() => {
    const style: Style = {
      ...DEFAULT_MODAL_STYLE,
      ...local.style,
    };
    style.width = 0;
    style.height = 0;
    style.display = resolvedOpen() ? "flex" : "none";
    return style;
  });

  const contentWrapperStyle = createMemo<Style>(() => ({
    position: "absolute",
    top: 0,
    left: 0,
    width: screenSize().width,
    height: screenSize().height,
  }));

  const attachHost = (node: HostNode | null) => {
    host = node;
    if (node) {
      const imperativeNode = node as HostNode & ModalRef;
      imperativeNode.open = () => sendCommand(node, { type: "show" });
      imperativeNode.dismiss = () => sendCommand(node, { type: "dismiss" });
      local.ref?.(imperativeNode);
    } else {
      local.ref?.(null);
    }
    if (node && resolvedOpen()) {
      setProperty(node, "open", true);
    }
  };

  createEffect(
    () => ({
      st: modalStyle(),
      anim: resolvedAnimation(),
      trans: resolvedTransparent(),
      dismissOverlay: resolvedDismissOnOverlayPress(),
      ovColor: resolvedOverlayColor(),
      ovOpacity: resolvedOverlayOpacity(),
      testId: local.testID,
      openState: resolvedOpen(),
    }),
    (cfg) => {
      if (!host) return;
      setProperty(host, "style", cfg.st);
      setProperty(host, "animation", cfg.anim);
      setProperty(host, "transparent", cfg.trans);
      setProperty(host, "dismissOnOverlayPress", cfg.dismissOverlay);
      setProperty(host, "overlayColor", cfg.ovColor);
      setProperty(host, "overlayOpacity", cfg.ovOpacity);
      if (cfg.testId) {
        setProperty(host, "testID", cfg.testId);
      }
      setProperty(host, "open", cfg.openState);
    }
  );

  createEffect(
    () => host,
    (h) => {
      if (!h) return;

      setProperty(h, "onRequestClose", () => {
        local.onRequestClose?.();
      });

      setProperty(h, "onDismiss", () => {
        if (!isControlled()) {
          setUncontrolledOpen(false);
        }
        local.onDismiss?.();
      });

      setProperty(h, "onOpenChange", (payload: { open: boolean }) => {
        const next = !!payload?.open;
        if (!isControlled()) {
          setUncontrolledOpen(next);
        }
        local.onOpenChange?.(next);
      });
    }
  );

  return (
    <zynth-modal ref={attachHost} style={modalStyle()}>
      <View style={contentWrapperStyle()} pointerEvents="box-none">
        {local.children}
      </View>
    </zynth-modal>
  );
};
