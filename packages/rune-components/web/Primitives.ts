import { registerWebComponent } from "@rune/core";

const divComponents = [
  "view",
  "pressable",
  "glass-view",
  "glass-container",
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

const svgComponents = [
  "svg",
  "path",
  "circle",
  "rect",
  "polyline",
  "polygon",
  "g",
  "line",
  "ellipse",
  "defs",
  "mask",
  "symbol",
  "use",
];

svgComponents.forEach((type) => {
  registerWebComponent(type, {
    create: () => {
      const element = document.createElementNS("http://www.w3.org/2000/svg", type);
      // Ensure SVG elements have correct pointer-events behavior if needed
      return element as any;
    },
  });
});
