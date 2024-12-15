import { createRenderer } from "solid-js/universal";
import type { Host, HostNode } from "./host/HostTypes";

let host: Host | null = null;
export const setHost = (h: Host) => (host = h);
const H = (): Host => {
  if (!host) throw new Error("Host not set");
  return host;
};

// at top:
let __markerId = -1;
function createMarker(): HostNode {
  return { id: __markerId--, type: "marker" };
}

// Use `any` for TNode to avoid over-constraining app JSX return types
const r = createRenderer<any>({
  createElement: (t: any) => H().createNode(t as any),
  createTextNode: (v: any) => H().createText(v),
  createComment: () => createMarker(),
  replaceText: (n: any, v: any) => H().setText(n, v),
  setProperty: (n: any, k: any, v: any) => H().setProperty(n, k, v),
  insertNode: (p: any, n: any, a: any) => H().insertNode(p, n, a ?? null),
  removeNode: (p: any, n: any) => H().removeNode(p, n),
  isTextNode: (n: any) => n.type === "text",
  getParentNode: (n: any) => H().getParentNode(n),
  getFirstChild: (n: any) => H().getFirstChild(n),
  getNextSibling: (n: any) => H().getNextSibling(n),
  getNodeValue: (n: any) => H().getText(n),
} as any);

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

  const dispose = (r.render as any)(code as any, c as any) as
    | (() => void)
    | undefined;

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
export const memo = r.memo;

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
declare const __RUNE_DEBUG_MARKERS: boolean | undefined;
export function insertNode(p: any, n: any, a?: any) {
  if (__RUNE_DEBUG_MARKERS) {
    console.log("[rune] insertNode", {
      parent: p?.id,
      node: n?.id,
      anchor: a?.id,
    });
  }
  return H().insertNode(p, n, a ?? null);
}
export function removeNode(p: any, n: any) {
  return H().removeNode(p, n);
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
export const insert = (r as any).insert as (
  parent: any,
  accessor: any,
  marker?: any,
  initial?: any
) => void;
