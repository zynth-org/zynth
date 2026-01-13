import type { Host, HostNode, Style } from "./HostTypes";

// Map IDs to real DOM nodes
const NODES = new Map<number, HTMLElement | Text>();
const DOM_TO_ID = new WeakMap<Node, number>();
let nextId = 1;
const LAYOUT_OBSERVER_KEY = "__rune_layout_observer";
const LAYOUT_RESIZE_KEY = "__rune_layout_resize";
const LAYOUT_CALLBACK_KEY = "__rune_layout_callback";

export interface WebComponentHandler {
  create: (props: any) => HTMLElement;
  updateProp?: (element: HTMLElement, key: string, value: any) => boolean;
  insertChild?: (
    parent: HTMLElement,
    child: HTMLElement | Text,
    anchor?: HTMLElement | Text | null
  ) => void;
  removeChild?: (parent: HTMLElement, child: HTMLElement | Text) => void;
}

const GLOBAL_REGISTRY_KEY = "__RUNE_WEB_REGISTRY__";
if (!(globalThis as any)[GLOBAL_REGISTRY_KEY]) {
  (globalThis as any)[GLOBAL_REGISTRY_KEY] = new Map<
    string,
    WebComponentHandler
  >();
}
const COMPONENT_REGISTRY = (globalThis as any)[
  GLOBAL_REGISTRY_KEY
] as Map<string, WebComponentHandler>;

export function registerWebComponent(
  type: string,
  handler: WebComponentHandler
) {
  COMPONENT_REGISTRY.set(type, handler);
}

function getDomNode(id: number): HTMLElement | Text {
  const node = NODES.get(id);
  if (!node) throw new Error(`[Web Host] Node with id ${id} not found`);
  return node;
}

const UNIT_PROPS = new Set([
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "top",
  "right",
  "bottom",
  "left",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "marginHorizontal",
  "marginVertical",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "paddingHorizontal",
  "paddingVertical",
  "borderRadius",
  "borderWidth",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "fontSize",
  "lineHeight",
  "gap",
  "rowGap",
  "columnGap",
]);

const PROP_ALIASES = new Map<string, string>([
  ["tintcolor", "tintColor"],
  ["resizemode", "resizeMode"],
]);

function normalizePropName(name: string): string {
  return PROP_ALIASES.get(name) ?? name;
}

function normalizeProps(props: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = {};
  for (const [key, value] of Object.entries(props)) {
    normalized[normalizePropName(key)] = value;
  }
  return normalized;
}

function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

export function normalizeStyle(style: any): any {
  if (!style || typeof style !== "object") return style;
  if (Array.isArray(style)) {
    return style.map(normalizeStyle);
  }
  const next: any = {};
  for (const [key, value] of Object.entries(style)) {
    if (value === undefined || value === null) {
      next[camelToKebab(key)] = "";
      continue;
    }

    if (key === "paddingHorizontal") {
      const v = typeof value === "number" ? `${value}px` : value;
      next["padding-left"] = v;
      next["padding-right"] = v;
      continue;
    }
    if (key === "paddingVertical") {
      const v = typeof value === "number" ? `${value}px` : value;
      next["padding-top"] = v;
      next["padding-bottom"] = v;
      continue;
    }
    if (key === "marginHorizontal") {
      const v = typeof value === "number" ? `${value}px` : value;
      next["margin-left"] = v;
      next["margin-right"] = v;
      continue;
    }
    if (key === "marginVertical") {
      const v = typeof value === "number" ? `${value}px` : value;
      next["margin-top"] = v;
      next["margin-bottom"] = v;
      continue;
    }

    const kebabKey = camelToKebab(key);
    if (typeof value === "number" && UNIT_PROPS.has(key)) {
      next[kebabKey] = `${value}px`;
    } else {
      next[kebabKey] = value;
    }
  }
  return next;
}

import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import { createComponent } from "solid-js";

/**
 * High-level helper to register a Solid component as a Rune web component.
 * This is used for components that need internal Solid state/reactivity
 * but are rendered by the native host (e.g. Screens, Modals, complex Primitives).
 */
export function registerComponent(
  type: string,
  Component: (props: any) => any
) {
  registerWebComponent(type, {
    create: (initialProps) => {
      const container = document.createElement("rune-web-host");
      container.style.display = "contents";
      container.setAttribute("data-type", type);

      if (initialProps && initialProps.style) {
        initialProps.style = normalizeStyle(initialProps.style);
      }

      if (initialProps && initialProps.slot) {
        container.setAttribute("slot", initialProps.slot);
      }

      const [props, setProps] = createStore(initialProps || {});
      (container as any).__setProps = setProps;

      render(() => createComponent(Component, props), container);

      return container;
    },
    updateProp: (element, key, value) => {
      if (key === "slot") {
        element.setAttribute("slot", value);
      }
      const setProps = (element as any).__setProps;
      if (setProps) {
        const finalValue = key === "style" ? normalizeStyle(value) : value;
        setProps({ [key]: finalValue });
        return true;
      }
      return false;
    },
    insertChild: (parent, child, anchor) => {
      let slot = parent.querySelector("[data-rune-slot]") as HTMLElement | null;
      
      // Support named slots: if child has a 'slot' attribute, find matching data-rune-slot
      if (child instanceof HTMLElement && child.getAttribute("slot")) {
        const name = child.getAttribute("slot");
        const namedSlot = parent.querySelector(`[data-rune-slot="${name}"]`) as HTMLElement | null;
        if (namedSlot) slot = namedSlot;
      }

      slot = slot || parent;

      if (anchor && anchor.parentNode === slot) {
        slot.insertBefore(child, anchor);
      } else {
        slot.appendChild(child);
      }
    },
    removeChild: (parent, child) => {
      if (child.parentNode) {
        child.parentNode.removeChild(child);
      }
    },
  });
}

function applyStyle(element: HTMLElement, style: Style | Style[]) {
  if (Array.isArray(style)) {
    style.forEach((s) => s && applyStyle(element, s));
    return;
  }

  const normalized = normalizeStyle(style);
  if (!normalized || typeof normalized !== "object") return;

  const hasAnyBorder =
    "border" in normalized ||
    "border-width" in normalized ||
    "border-color" in normalized;
  const hasTopBorder =
    "border-top-width" in normalized || "border-top-color" in normalized;
  const hasRightBorder =
    "border-right-width" in normalized || "border-right-color" in normalized;
  const hasBottomBorder =
    "border-bottom-width" in normalized ||
    "border-bottom-color" in normalized;
  const hasLeftBorder =
    "border-left-width" in normalized || "border-left-color" in normalized;

  if (hasAnyBorder && !("border-style" in normalized)) {
    (normalized as any)["border-style"] = "solid";
  }
  if (hasTopBorder && !("border-top-style" in normalized)) {
    (normalized as any)["border-top-style"] = "solid";
  }
  if (hasRightBorder && !("border-right-style" in normalized)) {
    (normalized as any)["border-right-style"] = "solid";
  }
  if (hasBottomBorder && !("border-bottom-style" in normalized)) {
    (normalized as any)["border-bottom-style"] = "solid";
  }
  if (hasLeftBorder && !("border-left-style" in normalized)) {
    (normalized as any)["border-left-style"] = "solid";
  }
  
  for (const [key, value] of Object.entries(normalized)) {
    element.style.setProperty(key, String(value));
  }

  const isContents = element.style.display === "contents";

  // Default display to flex to mimic Yoga, but only if not display: contents
  if (!element.style.display) {
    element.style.display = "flex";
  }
  if (!element.style.flexDirection && !isContents) {
    element.style.flexDirection = "column";
  }
  if (!element.style.position && !isContents) {
    element.style.position = "relative";
  }
  if (!element.style.boxSizing && !isContents) {
    element.style.boxSizing = "border-box";
  }
  if (!element.style.minHeight && !isContents) {
    element.style.minHeight = "0";
  }
  if (!element.style.minWidth && !isContents) {
    element.style.minWidth = "0";
  }
}

function emitLayout(element: HTMLElement, callback: (payload: any) => void) {
  const rect = element.getBoundingClientRect();
  callback({
    nativeEvent: {
      layout: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
    },
  });
}

function setLayoutHandler(element: HTMLElement, handler?: (payload: any) => void) {
  const existingObserver = (element as any)[LAYOUT_OBSERVER_KEY] as ResizeObserver | undefined;
  const existingResize = (element as any)[LAYOUT_RESIZE_KEY] as (() => void) | undefined;

  if (existingObserver) {
    existingObserver.disconnect();
    delete (element as any)[LAYOUT_OBSERVER_KEY];
  }
  if (existingResize) {
    window.removeEventListener("resize", existingResize);
    delete (element as any)[LAYOUT_RESIZE_KEY];
  }

  if (!handler) {
    delete (element as any)[LAYOUT_CALLBACK_KEY];
    return;
  }

  (element as any)[LAYOUT_CALLBACK_KEY] = handler;
  const emit = () => emitLayout(element, handler);

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(emit);
  } else {
    setTimeout(emit, 0);
  }

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => emit());
    observer.observe(element);
    (element as any)[LAYOUT_OBSERVER_KEY] = observer;
    return;
  }

  const handleResize = () => emit();
  window.addEventListener("resize", handleResize);
  (element as any)[LAYOUT_RESIZE_KEY] = handleResize;
}

export function createWebHost(): Host {
  return {
    createRootContainer(container: unknown): HostNode {
      // If container is provided (and is an element), use it. Otherwise find #root or use body.
      let rootElement: HTMLElement;
      if (container instanceof HTMLElement) {
        rootElement = container;
      } else {
        rootElement = document.getElementById("root") || document.body;
      }

      // Clear root content for fresh render
      rootElement.innerHTML = "";
      rootElement.classList.add("rune-root");

      // Ensure root acts as a flex container
      rootElement.style.display = "flex";
      rootElement.style.flexDirection = "column";
      rootElement.style.height = "100dvh";
      rootElement.style.overflow = "hidden";

      const id = 0;
      NODES.set(id, rootElement);
      DOM_TO_ID.set(rootElement, id);
      return { id, type: "root" };
    },

    createNode(type, props): HostNode {
      const id = nextId++;
      let element: Element;

      if (props) {
        props = normalizeProps(props as Record<string, any>);
      }

      const handler = COMPONENT_REGISTRY.get(type);

      if (handler) {
        element = handler.create(props);
      } else {
        // Fallback for unregistered components or simple divs
        element = document.createElement("div");
        (element as HTMLElement).dataset.type = type;
      }

      (element as any).__rune_props = props || {};
      NODES.set(id, element as HTMLElement);
      DOM_TO_ID.set(element, id);

      if (props) {
        for (const [rawKey, value] of Object.entries(props)) {
          const key = normalizePropName(rawKey);
          if (key === "style") continue;

          // If we have a handler, let it try to handle the prop update first
          if (handler && handler.updateProp) {
            if (handler.updateProp(element as HTMLElement, key, value)) {
              continue;
            }
          }

          if (key === "onLayout" && typeof value === "function") {
            setLayoutHandler(element as HTMLElement, value as any);
          } else if (key.startsWith("on") && typeof value === "function") {
            const eventName = key.toLowerCase().replace(/^on/, "");
            if (eventName === "press") {
              element.addEventListener("click", value as any);
            } else if (
              ["changetext", "change", "valuechange"].includes(eventName)
            ) {
              // These are handled by the generic listeners above using __rune_props
            } else {
              element.addEventListener(eventName, value as any);
            }
          } else if (key === "value" && element instanceof HTMLInputElement) {
            element.value = String(value);
          } else {
            if (typeof value === "string" || typeof value === "number") {
              element.setAttribute(key, String(value));
            }
          }
        }

        // Apply style LAST so it can override anything set by attributes or handlers
        if (props.style) applyStyle(element as HTMLElement, props.style);
      }

      return { id, type };
    },

    createText(value): HostNode {
      const id = nextId++;
      // console.log(`[Web Host] createText id=${id}`);
      const node = document.createTextNode(value ?? "");
      NODES.set(id, node);
      DOM_TO_ID.set(node, id);
      return { id, type: "text" };
    },

    setProperty(node, name, value) {
      const element = NODES.get(node.id);
      if (!element || !(element instanceof Element)) return;

      name = normalizePropName(name);

      // Update stored props
      (element as any).__rune_props = {
        ...((element as any).__rune_props || {}),
        [name]: value,
      };

      const handler = COMPONENT_REGISTRY.get(node.type);
      if (handler && handler.updateProp) {
        if (handler.updateProp(element as HTMLElement, name, value)) {
          return;
        }
      }

      if (name === "style") {
        applyStyle(element as HTMLElement, value);
      } else if (name === "onLayout") {
        setLayoutHandler(element as HTMLElement, value as any);
      } else if (name.startsWith("on") && typeof value === "function") {
        const eventName = name.toLowerCase().replace(/^on/, "");
        if (eventName === "press") {
          element.addEventListener("click", value as any);
        } else if (
          ["changetext", "change", "valuechange"].includes(eventName)
        ) {
          // Handled via __rune_props
        } else {
          element.addEventListener(eventName, value as any);
        }
      } else if (name === "value" && element instanceof HTMLInputElement) {
        element.value = String(value);
      } else {
        if (value === null || value === undefined) {
          element.removeAttribute(name);
        } else {
          element.setAttribute(name, String(value));
        }
      }
    },

    setText(node, value) {
      const element = NODES.get(node.id);
      if (element) {
        element.textContent = value ?? "";
      }
    },

    insertNode(parent, node, anchor) {
      // console.log(`[Web Host] insertNode parent=${parent.id} node=${node.id}`);
      const parentEl = NODES.get(parent.id);
      const childEl = NODES.get(node.id);

      if (!parentEl || !(parentEl instanceof Element)) {
        console.error(`[Web Host] Parent node ${parent.id} not found or invalid`);
        return;
      }
      if (!childEl) {
        return;
      }

      const handler = COMPONENT_REGISTRY.get(parent.type);
      if (handler && handler.insertChild) {
        const anchorEl = anchor ? (NODES.get(anchor.id) as HTMLElement | Text) : null;
        handler.insertChild(parentEl as HTMLElement, childEl as HTMLElement | Text, anchorEl as any);
        return;
      }

      if (anchor) {
        const anchorEl = NODES.get(anchor.id);
        if (anchorEl) {
          parentEl.insertBefore(childEl, anchorEl);
          return;
        }
      }

      parentEl.appendChild(childEl);
    },

    removeNode(parent, node) {
      const parentEl = NODES.get(parent.id);
      const childEl = NODES.get(node.id);
      if (parentEl && parentEl instanceof HTMLElement && childEl) {
        const handler = COMPONENT_REGISTRY.get(parent.type);
        if (handler && handler.removeChild) {
          handler.removeChild(parentEl, childEl);
          return;
        }
        // Fallback safety: ensure child is actually a child of parent before removing
        if (childEl.parentNode === parentEl) {
          parentEl.removeChild(childEl);
        } else if (childEl.parentNode) {
           // If child is in a slot (not direct child), and no handler, we might have an issue.
           // But normally removing from parentNode works if we know the node.
           childEl.parentNode.removeChild(childEl);
        }
      }
    },

    getParentNode(node) {
      const el = NODES.get(node.id);
      if (!el || !el.parentNode) return null;
      const parentId = DOM_TO_ID.get(el.parentNode);
      if (parentId === undefined) return null;
      // We don't store types in DOM_TO_ID, assume view/root
      return { id: parentId, type: "view" };
    },

    getFirstChild(node) {
      const el = NODES.get(node.id);
      if (!el || !el.firstChild) return null;
      const childId = DOM_TO_ID.get(el.firstChild);
      if (childId === undefined) return null;
      // Identify text nodes
      const type = el.firstChild.nodeType === 3 ? "text" : "view";
      return { id: childId, type };
    },

    getNextSibling(node) {
      const el = NODES.get(node.id);
      if (!el || !el.nextSibling) return null;
      const sibId = DOM_TO_ID.get(el.nextSibling);
      if (sibId === undefined) return null;
      const type = el.nextSibling.nodeType === 3 ? "text" : "view";
      return { id: sibId, type };
    },

    getText(node) {
      const el = NODES.get(node.id);
      return el ? el.textContent || "" : "";
    },

    enableRecycling() {
      return "web-recycling";
    },

    disableRecycling() {},
    reclaimNode() {},
    acquireNode() {
      return null;
    },
    updateNodeBinding() {},
  };
}
