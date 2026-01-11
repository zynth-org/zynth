import { registerWebComponent } from "@rune/core";

registerWebComponent("menu-item-view", {
  create: (props) => {
    const container = document.createElement("div");
    container.className = "rune-menu-item-view";
    // Styles are applied by core

    const label = document.createElement("span");
    label.style.flex = "1";
    label.style.fontSize = "16px";
    label.textContent = props?.label || "";
    container.appendChild(label);

    const slot = document.createElement("div");
    slot.setAttribute("data-rune-slot", "");
    slot.style.display = "flex";
    slot.style.marginLeft = "8px";
    container.appendChild(slot);

    return container;
  },
  updateProp: (element, key, value) => {
    if (key === "label") {
      const label = element.querySelector("span");
      if (label) label.textContent = value;
      return true;
    }
    return false;
  },
  insertChild: (parent, child, anchor) => {
    const slot = parent.querySelector("[data-rune-slot]");
    if (slot) {
      if (anchor && anchor.parentNode === slot) {
        slot.insertBefore(child, anchor);
      } else {
        slot.appendChild(child);
      }
    } else {
      parent.appendChild(child);
    }
  },
  removeChild: (parent, child) => {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
  },
});
