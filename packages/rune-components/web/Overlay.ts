import { registerWebComponent } from "@rune/core";

registerWebComponent("rune-modal", {
  create: () => {
    const element = document.createElement("div");
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-modal", "true");
    element.classList.add("rune-modal");
    return element;
  },
});

registerWebComponent("progress-indicator", {
  create: () => {
    const element = document.createElement("div");
    element.setAttribute("role", "progressbar");
    element.classList.add("rune-progress-indicator");
    return element;
  },
});

["rune-status-bar", "rune-alert"].forEach((type) => {
  registerWebComponent(type, {
    create: () => {
      const element = document.createElement("div");
      element.style.display = "none";
      element.classList.add(type);
      return element;
    },
  });
});
