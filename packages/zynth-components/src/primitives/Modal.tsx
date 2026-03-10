import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  splitProps,
  type ParentComponent,
  type JSX,
} from "solid-js";
import type { HostNode, Style, StyleProp } from "@zynth/core";
import { setProperty, flattenStyleProp } from "@zynth/core";
import { Dimensions } from "@zynth/apis";
import { createStyleBinding } from "../hooks/styleBinding";
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
  style?: StyleProp;
  children?: JSX.Element;
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
  const [local] = splitProps(props, [
    "open",
    "defaultOpen",
    "ref",
    "animation",
    "transparent",
    "overlayColor",
    "overlayOpacity",
    "dismissOnOverlayPress",
    "onOpenChange",
    "onRequestClose",
    "onDismiss",
    "style",
    "children",
    "testID",
  ]);

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);
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

  const [screenSize, setScreenSize] = createSignal(Dimensions.get("screen"));

  createEffect(() => {
    const unsubscribe = Dimensions.observe("screen", (metrics) => {
      setScreenSize(metrics);
    });
    onCleanup(unsubscribe);
  });

  const modalStyle = createMemo<StyleProp>(() => {
    return [
      DEFAULT_MODAL_STYLE,
      local.style,
      {
        width: 0,
        height: 0,
        display: resolvedOpen() ? "flex" : "none",
      },
    ] as StyleProp;
  });

  createStyleBinding(hostNode, modalStyle);

  const contentWrapperStyle = createMemo<Style>(() => ({
    position: "absolute",
    top: 0,
    left: 0,
    width: screenSize().width,
    height: screenSize().height,
  }));

  const attachHost = (node: HostNode | null) => {
    setHostNode(node);
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

  createEffect(() => {
    const host = hostNode();
    if (!host) return;
    setProperty(host, "animation", resolvedAnimation());
    setProperty(host, "transparent", resolvedTransparent());
    setProperty(host, "dismissOnOverlayPress", resolvedDismissOnOverlayPress());
    setProperty(host, "overlayColor", resolvedOverlayColor());
    setProperty(host, "overlayOpacity", resolvedOverlayOpacity());
    if (local.testID) {
      setProperty(host, "testID", local.testID);
    }
    setProperty(host, "open", resolvedOpen());
  });

  createEffect(() => {
    const host = hostNode();
    if (!host) return;

    setProperty(host, "onRequestClose", () => {
      local.onRequestClose?.();
    });

    setProperty(host, "onDismiss", () => {
      if (!isControlled()) {
        setUncontrolledOpen(false);
      }
      local.onDismiss?.();
    });

    setProperty(host, "onOpenChange", (payload: { open: boolean }) => {
      const next = !!payload?.open;
      if (!isControlled()) {
        setUncontrolledOpen(next);
      }
      local.onOpenChange?.(next);
    });
  });

  return (
    <zynth-modal ref={attachHost} style={undefined}>
      <View style={contentWrapperStyle()} pointerEvents="box-none">
        {local.children}
      </View>
    </zynth-modal>
  );
};
