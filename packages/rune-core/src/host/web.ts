import type { Host, HostNode, Style } from "./HostTypes";

// Map IDs to real DOM nodes
const NODES = new Map<number, HTMLElement | Text>();
const DOM_TO_ID = new WeakMap<Node, number>();
let nextId = 1;

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
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
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

function applyStyle(element: HTMLElement, style: Style | Style[]) {
  if (Array.isArray(style)) {
    style.forEach((s) => s && applyStyle(element, s));
    return;
  }

  for (const [key, value] of Object.entries(style)) {
    if (value === undefined || value === null) {
      (element.style as any)[key] = "";
      continue;
    }

    let normalizedValue = value;
    if (typeof value === "number" && UNIT_PROPS.has(key)) {
      normalizedValue = `${value}px`;
    }

    (element.style as any)[key] = normalizedValue;
  }

  // Default display to flex to mimic Yoga
  if (!element.style.display) {
    element.style.display = "flex";
  }
  if (!element.style.flexDirection) {
    element.style.flexDirection = "column";
  }
  if (!element.style.position) {
    element.style.position = "relative";
  }
  if (!element.style.boxSizing) {
    element.style.boxSizing = "border-box";
  }
  if (!element.style.minHeight) {
    element.style.minHeight = "0";
  }
  if (!element.style.minWidth) {
    element.style.minWidth = "0";
  }
}


const CLASS_MAP: Record<string, string> = {
  view: "rune-view",
  pressable: "rune-view", // pressable is usually a view
  text: "rune-text",
  image: "rune-image",
  "text-input": "rune-text-input",
  "secure-text-input": "rune-text-input",
  button: "rune-button",
  "scroll-view": "rune-scroll-view",
  switch: "rune-switch",
  slider: "rune-slider",
};

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
      rootElement.style.height = "100vh";
      rootElement.style.overflow = "hidden";

      const id = 0;
      NODES.set(id, rootElement);
      DOM_TO_ID.set(rootElement, id);
      return { id, type: "root" };
    },

    createNode(type, props): HostNode {
      const id = nextId++;
      // console.log(`[Web Host] createNode ${type} id=${id}`);
      let element: HTMLElement;

      switch (type) {
        case "view":
        case "pressable":
          element = document.createElement("div");
          break;
        case "text":
          element = document.createElement("span");
          element.style.display = "inline-block";
          break;
        case "image":
          element = document.createElement("img");
          break;
        case "text-input":
        case "secure-text-input":
          element = document.createElement("input");
          if (type === "secure-text-input") {
            (element as HTMLInputElement).type = "password";
          }
          // Handle native Rune events for input
          element.addEventListener("input", (e) => {
            const target = e.target as HTMLInputElement;
            // Use internal storage for handlers because they are passed as props, not DOM events
            const props = (element as any).__rune_props || {};
            if (typeof props.onChangeText === "function") {
              props.onChangeText({ text: target.value });
            }
            if (typeof props.onChange === "function") {
              props.onChange({
                textAfter: target.value,
                composing: false, // basic support
                range: {
                  start: target.selectionStart,
                  end: target.selectionEnd,
                },
              });
            }
          });
          break;
        case "button":
          element = document.createElement("button");
          break;
        case "scroll-view":
          element = document.createElement("div");
          element.style.overflow = "auto";
          (element.style as any).webkitOverflowScrolling = "touch";
          break;
        case "switch":
          element = document.createElement("input");
          (element as HTMLInputElement).type = "checkbox";
          element.addEventListener("change", (e) => {
            const target = e.target as HTMLInputElement;
            const props = (element as any).__rune_props || {};
            if (typeof props.onValueChange === "function") {
              props.onValueChange(target.checked);
            }
          });
          break;
        case "slider":
          element = document.createElement("input");
          (element as HTMLInputElement).type = "range";
          element.addEventListener("input", (e) => {
            const target = e.target as HTMLInputElement;
            const props = (element as any).__rune_props || {};
            if (typeof props.onValueChange === "function") {
              props.onValueChange(Number(target.value));
            }
          });
          break;
        default:
          element = document.createElement("div");
          element.dataset.type = type;
          break;
      }

      (element as any).__rune_props = props || {};
      NODES.set(id, element);
      DOM_TO_ID.set(element, id);

      if (CLASS_MAP[type]) {
        element.classList.add(CLASS_MAP[type]);
      }

      if (props) {
        if (props.style) applyStyle(element, props.style);

        for (const [key, value] of Object.entries(props)) {
          if (key === "style") continue;

          if (key.startsWith("on") && typeof value === "function") {
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
          } else if (
            key === "source" &&
            type === "image" &&
            typeof value === "object"
          ) {
            if ((value as any).uri) {
              (element as HTMLImageElement).src = (value as any).uri;
            }
          } else if (key === "value" && element instanceof HTMLInputElement) {
            element.value = String(value);
          } else if (
            key === "placeholder" &&
            element instanceof HTMLInputElement
          ) {
            element.placeholder = String(value);
          } else {
            if (typeof value === "string" || typeof value === "number") {
              element.setAttribute(key, String(value));
            }
          }
        }
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
      if (!element || !(element instanceof HTMLElement)) return;

      // Update stored props
      (element as any).__rune_props = {
        ...((element as any).__rune_props || {}),
        [name]: value,
      };

      if (name === "style") {
        applyStyle(element, value);
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
      } else if (
        name === "source" &&
        element.tagName === "IMG" &&
        typeof value === "object"
      ) {
        if ((value as any)?.uri) {
          (element as HTMLImageElement).src = (value as any).uri;
        }
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

      if (!parentEl) {
        console.error(`[Web Host] Parent node ${parent.id} not found`);
        return;
      }
      if (!childEl) {
        console.error(`[Web Host] Child node ${node.id} not found`);
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
      if (parentEl && childEl) {
        parentEl.removeChild(childEl);
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
