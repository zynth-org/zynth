import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import { createComponent } from "solid-js";
import { registerWebComponent } from "@rune/core";

export function registerComponent(
  type: string,
  Component: (props: any) => any
) {
  registerWebComponent(type, {
    create: (initialProps) => {
      const container = document.createElement("rune-web-host");
      container.style.display = "contents";
      container.setAttribute("data-type", type);

      const [props, setProps] = createStore(initialProps || {});
      (container as any).__setProps = setProps;

      render(() => createComponent(Component, props), container);

      return container;
    },
    updateProp: (element, key, value) => {
      const setProps = (element as any).__setProps;
      if (setProps) {
        setProps({ [key]: value });
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
