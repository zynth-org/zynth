import { createRenderer } from "solid-js/universal";
import type { Host, HostNode } from "./host/HostTypes";

let host: Host | null = null;
export const setHost = (h: Host) => (host = h);
const H = (): Host => {
  if (!host) throw new Error("Host not set");
  return host;
};

// Use `any` for TNode to avoid over-constraining app JSX return types
const r = createRenderer<any, HostNode>({
  createElement: (t) => H().createNode(t as any),
  createTextNode: (v) => H().createText(v),
  replaceText: (n, v) => H().setText(n, v),
  setProperty: (n, k, v) => H().setProperty(n, k, v),
  insertNode: (p, n, a) => H().insertNode(p, n, a ?? null),
  removeNode: (p, n) => H().removeNode(p, n),
  isTextNode: (n) => n.type === "text",
  getParentNode: (n) => H().getParentNode(n),
  getFirstChild: (n) => H().getFirstChild(n),
  getNextSibling: (n) => H().getNextSibling(n),
  getNodeValue: (n) => H().getText(n),
});

// Loosen the render signature so apps can pass `() => JSX.Element`
// and auto-create a root container if one isn't provided.
export const render: (code: () => any, container?: HostNode | null) => void = (code, container) => {
  let c = container as HostNode | null | undefined;
  if (!c || typeof (c as any).id !== "number") {
    const make = (host as any)?.createRootContainer as ((arg: unknown) => HostNode) | undefined;
    c = make ? make(undefined) : ({ id: 0, type: "root" } as any);
  }
  (r.render as any)(code as any, c as any);
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
export function insertNode(p: any, n: any, a?: any) {
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
