import { onCleanup, type Component, type JSX, type ParentComponent } from "solid-js";
import type { HostNode, Style } from "@zynth/core";
import { setProperty } from "@zynth/core";

export interface PopoverProps {
  /**
   * Layout style for the popover host. Appearance keys are also mapped:
   * - backgroundColor -> surfaceColor
   * - borderRadius -> cornerRadius
   * - elevation/shadowRadius -> elevation
   *
   * Note: width/height here style the host wrapper, not popup content size.
   * Use Popover.Content child styles to size the popup.
   */
  style?: Style;
  children?: JSX.Element;
  onOpen?: () => void;
  onClose?: () => void;
  ref?: (node: (HostNode & PopoverRef) | null) => void;
  dismissOnOutsidePress?: boolean;
  offsetX?: number;
  offsetY?: number;
  showArrow?: boolean;
  testID?: string;
}

export interface PopoverTriggerProps {
  style?: Style;
  children?: JSX.Element;
  testID?: string;
}

export interface PopoverContentProps {
  style?: Style;
  children?: JSX.Element;
  testID?: string;
}

export interface PopoverOpenOptions {
  anchorRef?: HostNode | null;
  anchorNodeId?: number;
  x?: number;
  y?: number;
}

/**
 * Imperative controller for opening or dismissing a native popover.
 */
export interface PopoverRef {
  open: (options?: PopoverOpenOptions) => void;
  dismiss: () => void;
  /** @internal */
  __attachHost?: (node: HostNode | null) => void;
}

type PopoverCommand =
  | {
      type: "show";
      source: "trigger" | "anchor" | "coordinates";
      anchorNodeId?: number;
      x?: number;
      y?: number;
      __ts: number;
    }
  | { type: "dismiss"; __ts: number };

const resolveAnchorNodeId = (options?: PopoverOpenOptions): number | undefined => {
  if (!options) return undefined;
  const explicit = options.anchorNodeId;
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  const fromRef = options.anchorRef;
  if (!fromRef) return undefined;
  const refId = (fromRef as HostNode).id;
  if (typeof refId === "number" && Number.isFinite(refId) && refId > 0) {
    return refId;
  }
  return undefined;
};

const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
};

const issueCommand = (host: HostNode | null, command: PopoverCommand) => {
  if (!host) return;
  setProperty(host, "__command", command);
};

/**
 * Creates a stable imperative popover ref that can be stored in signals/state.
 */
export function createPopoverRef(): PopoverRef {
  let host: HostNode | null = null;

  const controller: PopoverRef = {
    open(options?: PopoverOpenOptions) {
      const anchorNodeId = resolveAnchorNodeId(options);
      const x = toFiniteNumber(options?.x);
      const y = toFiniteNumber(options?.y);
      const source = anchorNodeId
        ? "anchor"
        : typeof x === "number" && typeof y === "number"
          ? "coordinates"
          : "trigger";

      issueCommand(host, {
        type: "show",
        source,
        anchorNodeId,
        x,
        y,
        __ts: Date.now(),
      });
    },
    dismiss() {
      issueCommand(host, { type: "dismiss", __ts: Date.now() });
    },
  };

  controller.__attachHost = (node) => {
    host = node;
  };

  return controller;
}

export const usePopoverRef = () => createPopoverRef();

const PopoverRoot: ParentComponent<PopoverProps> = (props) => {
  const styleBackgroundColor =
    typeof props.style?.backgroundColor === "string"
      ? props.style.backgroundColor
      : undefined;
  const styleBorderRadius =
    typeof props.style?.borderRadius === "number" && Number.isFinite(props.style.borderRadius)
      ? props.style.borderRadius
      : undefined;
  const styleElevation =
    typeof props.style?.elevation === "number" && Number.isFinite(props.style.elevation)
      ? props.style.elevation
      : typeof props.style?.shadowRadius === "number" && Number.isFinite(props.style.shadowRadius)
        ? props.style.shadowRadius
        : undefined;

  const resolvedSurfaceColor = styleBackgroundColor;
  const resolvedCornerRadius = styleBorderRadius;
  const resolvedElevation = styleElevation;

  onCleanup(() => {
    props.ref?.(null);
  });

  const attachRef = (node: HostNode | null) => {
    if (!node) {
      props.ref?.(null);
      return;
    }

    const imperativeNode = node as HostNode & PopoverRef;
    imperativeNode.open = (options?: PopoverOpenOptions) => {
      const anchorNodeId = resolveAnchorNodeId(options);
      const x = toFiniteNumber(options?.x);
      const y = toFiniteNumber(options?.y);
      const source = anchorNodeId
        ? "anchor"
        : typeof x === "number" && typeof y === "number"
          ? "coordinates"
          : "trigger";

      issueCommand(node, {
        type: "show",
        source,
        anchorNodeId,
        x,
        y,
        __ts: Date.now(),
      });
    };
    imperativeNode.dismiss = () => {
      issueCommand(node, { type: "dismiss", __ts: Date.now() });
    };
    props.ref?.(imperativeNode);
  };

  return (
    <popover-view
      ref={attachRef}
      style={props.style}
      onOpen={props.onOpen}
      onClose={props.onClose}
      surfaceColor={resolvedSurfaceColor}
      cornerRadius={resolvedCornerRadius}
      elevation={resolvedElevation}
      dismissOnOutsidePress={props.dismissOnOutsidePress}
      offsetX={props.offsetX}
      offsetY={props.offsetY}
      showArrow={props.showArrow}
      testID={props.testID}
    >
      {props.children}
    </popover-view>
  );
};

const PopoverTrigger: ParentComponent<PopoverTriggerProps> = (props) => {
  return (
    <popover-trigger-view style={props.style} testID={props.testID}>
      {props.children}
    </popover-trigger-view>
  );
};

const PopoverContent: Component<PopoverContentProps> = (props) => {
  return (
    <popover-content-view
      style={{
        ...props.style,
        position: "absolute",
        top: 0,
        left: 0,
      }}
      testID={props.testID}
    >
      {props.children}
    </popover-content-view>
  );
};

export const Popover = Object.assign(PopoverRoot, {
  Trigger: PopoverTrigger,
  Content: PopoverContent,
});
