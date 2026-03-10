import {
  createEffect,
  createSignal,
  onCleanup,
  splitProps,
  type ParentComponent,
  type JSX,
} from "solid-js";
import type { HostNode, StyleProp } from "@zynth/core";
import { setProperty } from "@zynth/core";
import { createStyleBinding } from "../hooks/styleBinding";

export interface DatePickerProps {
  mode?: "date" | "range" | "year";
  title?: string;
  value?: number | Date | DateRangeValue | [number, number] | null;
  defaultValue?: number | Date | DateRangeValue | [number, number] | null;
  confirmText?: string;
  cancelText?: string;
  onChange?: (value: number) => void;
  onRangeChange?: (value: DateRangeValue) => void;
  onCancel?: () => void;
  onDismiss?: () => void;
  ref?: (node: (HostNode & DatePickerRef) | null) => void;
  style?: StyleProp;
  children?: JSX.Element;
  testID?: string;
}

export interface DatePickerTriggerProps {
  style?: StyleProp;
  children?: JSX.Element;
  testID?: string;
  ref?: (node: HostNode | null) => void;
}

type DatePickerEvent = {
  value?: number;
};

export type DateRangeValue = {
  start: number | null;
  end: number | null;
};

type DateRangeEvent = {
  start?: number;
  end?: number;
};

export interface DatePickerRef {
  open: () => void;
  dismiss: () => void;
  /** @internal */
  __attachHost?: (node: HostNode | null) => void;
}

type DatePickerCommand = { type: "show"; __ts?: number } | { type: "dismiss"; __ts?: number };

export function createDatePickerRef(): DatePickerRef {
  let host: HostNode | null = null;

  const issueCommand = (command: DatePickerCommand) => {
    if (!host) return;
    setProperty(host, "__command", { ...command, __ts: Date.now() });
  };

  const controller: DatePickerRef = {
    open() {
      issueCommand({ type: "show" });
    },
    dismiss() {
      issueCommand({ type: "dismiss" });
    },
  };

  controller.__attachHost = (node) => {
    host = node;
  };

  return controller;
}

export const useDatePickerRef = () => createDatePickerRef();

const toTimestamp = (value?: number | Date | null): number | undefined => {
  if (value == null) return undefined;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return undefined;
};

const toRangeSelection = (
  value?: DateRangeValue | [number, number] | null
): DateRangeValue | undefined => {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const [start, end] = value;
    return {
      start: toTimestamp(start) ?? null,
      end: toTimestamp(end) ?? null,
    };
  }
  if (typeof value === "object") {
    return {
      start: toTimestamp(value.start ?? null) ?? null,
      end: toTimestamp(value.end ?? null) ?? null,
    };
  }
  return undefined;
};

const extractValue = (value: number | DatePickerEvent): number => {
  if (typeof value === "object" && value !== null && "value" in value) {
    return Number(value.value);
  }
  return Number(value);
};

const extractRange = (
  value: DateRangeValue | DateRangeEvent
): DateRangeValue | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const start = toTimestamp(value.start ?? null) ?? null;
  const end = toTimestamp(value.end ?? null) ?? null;
  return { start, end };
};

const DatePickerRoot: ParentComponent<DatePickerProps> = (props) => {
  const [local] = splitProps(props, [
    "mode",
    "title",
    "value",
    "defaultValue",
    "confirmText",
    "cancelText",
    "onChange",
    "onRangeChange",
    "onCancel",
    "onDismiss",
    "ref",
    "style",
    "children",
    "testID",
  ]);

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);
  createStyleBinding(hostNode, () => local.style);

  const selection = () => {
    if (local.mode === "range") {
      return toRangeSelection(
        (local.value ?? local.defaultValue) as DateRangeValue | [number, number]
      );
    }
    return toTimestamp((local.value ?? local.defaultValue) as number | Date | null | undefined);
  };

  const wrapChange =
    (handler?: (value: number) => void) => (value: number | DatePickerEvent) => {
      const next = extractValue(value);
      if (!Number.isFinite(next)) return;
      handler?.(next);
    };

  const wrapRange =
    (handler?: (value: DateRangeValue) => void) =>
    (value: DateRangeValue | DateRangeEvent) => {
      const next = extractRange(value);
      if (!next) return;
      handler?.(next);
    };

  onCleanup(() => local.ref?.(null));

  const attachRef = (node: any) => {
    const host = (node as HostNode) ?? null;
    setHostNode(host);
    if (!host) {
      local.ref?.(null);
      return;
    }
    const imperativeNode = host as HostNode & DatePickerRef;
    imperativeNode.open = () =>
      setProperty(host, "__command", { type: "show", __ts: Date.now() });
    imperativeNode.dismiss = () =>
      setProperty(host, "__command", { type: "dismiss", __ts: Date.now() });
    local.ref?.(imperativeNode);
  };

  return (
    <date-picker-view
      ref={attachRef}
      mode={local.mode ?? "date"}
      title={local.title}
      value={selection()}
      confirmText={local.confirmText}
      cancelText={local.cancelText}
      onChange={local.onChange ? wrapChange(local.onChange) : undefined}
      onRangeChange={
        local.onRangeChange ? wrapRange(local.onRangeChange) : undefined
      }
      onCancel={local.onCancel}
      onDismiss={local.onDismiss}
      style={undefined}
      testID={local.testID}
    >
      {local.children}
    </date-picker-view>
  );
};

const DatePickerTrigger: ParentComponent<DatePickerTriggerProps> = (props) => {
  const [local] = splitProps(props, ["style", "children", "testID", "ref"]);
  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);
  createStyleBinding(hostNode, () => local.style);

  const refProp = (node: HostNode | null) => {
    setHostNode(node);
    local.ref?.(node);
  };

  return (
    <date-picker-trigger-view style={undefined} testID={local.testID} ref={refProp}>
      {local.children}
    </date-picker-trigger-view>
  );
};

export const DatePicker = Object.assign(DatePickerRoot, {
  Trigger: DatePickerTrigger,
});
