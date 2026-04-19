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
  insert,
  spread,
  use,
} from "./renderer";

// Minimal universal helpers some transforms import
import * as R from "./renderer";
import type { HostNode } from "./host/HostTypes";

export function setProperty(
  node: HostNode,
  name: string,
  value: any,
  _prev?: any
) {
  R.setProperty(node as any, name as any, value as any);
}

export const setProp = (node: HostNode, name: string, value: any) => {
  setProperty(node, name, value);
};
