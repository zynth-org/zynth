import { createMemo as solidCreateMemo } from "solid-js";
import { createRenderer } from "solid-js/universal";
import type { Host, HostNode, HostBatchMeta } from "./host/HostTypes";

let host: Host | null = null;
export const setHost = (h: Host) => (host = h);
export const getHost = (): Host | null => host;
const H = (): Host => {
  if (!host) throw new Error("Host not set");
  return host;
};

export const memo = <T>(fn: () => T) => solidCreateMemo(() => fn());

// Create the Solid-backed renderer
const r = createRenderer<HostNode>({
  createElement: (t: any) => H().createNode(t as any),
  createTextNode: (v: any) => H().createText(v),
  replaceText: (n: any, v: any) => H().setText(n, v),
  setProperty: (n: any, k: any, v: any, prev: any) => {
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
    const make = (host as any)?.createRootContainer as
      | ((arg: unknown) => HostNode)
      | undefined;
    c = make ? make(undefined) : ({ id: 0, type: "root" } as any);
  }

  const dispose = r.render(code as any, c as any);

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
export const effect = r.effect;

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

// Expose renderer operations as functions (stable, hoisted bindings)
export function createElement(t: any) {
  return H().createNode(t as any);
}
export function createTextNode(v: any) {
  return H().createText(v);
}
export function replaceText(n: any, v: any) {
  return H().setText(n, v);
}
export function setProperty(n: any, k: any, v: any) {
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
export const use = r.use as (
  fn: (value: any, arg: any) => any,
  element: any,
  arg: any
) => any;
