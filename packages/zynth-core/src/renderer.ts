import { createMemo as solidCreateMemo } from "solid-js";
import { createRenderer } from "@solidjs/universal";
import type { Host, HostNode, HostBatchMeta } from "./host/HostTypes";

import { Platform, OS } from "./platform";
import { createAndroidHost } from "./host/android";
import { createIOSHost } from "./host/ios";
import { createWebHost } from "./host/web";
import { emitDevtoolsEvent } from "./devtools";

let host: Host | null = null;
export const setHost = (h: Host) => {
  host = h;
  (globalThis as any).__zynth_host = h;
};
export const getHost = (): Host | null => host || (globalThis as any).__zynth_host || null;
const H = (): Host => {
  let active = host || (globalThis as any).__zynth_host;
  if (!active) {
    if (Platform.OS === OS.WEB) {
      active = createWebHost();
    } else if (Platform.OS === OS.ANDROID) {
      active = createAndroidHost();
    } else {
      active = createIOSHost();
    }
    setHost(active);
  }
  return active;
};

export const memo = <T>(fn: () => T) => solidCreateMemo(() => fn());

// Create the Solid-backed renderer. Solid 2 moved this implementation to the
// standalone @solidjs/universal package; keeping its ownership and child
// reconciliation here is required for native refs and dynamic JSX children.
const r = createRenderer<HostNode>({
  createElement: (t: any) => H().createNode(t as any),
  createTextNode: (v: any) => H().createText(v),
  replaceText: (n: any, v: any) => H().setText(n, v),
  setProperty: (n: any, k: any, v: any, prev?: any) => {
    if (k === "style") {
      const actualPrev = prev || n.__prevStyle;
      if (actualPrev && typeof actualPrev === "object") {
        const prevResolved = Array.isArray(actualPrev) ? Object.assign({}, ...actualPrev) : actualPrev;
        const currentResolved = Array.isArray(v) ? Object.assign({}, ...v) : (v || {});
        const merged = { ...currentResolved };
        for (const key in prevResolved) {
          if (!(key in merged) || merged[key] === undefined) {
            merged[key] = null;
          }
        }
        H().setProperty(n, k, merged);
      } else {
        H().setProperty(n, k, v);
      }
      n.__prevStyle = v;
    } else {
      H().setProperty(n, k, v);
    }
  },
  insertNode: (p: any, n: any, a: any) => H().insertNode(p, n, a ?? undefined),
  removeNode: (p: any, n: any) => H().removeNode(p, n),
  isTextNode: (n: any) => n.type === "text",
  getParentNode: (n: any) => H().getParentNode(n) as HostNode | undefined,
  getFirstChild: (n: any) => H().getFirstChild(n) as HostNode | undefined,
  getNextSibling: (n: any) => H().getNextSibling(n) as HostNode | undefined,
});

// Loosen the render signature so apps can pass `() => JSX.Element`
// and auto-create a root container if one isn't provided.
export const render: (
  code: () => any,
  container?: HostNode | null
) => () => void = (code, container) => {
  let c = container as HostNode | null | undefined;
  if (!c || typeof (c as any).id !== "number") {
    c = H().createRootContainer(undefined);
  }

  let dispose: (() => void) | undefined;
  try {
    dispose = r.render(code as any, c as any);
  } catch (error) {
    const value = error as {
      message?: unknown;
      stack?: unknown;
      cause?: { message?: unknown; stack?: unknown };
    } | null;
    const cause = value?.cause;
    emitDevtoolsEvent({
      topic: "error/js",
      level: "error",
      tag: "render",
      data: {
        message: String(value?.message || error || "Render failed"),
        ...(value?.stack ? { stack: String(value.stack) } : {}),
        ...(cause?.message ? { cause: String(cause.message) } : {}),
        ...(cause?.stack ? { causeStack: String(cause.stack) } : {}),
      },
    });
    throw error;
  }

  return () => {
    dispose?.();

    let child = H().getFirstChild(c as HostNode);
    while (child) {
      const next = H().getNextSibling(child);
      H().removeNode(c as HostNode, child);
      child = next;
    }
  };
};
export const effect = r.effect as <T>(
  fn: (prev?: T) => T,
  effect: (value: T, prev?: T) => void,
  options?: { scope?: boolean; [key: string]: any }
) => void;

export function withHostBatch<T>(meta: HostBatchMeta, fn: () => T): T {
  const h = host;
  if (!h?.beginBatch || !h.endBatch) {
    return fn();
  }
  h.beginBatch(meta);
  try {
    return fn();
  } finally {
    h.endBatch(meta);
  }
}

export const createElement = (type: any, props?: any) => {
  const node = H().createNode(type);
  return node;
};

export const createTextNode = (text: any) => {
  const node = H().createNode("text");
  if (text != null) {
    H().setProperty(node, "text", String(text));
  }
  return node;
};

export function replaceText(n: any, v: any) {
  return H().setProperty(n, "text", String(v));
}

export function setProperty(n: any, k: any, v: any) {
  if (!n) {
    return;
  }
  return H().setProperty(n, k, v);
}

export function insertNode(p: any, n: any, a?: any) {
  return H().insertNode(p, n, a ?? null);
}

export function removeNode(p: any, n: any) {
  return H().removeNode(p, n);
}
export function flush() {
  return H().flush?.();
}
export function getParentNode(n: any) {
  return H().getParentNode(n);
}
export function getFirstChild(n: any) {
  return H().getFirstChild(n);
}
export function getNextSibling(n: any) {
  return H().getNextSibling(n);
}
export function getNodeValue(n: any) {
  return H().getText(n);
}
export function isTextNode(n: any) {
  return n.type === "text";
}
export const insert = r.insert as (
  parent: any,
  accessor: any,
  marker?: any,
  initial?: any
) => void;
export const spread = r.spread as (
  node: any,
  accessor: any,
  skipChildren?: boolean
) => any;

export const use = (fn: any, element: any, arg?: any) => {
  if (typeof fn === "function") {
    fn(element, arg);
  } else if (fn && typeof fn === "object" && "current" in fn) {
    fn.current = element;
  }
};

export const createComponent = r.createComponent;
export const setProp = r.setProp;
export const mergeProps = r.mergeProps;
