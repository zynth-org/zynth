import { registerWebComponent } from "@rune/core";

const setupInput = (type: string) => {
  registerWebComponent(type, {
    create: () => {
      const element = document.createElement("input");
      element.classList.add("rune-text-input");
      if (type === "secure-text-input") {
        element.type = "password";
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
      return element;
    },
    updateProp: (element, key, value) => {
      if (key === "value") {
        (element as HTMLInputElement).value = String(value);
        return true;
      }
      if (key === "placeholder") {
        (element as HTMLInputElement).placeholder = String(value);
        return true;
      }
      return false;
    },
  });
};

setupInput("text-input");
setupInput("secure-text-input");

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
