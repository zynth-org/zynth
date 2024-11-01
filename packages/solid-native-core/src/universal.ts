// Solid core helpers expected by the Babel universal transform
export { createComponent, mergeProps, untrack } from "solid-js";

// Renderer operations exposed for the universal runtime (named exports only)
export {
  render,
  effect,
  memo,
  createElement,
  createTextNode,
  replaceText,
  insertNode,
  removeNode,
  getParentNode,
  getFirstChild,
  getNextSibling,
  getNodeValue,
  isTextNode,
} from "./renderer";

// Minimal universal helpers some transforms import
import * as R from "./renderer";
import { effect } from "./renderer";
import type { HostNode } from "./host/HostTypes";

export function setProperty(node: HostNode, name: string, value: any, _prev?: any) {
  R.setProperty(node as any, name as any, value as any);
}

export const setProp = (node: HostNode, name: string, value: any) => {
  setProperty(node, name, value);
};

export function insert(parent: HostNode, value: any, _marker?: any, _initial?: any) {
  const append = (v: any): void => {
    if (v == null || v === false) return;
    if (Array.isArray(v)) { for (const item of v) append(item); return; }
    if (typeof v === "function") { effect(() => append(v())); return; }
    if (typeof v === "string" || typeof v === "number") {
      const t = R.createTextNode(String(v) as any);
      R.insertNode(parent as any, t as any, null as any);
      return;
    }
    // assume HostNode
    R.insertNode(parent as any, v as any, null as any);
  };
  append(value);
}

// Provide a stable named export that some transforms import early
// (setProperty already defined above)
