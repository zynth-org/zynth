import { registerWebComponent } from "@rune/core";

registerWebComponent("scroll-view", {
  create: () => {
    const element = document.createElement("div");
    element.style.overflow = "auto";
    (element.style as any).webkitOverflowScrolling = "touch";
    element.classList.add("rune-scroll-view");
    return element;
  },
});
