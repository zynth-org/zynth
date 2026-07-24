import { createEffect, onCleanup, createSignal } from "solid-js";
import type { Component } from "solid-js";
import type { HostNode } from "@zynthjs/core";
import { setProperty } from "@zynthjs/core";

/**
 * Represents a button in the alert dialog.
 * Maps to UIAlertAction on iOS and AlertDialog buttons on Android.
 */
export interface AlertButton {
  /** The text displayed on the button */
  text: string;
  /**
   * The style of the button:
   * - "default": Standard button (iOS: .default, Android: positive/neutral)
   * - "cancel": Cancel button (iOS: .cancel, Android: negative)
   * - "destructive": Destructive action (iOS: .destructive, Android: positive with destructive styling)
   */
  style?: "default" | "cancel" | "destructive";
  /** Callback when the button is pressed */
  onPress?: () => void;
}

/** Tuple type enforcing 1-3 buttons for cross-platform parity */
export type AlertButtons =
  | [AlertButton]
  | [AlertButton, AlertButton]
  | [AlertButton, AlertButton, AlertButton];

export interface AlertRef {
  /** Show the alert dialog */
  show: () => void;
  /** Dismiss the alert dialog programmatically */
  dismiss: () => void;
}

type AlertCommand = { type: "show" } | { type: "dismiss" };

type InternalRef = AlertRef & {
  __attachHost: (node: HostNode | null) => void;
};

export interface AlertProps {
  /** The title text displayed at the top of the alert */
  title?: string;
  /** The message text displayed in the body of the alert */
  message?: string;
  /**
   * Array of 1-3 buttons for the alert.
   * Limited to 3 for cross-platform compatibility.
   */
  buttons?: AlertButtons;
  /** Callback fired when the alert is dismissed (after any button press or programmatic dismiss) */
  onDismiss?: () => void;
  /** Ref for imperative show/dismiss operations */
  ref?: (node: (HostNode & AlertRef) | null) => void;
}

let cmdSeq = 0;
const sendCommand = (host: HostNode | null, command: AlertCommand) => {
  if (!host) return;
  cmdSeq++;
  setProperty(host, "__command", JSON.stringify({ ...command, _seq: cmdSeq }));
};

/**
 * Creates an AlertRef for imperative control of the Alert component.
 *
 * @example
 * ```tsx
 * const alert = createAlertRef();
 *
 * <Button onPress={() => alert.show()}>Show Alert</Button>
 * <Alert
 *   ref={(node) => {
 *     // You can also keep the handle in a signal/local variable
 *   }}
 *   title="Confirm"
 *   message="Are you sure?"
 *   buttons={[
 *     { text: "Cancel", style: "cancel" },
 *     { text: "OK", onPress: handleOK }
 *   ]}
 * />
 * ```
 */
export const createAlertRef = (): AlertRef => {
  let host: HostNode | null = null;

  const handle: InternalRef = {
    show: () => {
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

/**
 * A cross-platform Alert component using native UIAlertController (iOS) and Material 3 AlertDialog (Android).
 *
 * Features:
 * - Maximum 3 buttons for cross-platform parity
 * - Non-dismissable on backdrop tap (consistent behavior)
 * - Maps button styles to native equivalents
 *
 * @example
 * ```tsx
 * const alertRef = createAlertRef();
 *
 * <Alert
 *   ref={(node) => {
 *     // assign node to a local/signal if needed
 *   }}
 *   title="Delete Item"
 *   message="This action cannot be undone."
 *   buttons={[
 *     { text: "Cancel", style: "cancel" },
 *     { text: "Delete", style: "destructive", onPress: handleDelete }
 *   ]}
 *   onDismiss={() => console.log("Alert dismissed")}
 * />
 * ```
 */
export const Alert: Component<AlertProps> = (props) => {
  const local = props;

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null, { ownedWrite: true });

  // Store button callbacks for matching with native events
  let buttonCallbacks: Array<(() => void) | undefined> = [];

  const attachHost = (node: HostNode) => {
    setHostNode(node);
    const imperativeNode = node as HostNode & AlertRef;
    imperativeNode.show = () => sendCommand(node, { type: "show" });
    imperativeNode.dismiss = () => sendCommand(node, { type: "dismiss" });
    local.ref?.(imperativeNode);
  };

  onCleanup(() => {
    local.ref?.(null);
  });

  // Sync props to native
  createEffect(
    () => ({ node: hostNode(), title: local.title, message: local.message, buttons: local.buttons }),
    ({ node, title, message, buttons }) => {
      if (!node) return;

      if (title != null) {
        setProperty(node, "title", title);
      }
      if (message != null) {
        setProperty(node, "message", message);
      }

      // Serialize buttons config (text + style only, callbacks handled separately)
      const btns = buttons ?? [{ text: "OK", style: "default" }];
      buttonCallbacks = btns.map((btn: AlertButton) => btn.onPress);

      const buttonsConfig = btns.map((btn: AlertButton) => ({
        text: btn.text,
        style: btn.style ?? "default",
      }));
      setProperty(node, "buttons", JSON.stringify(buttonsConfig));
    }
  );

  // Set up event handlers
  createEffect(
    () => hostNode(),
    (node) => {
      if (!node) return;

      // Handle button press events from native
      setProperty(node, "onButtonPress", (payload: { index: number }) => {
        const callback = buttonCallbacks[payload.index];
        callback?.();
      });

      // Handle dismiss event
      setProperty(node, "onDismiss", () => {
        local.onDismiss?.();
      });
    }
  );

  return <zynth-alert ref={attachHost} />;
};
