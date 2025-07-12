import { createEffect, onCleanup, splitProps, createSignal } from "solid-js";
import type { Component } from "solid-js";
import type { HostNode } from "@rune/core";
import { setProperty } from "@rune/core";

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

export interface AlertController {
  /** Show the alert dialog */
  show: () => void;
  /** Dismiss the alert dialog programmatically */
  dismiss: () => void;
}

type AlertCommand = { type: "show" } | { type: "dismiss" };

type InternalController = AlertController & {
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
  /** Controller for imperative show/dismiss operations */
  controller?: AlertController;
}

const sendCommand = (host: HostNode | null, command: AlertCommand) => {
  if (!host) return;
  setProperty(host, "__command", JSON.stringify(command));
};

const asInternalController = (
  controller?: AlertController | null
): InternalController | undefined => {
  if (
    controller &&
    typeof (controller as InternalController).__attachHost === "function"
  ) {
    return controller as InternalController;
  }
  return undefined;
};

/**
 * Creates an AlertController for imperative control of the Alert component.
 *
 * @example
 * ```tsx
 * const alert = createAlertController();
 *
 * <Button onPress={() => alert.show()}>Show Alert</Button>
 * <Alert
 *   controller={alert}
 *   title="Confirm"
 *   message="Are you sure?"
 *   buttons={[
 *     { text: "Cancel", style: "cancel" },
 *     { text: "OK", onPress: handleOK }
 *   ]}
 * />
 * ```
 */
export const createAlertController = (): AlertController => {
  let host: HostNode | null = null;

  const controller: InternalController = {
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

  return controller;
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
 * const alertController = createAlertController();
 *
 * <Alert
 *   controller={alertController}
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
  const [local] = splitProps(props, [
    "title",
    "message",
    "buttons",
    "onDismiss",
    "controller",
  ]);

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);
  const controller = asInternalController(local.controller);

  // Store button callbacks for matching with native events
  let buttonCallbacks: Array<(() => void) | undefined> = [];

  const attachHost = (node: HostNode) => {
    setHostNode(node);
    controller?.__attachHost(node);
  };

  onCleanup(() => {
    controller?.__attachHost(null);
  });

  // Sync props to native
  createEffect(() => {
    const node = hostNode();
    if (!node) return;

    if (local.title != null) {
      setProperty(node, "title", local.title);
    }
    if (local.message != null) {
      setProperty(node, "message", local.message);
    }

    // Serialize buttons config (text + style only, callbacks handled separately)
    const buttons = local.buttons ?? [{ text: "OK", style: "default" }];
    buttonCallbacks = buttons.map((btn) => btn.onPress);

    const buttonsConfig = buttons.map((btn) => ({
      text: btn.text,
      style: btn.style ?? "default",
    }));
    setProperty(node, "buttons", JSON.stringify(buttonsConfig));
  });

  // Set up event handlers
  createEffect(() => {
    const node = hostNode();
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
  });

  return <rune-alert ref={attachHost} />;
};
