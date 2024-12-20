import type { Host, HostNode, Style } from "./HostTypes";
import type { RuneUIBridge } from "../bridge";

export function createAndroidHost(): Host {
  const g: any =
    typeof globalThis !== "undefined"
      ? globalThis
      : // eslint-disable-next-line @typescript-eslint/no-implied-eval
        (0, eval)("this");
  const ui =
    (g.__ui as RuneUIBridge | undefined) ??
    (() => {
      throw new Error("__ui not found (native bindings missing)");
    })();

  const PARENTS = new Map<number, number | null>();
  const CHILDREN = new Map<number, number[]>();
  const TEXTS = new Map<number, string>();
  const TYPES = new Map<number, HostNode["type"]>();

  let flushScheduled = false;
  const schedule = () => {
    if (flushScheduled) return;
    flushScheduled = true;
    if (typeof setTimeout !== "undefined") {
      setTimeout(() => {
        flushScheduled = false;
        try {
          ui.flush();
        } catch (e) {
          console.error("Flush error:", e);
        }
      }, 0);
    } else {
      Promise.resolve()
        .then(() => {
          flushScheduled = false;
          try {
            ui.flush();
          } catch (e) {
            console.error("Flush error:", e);
          }
        })
        .catch(() => {
          flushScheduled = false;
          try {
            ui.flush();
          } catch (e) {
            console.error("Flush error:", e);
          }
        });
    }
  };

  const ensure = (id: number) =>
    CHILDREN.has(id)
      ? CHILDREN.get(id)!
      : (CHILDREN.set(id, []), CHILDREN.get(id)!);

  // helper to compute physical index (exclude markers)
  const physicalIndex = (parentId: number, logicalInsertIdx: number) => {
    const kids = ensure(parentId);
    let count = 0;
    for (let i = 0; i < logicalInsertIdx; i++) {
      const k = kids[i];
      // find child type; markers are negative ids (from renderer.ts) => skip native
      const isMarker = k < 0; // relies on marker ids < 0
      if (!isMarker) count++;
    }
    return count;
  };

  const isMarkerId = (id: number) => id < 0;
  const typeFor = (id: number): HostNode["type"] =>
    TYPES.get(id) ?? (isMarkerId(id) ? "marker" : "view");

  const nodeFor = (id: number): HostNode => ({ id, type: typeFor(id) });

  const api: Host = {
    createRootContainer() {
      PARENTS.set(0, null);
      CHILDREN.set(0, []);
      TYPES.set(0, "root");
      return { id: 0, type: "root" };
    },
    createNode(type, props) {
      const id: number = ui.createNode(type);
      PARENTS.set(id, null);
      CHILDREN.set(id, []);
      TYPES.set(id, type);
      if (props?.style) ui.setProp(id, "style", props.style as Style);
      if (typeof props?.onPress === "function") {
        ui.setHandler(id, "onPress", props.onPress);
      }
      if (props?.accessibilityLabel)
        ui.setProp(id, "accessibilityLabel", props.accessibilityLabel);
      if (props?.accessibilityHint)
        ui.setProp(id, "accessibilityHint", props.accessibilityHint);
      if (props?.accessibilityRole)
        ui.setProp(id, "accessibilityRole", props.accessibilityRole);
      if (props?.pointerEvents) ui.setProp(id, "pointerEvents", props.pointerEvents);
      if (props?.testID) ui.setProp(id, "testID", props.testID);
      schedule();
      return { id, type } as HostNode;
    },
    createText(value) {
      const id: number = ui.createNode("text");
      ui.setText(id, value ?? "");
      PARENTS.set(id, null);
      CHILDREN.set(id, []);
      TEXTS.set(id, value ?? "");
      TYPES.set(id, "text");
      schedule();
      return { id, type: "text" };
    },
    setProperty(node, name, value) {
      if (name === "style") {
        ui.setProp(node.id, "style", value || {});
      } else if (typeof value === "function") {
        ui.setHandler(node.id, name, value);
      } else {
        ui.setProp(node.id, name, value);
      }
      schedule();
    },
    setText(node, value) {
      TEXTS.set(node.id, value ?? "");
      ui.setText(node.id, value ?? "");
      schedule();
    },
    insertNode(parent, node, anchor) {
      const kids = ensure(parent.id);
      const aIdx = anchor ? kids.indexOf(anchor.id) : -1;
      const logicalAt = aIdx >= 0 ? aIdx : kids.length;

      // physical index counts only non-markers STRICTLY BEFORE logicalAt
      let physIdx = 0;
      for (let i = 0; i < logicalAt; i++) if (!isMarkerId(kids[i])) physIdx++;

      // mutate logical structure AFTER computing physIdx
      kids.splice(logicalAt, 0, node.id);
      PARENTS.set(node.id, parent.id);

      if (!isMarkerId(node.id)) ui.insertChild(parent.id, node.id, physIdx);
      schedule();
    },
    removeNode(parent, node) {
      const kids = ensure(parent.id);
      const i = kids.indexOf(node.id);
      if (i < 0) return;

      const nonMarkerBefore = (() => {
        let n = 0;
        for (let j = 0; j < i; j++) if (!isMarkerId(kids[j])) n++;
        return n;
      })();

      // remove from logical
      kids.splice(i, 1);
      PARENTS.set(node.id, null);
      if (!isMarkerId(node.id)) TYPES.delete(node.id);

      if (!isMarkerId(node.id)) ui.removeChild(parent.id, node.id);
      schedule();
    },
    getParentNode(node) {
      const pid = PARENTS.get(node.id);
      if (pid == null) return null;
      return { id: pid, type: typeFor(pid) };
    },
    getFirstChild(node) {
      const kids = ensure(node.id);
      if (!kids.length) return null;
      return nodeFor(kids[0]);
    },
    getNextSibling(node) {
      const pid = PARENTS.get(node.id);
      if (pid == null) return null;
      const kids = ensure(pid);
      const i = kids.indexOf(node.id);
      if (i < 0 || i + 1 >= kids.length) return null;
      return nodeFor(kids[i + 1]);
    },
    getText(node) {
      return TEXTS.get(node.id) ?? "";
    },
    flush() {
      ui.flush();
    },
  };

  return api;
}
