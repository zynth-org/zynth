import { registerWebComponent } from "@rune/core";

const updateSource = (element: HTMLElement, value: any) => {
  if (value?.uri) {
    (element as HTMLImageElement).src = value.uri;
    delete element.dataset.systemName;
  } else if (value?.system) {
    element.dataset.systemName = value.system;
    // Prevent broken image icon if no src is provided
    if (!(element as HTMLImageElement).src) {
      (element as HTMLImageElement).src =
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    }
  }
};

registerWebComponent("image", {
  create: (props) => {
    const element = document.createElement("img");
    element.classList.add("rune-image");
    if (props?.source) {
      updateSource(element, props.source);
    }
    return element;
  },
  updateProp: (element, key, value) => {
    if (key === "source" && typeof value === "object") {
      updateSource(element, value);
      return true;
    }
    return false;
  },
});
