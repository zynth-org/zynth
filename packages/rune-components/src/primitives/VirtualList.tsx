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

export type VirtualListState = {
  metrics: () => VirtualListMetrics;
  __setHost?: (node: HostNode | null) => void;
  __notifyMetrics?: (metrics: VirtualListMetrics) => void;
};

export function createVirtualListState(): VirtualListState {
  const [metrics, setMetrics] =
    createSignal<VirtualListMetrics>(DEFAULT_METRICS);

  return {
    metrics,
    __setHost: undefined,
    __notifyMetrics(next) {
      setMetrics(next);
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
  style?: Style;
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
    "style",
    "testID",
  ]);

  const hostState = local.state;
  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);

  if (hostState) {
    hostState.__setHost = (node) => {
      setHostNode(node);
    };
  }

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
