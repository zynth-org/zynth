import { registerWebComponent } from "@rune/core";

const divComponents = [
  "view",
  "pressable",
  "glass-view",
  "glass-container",
  "menu-view",
  "menu-trigger-view",
  "date-picker-view",
  "date-picker-trigger-view",
];

divComponents.forEach((type) => {
  registerWebComponent(type, {
    create: () => {
      const element = document.createElement("div");
      // "pressable" is usually a view in class map logic
      const className = type === "pressable" ? "rune-view" : `rune-${type}`;
      element.classList.add(className);
      return element;
    },
  });
});

registerWebComponent("button", {
  create: () => {
    const element = document.createElement("button");
    element.classList.add("rune-button");
    return element;
  },
});

registerWebComponent("text", {
  create: () => {
    const element = document.createElement("span");
    element.style.display = "inline-block";
    element.classList.add("rune-text");
    return element;
  },
});
