import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  splitProps,
  type ParentComponent,
  type JSX,
} from "solid-js";
import type { HostNode, Style } from "@zynth/core";
import { setProperty } from "@zynth/core";
import { Dimensions } from "@zynth/apis";
import { View } from "./View";

export type ModalAnimation = "fade" | "slide" | "zoom" | "none";

export interface ModalController {
  open: () => void;
  dismiss: () => void;
  /** @internal */
  __attachHost?: (node: HostNode | null) => void;
}

type ModalCommand = { type: "show" } | { type: "dismiss" };

type InternalController = ModalController & {
  __attachHost: (node: HostNode | null) => void;
};

export interface ModalProps {
  open?: boolean;
  defaultOpen?: boolean;
  controller?: ModalController;
  animation?: ModalAnimation;
  transparent?: boolean;
  overlayColor?: string;
  overlayOpacity?: number;
  dismissOnOverlayPress?: boolean;
  onOpenChange?: (open: boolean) => void;
  onRequestClose?: () => void;
  onDismiss?: () => void;
  style?: Style;
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

const asInternalController = (
  controller?: ModalController | null
): InternalController | undefined => {
  if (
    controller &&
    typeof (controller as InternalController).__attachHost === "function"
  ) {
    return controller as InternalController;
  }
  return undefined;
};

export const createModalController = (): ModalController => {
  let host: HostNode | null = null;

  const controller: InternalController = {
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

  return controller;
};

export const useModalController = () => createModalController();

export const Modal: ParentComponent<ModalProps> = (props) => {
  const [local] = splitProps(props, [
    "open",
    "defaultOpen",
    "controller",
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

  const [screenSize, setScreenSize] = createSignal(Dimensions.get("screen"));

  createEffect(() => {
    const unsubscribe = Dimensions.observe("screen", (metrics) => {
      setScreenSize(metrics);
    });
    onCleanup(unsubscribe);
  });

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

  const controller = asInternalController(local.controller);

  const attachHost = (node: HostNode | null) => {
    host = node;
    controller?.__attachHost(node);
    if (node && resolvedOpen()) {
      setProperty(node, "open", true);
    }
  };

  onCleanup(() => {
    controller?.__attachHost(null);
  });

  createEffect(() => {
    if (!host) return;
    setProperty(host, "style", modalStyle());
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
    <zynth-modal ref={attachHost} style={modalStyle()}>
      <View style={contentWrapperStyle()} pointerEvents="box-none">
        {local.children}
      </View>
    </zynth-modal>
  );
};
