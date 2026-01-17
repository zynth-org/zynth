import {
  createComponent,
  createMemo as solidCreateMemo,
  createRenderEffect,
  createRoot,
  mergeProps,
  untrack,
} from "solid-js";
import type { Host, HostNode, HostBatchMeta } from "./host/HostTypes";

let host: Host | null = null;
export const setHost = (h: Host) => (host = h);
export const getHost = (): Host | null => host;
const H = (): Host => {
  if (!host) throw new Error("Host not set");
  return host;
};

export const memo = <T>(fn: () => T) => solidCreateMemo(() => fn());

// at top:
let __markerId = -1;
function createMarker(): HostNode {
  return { id: __markerId--, type: "marker" };
}

type RendererOptions<TNode> = {
  createElement: (tag: any) => TNode;
  createTextNode: (text: any) => TNode;
  createComment: () => TNode;
  replaceText: (node: TNode, text: any) => void;
  insertNode: (parent: TNode, node: TNode, marker?: TNode | null) => void;
  removeNode: (parent: TNode, node: TNode) => void;
  setProperty: (node: TNode, name: any, value: any, prev?: any) => void;
  getParentNode: (node: TNode) => TNode | null;
  getFirstChild: (node: TNode) => TNode | null;
  getNextSibling: (node: TNode) => TNode | null;
  getNodeValue: (node: TNode) => any;
  isTextNode: (node: TNode) => boolean;
};

type Renderer<TNode> = {
  render: (code: () => any, element: TNode) => () => void;
  insert: (parent: TNode, accessor: any, marker?: TNode, initial?: any) => void;
  spread: (node: TNode, accessor: any, skipChildren?: boolean) => any;
  createElement: (tag: any) => TNode;
  createTextNode: (text: any) => TNode;
  insertNode: (parent: TNode, node: TNode, marker?: TNode | null) => void;
  setProp: (node: TNode, name: any, value: any, prev?: any) => any;
  mergeProps: typeof mergeProps;
  effect: typeof createRenderEffect;
  memo: typeof memo;
  createComponent: typeof createComponent;
  use: (fn: (value: any, arg: any) => any, element: any, arg: any) => any;
};

function createZynthRenderer<TNode>(
  options: RendererOptions<TNode>
): Renderer<TNode> {
  const {
    createElement,
    createTextNode,
    createComment,
    replaceText,
    insertNode,
    removeNode,
    setProperty,
    getParentNode,
    getFirstChild,
    getNextSibling,
    getNodeValue,
    isTextNode,
  } = options;

  function normalizeIncomingArray(
    normalized: any[],
    array: any[],
    unwrap?: boolean
  ): boolean {
    let dynamic = false;
    for (let i = 0, len = array.length; i < len; i++) {
      let item = array[i];
      let type: string;
      if (item == null || item === true || item === false) {
        // skip
      } else if (Array.isArray(item)) {
        dynamic = normalizeIncomingArray(normalized, item, unwrap) || dynamic;
      } else if ((type = typeof item) === "string" || type === "number") {
        normalized.push(createTextNode(item));
      } else if (type === "function") {
        if (unwrap) {
          while (typeof item === "function") item = item();
          const items = Array.isArray(item) ? item : [item];
          dynamic =
            normalizeIncomingArray(normalized, items, unwrap) || dynamic;
        } else {
          normalized.push(item);
          dynamic = true;
        }
      } else {
        normalized.push(item);
      }
    }
    return dynamic;
  }

  function appendNodes(parent: TNode, array: any[], marker?: TNode | null) {
    for (let i = 0, len = array.length; i < len; i++) {
      insertNode(parent, array[i], marker ?? null);
    }
  }

  function replaceNode(parent: TNode, newNode: any, oldNode: any) {
    insertNode(parent, newNode, oldNode);
    removeNode(parent, oldNode);
  }

  function cleanChildren(
    parent: TNode,
    current: any,
    marker: TNode | null | undefined,
    replacement?: any
  ): any {
    const fallbackRemoveAll = () => {
      let removed;
      while ((removed = getFirstChild(parent))) {
        removeNode(parent, removed);
      }
      if (replacement) {
        insertNode(parent, replacement, marker ?? undefined);
        return [replacement];
      }
      return "";
    };

    if (marker === undefined) {
      return fallbackRemoveAll();
    }

    // If we have a marker, remove all children between the marker and the end
    let node = getFirstChild(parent);
    let foundMarker = false;
    const toRemove: TNode[] = [];

    while (node) {
      if (node === marker) {
        foundMarker = true;
      } else if (foundMarker) {
        toRemove.push(node);
      }
      node = getNextSibling(node);
    }

    // Remove all marked nodes
    for (const child of toRemove) {
      removeNode(parent, child);
    }

    if (replacement) {
      insertNode(parent, replacement, marker ?? undefined);
      return [replacement];
    }
    return "";
  }

  function reconcileArrays(parentNode: TNode, a: any[], b: any[]) {
    let bLength = b.length;
    let aEnd = a.length;
    let bEnd = bLength;
    let aStart = 0;
    let bStart = 0;
    let after = getNextSibling(a[aEnd - 1]);
    let map: Map<any, number> | null = null;
    while (aStart < aEnd || bStart < bEnd) {
      if (a[aStart] === b[bStart]) {
        aStart++;
        bStart++;
        continue;
      }
      while (a[aEnd - 1] === b[bEnd - 1]) {
        aEnd--;
        bEnd--;
      }
      if (aEnd === aStart) {
        const node =
          bEnd < bLength
            ? bStart
              ? getNextSibling(b[bStart - 1])
              : b[bEnd - bStart]
            : after;
        while (bStart < bEnd) insertNode(parentNode, b[bStart++], node);
      } else if (bEnd === bStart) {
        while (aStart < aEnd) {
          if (!map || !map.has(a[aStart])) removeNode(parentNode, a[aStart]);
          aStart++;
        }
      } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]) {
        const node = getNextSibling(a[--aEnd]);
        insertNode(parentNode, b[bStart++], getNextSibling(a[aStart++]));
        insertNode(parentNode, b[--bEnd], node);
        a[aEnd] = b[bEnd];
      } else {
        if (!map) {
          map = new Map();
          for (let i = bStart; i < bEnd; i++) map.set(b[i], i);
        }
        const index = map.get(a[aStart]);
        if (index != null) {
          if (bStart < index && index < bEnd) {
            let i = aStart;
            let sequence = 1;
            let t;
            while (++i < aEnd && i < bEnd) {
              t = map.get(a[i]);
              if (t == null || t !== index + sequence) break;
              sequence++;
            }
            if (sequence > index - bStart) {
              const node = a[aStart];
              while (bStart < index) insertNode(parentNode, b[bStart++], node);
            } else replaceNode(parentNode, b[bStart++], a[aStart++]);
          } else aStart++;
        } else removeNode(parentNode, a[aStart++]);
      }
    }
  }

  function insertExpression(
    parent: TNode,
    value: any,
    current: any,
    marker?: TNode,
    unwrapArray?: boolean
  ): any {
    while (typeof current === "function") current = current();
    if (value === current) return current;
    const valueType = typeof value;
    const multi = marker !== undefined;

    if (valueType === "string" || valueType === "number") {
      if (valueType === "number") value = value.toString();
      if (multi) {
        let node = current && current[0];
        if (node && isTextNode(node)) {
          replaceText(node, value);
        } else node = createTextNode(value);
        current = cleanChildren(parent, current, marker, node);
      } else {
        if (current !== "" && typeof current === "string") {
          const first = getFirstChild(parent);
          if (first) replaceText(first, (current = value));
        } else {
          cleanChildren(parent, current, undefined, createTextNode(value));
          current = value;
        }
      }
    } else if (value == null || valueType === "boolean") {
      current = cleanChildren(parent, current, marker);
    } else if (valueType === "function") {
      createRenderEffect(() => {
        let v = value();
        while (typeof v === "function") v = v();
        current = insertExpression(parent, v, current, marker);
      });
      return () => current;
    } else if (Array.isArray(value)) {
      const array: any[] = [];
      if (normalizeIncomingArray(array, value, unwrapArray)) {
        createRenderEffect(
          () =>
            (current = insertExpression(parent, array, current, marker, true))
        );
        return () => current;
      }
      if (array.length === 0) {
        const replacement = cleanChildren(parent, current, marker);
        if (multi) return (current = replacement);
      } else {
        if (Array.isArray(current)) {
          if (current.length === 0) {
            appendNodes(parent, array, marker);
          } else reconcileArrays(parent, current, array);
        } else if (current == null || current === "") {
          appendNodes(parent, array);
        } else {
          const baseline = multi && current ? current : [getFirstChild(parent)];
          reconcileArrays(parent, baseline as any[], array);
        }
      }
      current = array;
    } else {
      if (Array.isArray(current)) {
        // Always use cleanChildren for array replacement to ensure proper cleanup
        current = cleanChildren(parent, current, marker, value);
      } else if (current == null || current === "") {
        insertNode(parent, value, marker);
        current = value;
      } else {
        // For single node replacement, ensure proper cleanup
        const firstChild = getFirstChild(parent);
        if (firstChild && firstChild !== value) {
          replaceNode(parent, value, firstChild);
          current = value;
        } else if (!firstChild) {
          insertNode(parent, value, marker);
          current = value;
        }
      }
    }
    return current;
  }

  function spreadExpression(
    node: any,
    props: Record<string, any>,
    prevProps: Record<string, any> = {},
    skipChildren?: boolean
  ) {
    props || (props = {});
    if (!skipChildren) {
      createRenderEffect(
        () =>
          (prevProps.children = insertExpression(
            node,
            props.children,
            prevProps.children
          ))
      );
    }
    createRenderEffect(() => props.ref && props.ref(node));
    createRenderEffect(() => {
      for (const prop in props) {
        if (prop === "children" || prop === "ref") continue;
        const value = props[prop];
        if (value === prevProps[prop]) continue;
        setProperty(node, prop, value, prevProps[prop]);
        prevProps[prop] = value;
      }
      for (const prop in prevProps) {
        if (!(prop in props)) {
          if (prop === "children" || prop === "ref") continue;
          setProperty(node, prop, undefined, prevProps[prop]);
          delete prevProps[prop];
        }
      }
    });
    return prevProps;
  }

  function insert(parent: TNode, accessor: any, marker?: TNode, initial?: any) {
    if (marker !== undefined && !initial) initial = [];
    if (typeof accessor !== "function") {
      return insertExpression(parent, accessor, initial, marker);
    }
    createRenderEffect(
      (current) => insertExpression(parent, accessor(), current, marker),
      initial
    );
  }

  return {
    render(code: () => any, element: TNode) {
      let disposer: () => void = () => undefined;
      createRoot((dispose) => {
        disposer = dispose;
        insert(element, code());
      });
      return disposer;
    },
    insert,
    spread(node: any, accessor: any, skipChildren?: boolean) {
      if (typeof accessor === "function") {
        createRenderEffect((current) =>
          spreadExpression(node, accessor(), current as any, skipChildren)
        );
      } else {
        spreadExpression(node, accessor, undefined, skipChildren);
      }
    },
    createElement,
    createTextNode,
    insertNode,
    setProp(node: any, name: any, value: any, prev: any) {
      setProperty(node, name, value, prev);
      return value;
    },
    mergeProps,
    effect: createRenderEffect,
    memo,
    createComponent,
    use(fn: (value: any, arg: any) => any, element: any, arg: any) {
      return untrack(() => fn(element, arg));
    },
  };
}

// Use custom renderer with guards for opaque entries
const r = createZynthRenderer<HostNode>({
  createElement: (t: any) => H().createNode(t as any),
  createTextNode: (v: any) => H().createText(v),
  createComment: () => createMarker(),
  replaceText: (n: any, v: any) => H().setText(n, v),
  setProperty: (n: any, k: any, v: any, prev: any) => H().setProperty(n, k, v),
  insertNode: (p: any, n: any, a: any) => H().insertNode(p, n, a ?? null),
  removeNode: (p: any, n: any) => H().removeNode(p, n),
  isTextNode: (n: any) => n.type === "text",
  getParentNode: (n: any) => H().getParentNode(n),
  getFirstChild: (n: any) => H().getFirstChild(n),
  getNextSibling: (n: any) => H().getNextSibling(n),
  getNodeValue: (n: any) => H().getText(n),
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
export const spread = (r as any).spread as (
  node: any,
  accessor: any,
  skipChildren?: boolean
) => any;
export const use = (r as any).use as (
  fn: (value: any, arg: any) => any,
  element: any,
  arg: any
) => any;
