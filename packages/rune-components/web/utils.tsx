import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import { createComponent } from "solid-js";
import { registerWebComponent } from "@rune/core";

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

function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function normalizeStyle(style: any): any {
  if (!style || typeof style !== "object") return style;
  if (Array.isArray(style)) return style.map(normalizeStyle);
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

      const [props, setProps] = createStore(initialProps || {});
      (container as any).__setProps = setProps;

      render(() => createComponent(Component, props), container);

      return container;
    },
    updateProp: (element, key, value) => {
      const setProps = (element as any).__setProps;
      if (setProps) {
        const finalValue = key === "style" ? normalizeStyle(value) : value;
        setProps({ [key]: finalValue });
        return true;
      }
      return false;
    },
    insertChild: (parent, child, anchor) => {
      const slot = parent.querySelector("[data-rune-slot]") || parent;
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
