import { createEffect, createMemo, createSignal, splitProps } from "solid-js";
import type { JSX } from "solid-js";
import type { HostNode, Style } from "@rune/core";
import { setProperty } from "@rune/core";
import {
  createVirtualListRecorder,
  withVirtualListRecorder,
  type VirtualNode,
} from "./virtual-list-recorder";

export type VirtualListMetrics = {
  offset: number;
  velocity: number;
  visibleStart: number;
  visibleEnd: number;
};

const DEFAULT_METRICS: VirtualListMetrics = {
  offset: 0,
  velocity: 0,
  visibleStart: 0,
  visibleEnd: 0,
};

export type VirtualListCommand =
  | { type: "scrollToOffset"; offset: number; animated?: boolean }
  | {
      type: "scrollToIndex";
      index: number;
      viewOffset?: number;
      viewPosition?: number;
      animated?: boolean;
    }
  | { type: "scrollToTop"; animated?: boolean }
  | { type: "scrollToEnd"; animated?: boolean }
  | { type: "flashScrollIndicators" };

export type VirtualListState = {
  metrics: () => VirtualListMetrics;
  __notifyMetrics?: (metrics: VirtualListMetrics) => void;
};

export type VirtualListController = {
  scrollToOffset: (params: { offset: number; animated?: boolean }) => void;
  scrollToIndex: (params: {
    index: number;
    viewOffset?: number;
    viewPosition?: number;
    animated?: boolean;
  }) => void;
  scrollToTop: (params?: { animated?: boolean }) => void;
  scrollToEnd: (params?: { animated?: boolean }) => void;
  flashScrollIndicators: () => void;
  __setHost?: (node: HostNode | null) => void;
};

export function createVirtualListState(): VirtualListState {
  const [metrics, setMetrics] =
    createSignal<VirtualListMetrics>(DEFAULT_METRICS);

  return {
    metrics,
    __notifyMetrics(next) {
      setMetrics(next);
    },
  };
}

export function createVirtualListController(): VirtualListController {
  let hostNode: HostNode | null = null;

  const sendCommand = (command: VirtualListCommand) => {
    if (!hostNode) {
      console.warn("[VirtualList] Cannot send command: host not set");
      return;
    }
    setProperty(hostNode, "__virtualListCommand", command);
  };

  return {
    scrollToOffset: (params) =>
      sendCommand({ type: "scrollToOffset", ...params }),
    scrollToIndex: (params) =>
      sendCommand({ type: "scrollToIndex", ...params }),
    scrollToTop: (params = {}) =>
      sendCommand({ type: "scrollToTop", ...params }),
    scrollToEnd: (params = {}) =>
      sendCommand({ type: "scrollToEnd", ...params }),
    flashScrollIndicators: () => sendCommand({ type: "flashScrollIndicators" }),
    __setHost: (node) => {
      hostNode = node;
    },
  };
}

export type VirtualListRenderer<T> = (params: {
  item: T;
  index: number;
}) => JSX.Element;

export interface VirtualListProps<T> {
  data: T[];
  renderItem: VirtualListRenderer<T>;
  keyExtractor?: (item: T, index: number) => string;
  state?: VirtualListState;
  controller?: VirtualListController;
  style?: Style;
  contentContainerStyle?: {
    backgroundColor?: string;
    padding?: number;
    paddingHorizontal?: number;
    paddingVertical?: number;
    paddingTop?: number;
    paddingBottom?: number;
    paddingLeft?: number;
    paddingRight?: number;
  };
  horizontal?: boolean;
  testID?: string;
}

type SerializedItem = {
  key: string;
  tree: VirtualNode | null;
};

export function VirtualList<T>(allProps: VirtualListProps<T>) {
  const [local] = splitProps(allProps, [
    "data",
    "renderItem",
    "keyExtractor",
    "state",
    "controller",
    "style",
    "contentContainerStyle",
    "horizontal",
    "testID",
  ]);

  const hostState = local.state;
  const hostController = local.controller;
  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);

  // Wire up controller to host node
  createEffect(() => {
    const node = hostNode();
    if (hostController?.__setHost) {
      hostController.__setHost(node);
    }
  });

  const keyExtractor =
    local.keyExtractor ??
    ((_, index: number) => {
      return String(index);
    });

  const serializedItems = createMemo<SerializedItem[]>(() => {
    const data = local.data ?? [];
    return data.map((item, index) => {
      const key = keyExtractor(item, index);
      const recorder = createVirtualListRecorder();
      const result = withVirtualListRecorder(recorder, () =>
        local.renderItem({ item, index })
      );
      const node = recorder.normalize(result);
      return {
        key,
        tree: node,
      };
    });
  });

  const payload = createMemo(() => {
    const items = serializedItems().map(({ key, tree }) => ({
      key,
      tree,
    }));
    return JSON.stringify({
      items,
    });
  });

  createEffect(() => {
    const node = hostNode();
    if (!node) return;
    if (local.style) {
      setProperty(node, "style", local.style as any);
    }
    if (local.testID) {
      setProperty(node, "testID", local.testID);
    }
  });

  createEffect(() => {
    const node = hostNode();
    if (!node) return;
    setProperty(node, "__virtualListState", payload());
  });

  createEffect(() => {
    const node = hostNode();
    if (!node) return;
    if (local.horizontal !== undefined) {
      setProperty(node, "__virtualListHorizontal", local.horizontal);
    }
  });

  createEffect(() => {
    const node = hostNode();
    if (!node) return;
    if (local.contentContainerStyle) {
      setProperty(
        node,
        "__virtualListContentContainerStyle",
        local.contentContainerStyle
      );
    }
  });

  return (
    <virtual-list
      ref={(node: HostNode | null) => {
        setHostNode(node);
      }}
      testID={local.testID}
      style={local.style as any}
    />
  );
}
