import { registerWebComponent } from "@rune/core";

registerWebComponent("switch", {
  create: () => {
    const element = document.createElement("input");
    element.type = "checkbox";
    element.classList.add("rune-switch");
    element.addEventListener("change", (e) => {
      const target = e.target as HTMLInputElement;
      const props = (element as any).__rune_props || {};
      if (typeof props.onValueChange === "function") {
        props.onValueChange(target.checked);
      }
    });
    return element;
  },
});

registerWebComponent("slider", {
  create: () => {
    const element = document.createElement("input");
    element.type = "range";
    element.classList.add("rune-slider");
    element.addEventListener("input", (e) => {
      const target = e.target as HTMLInputElement;
      const props = (element as any).__rune_props || {};
      if (typeof props.onValueChange === "function") {
        props.onValueChange(Number(target.value));
      }
    });
    return element;
  },
});
