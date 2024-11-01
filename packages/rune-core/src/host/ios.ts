import type { Host, HostNode, Style } from "./HostTypes";

export function createIOSHost(): Host {
  const g: any =
    typeof globalThis !== "undefined"
      ? globalThis
      : // eslint-disable-next-line @typescript-eslint/no-implied-eval
        (0, eval)("this");
  const ui = g.__ui;
  if (!ui) throw new Error("__ui not found (native bindings missing)");

  const PARENTS = new Map<number, number | null>();
  const CHILDREN = new Map<number, number[]>();
  const TEXTS = new Map<number, string>();

  // Batch flush operations to avoid excessive layout calculations
  let flushScheduled = false;
  const schedule = () => {
    if (flushScheduled) return;
    flushScheduled = true;

    // Use setTimeout to batch operations if available, otherwise flush immediately
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
      // Fallback for environments without setTimeout
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
          // If Promise is not available either, flush immediately
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

  const nodeFor = (id: number, type: HostNode["type"] = "view"): HostNode => ({
    id,
    type,
  });

  const api: Host = {
    createRootContainer() {
      PARENTS.set(0, null);
      CHILDREN.set(0, []);
      return { id: 0, type: "root" };
    },
    createNode(type, props) {
      const id: number = ui.createNode(type);
      PARENTS.set(id, null);
      CHILDREN.set(id, []);
      if (props?.style) ui.setProp(id, "style", props.style as Style);
      if (props?.onPress) ui.setProp(id, "onPress", props.onPress);
      schedule();
      return { id, type } as HostNode;
    },
    createText(value) {
      const id: number = ui.createNode("text");
      ui.setText(id, value ?? "");
      PARENTS.set(id, null);
      CHILDREN.set(id, []);
      TEXTS.set(id, value ?? "");
      schedule();
      return { id, type: "text" };
    },
    setProperty(node, name, value) {
      if (name === "style") ui.setProp(node.id, "style", value || {});
      else if (name === "onPress") ui.setProp(node.id, "onPress", value);
      else ui.setProp(node.id, name, value);
      schedule();
    },
    setText(node, value) {
      TEXTS.set(node.id, value ?? "");
      ui.setText(node.id, value ?? "");
      schedule();
    },
    insertNode(parent, node, anchor) {
      const kids = ensure(parent.id);
      const idx = anchor ? Math.max(0, kids.indexOf(anchor.id)) : kids.length;
      kids.splice(idx, 0, node.id);
      PARENTS.set(node.id, parent.id);
      ui.insertChild(parent.id, node.id, idx);
      schedule();
    },
    removeNode(parent, node) {
      const kids = ensure(parent.id);
      const i = kids.indexOf(node.id);
      if (i >= 0) kids.splice(i, 1);
      PARENTS.set(node.id, null);
      ui.removeChild(parent.id, node.id);
      schedule();
    },
    getParentNode(node) {
      const pid = PARENTS.get(node.id);
      if (pid == null) return null;
      return nodeFor(pid, pid === 0 ? "root" : "view");
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
