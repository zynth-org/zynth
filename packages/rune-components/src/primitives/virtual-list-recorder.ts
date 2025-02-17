type VirtualNodeBase = {
  key?: string;
  style?: Record<string, unknown> | null;
  testID?: string;
};

export type VirtualViewNode = VirtualNodeBase & {
  type: "view";
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: "button" | "header" | "link" | "none";
  children: VirtualNode[];
};

export type VirtualTextNode = VirtualNodeBase & {
  type: "text";
  text: string;
  numberOfLines?: number;
};

export type VirtualNode = VirtualViewNode | VirtualTextNode;

type RecorderBase = {
  normalize: (value: unknown) => VirtualNode | null;
};

export type VirtualListRecorder = RecorderBase & {
  createView: (config: ViewConfig) => VirtualViewNode;
  createText: (config: TextConfig) => VirtualTextNode;
};

let currentRecorder: VirtualListRecorder | null = null;

export function withVirtualListRecorder<T>(
  recorder: VirtualListRecorder,
  fn: () => T
): T {
  const previous = currentRecorder;
  currentRecorder = recorder;
  try {
    return fn();
  } finally {
    currentRecorder = previous;
  }
}

export function getVirtualListRecorder(): VirtualListRecorder | null {
  return currentRecorder;
}

function toStringValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? `${value}` : "";
  // If it's a function (like a Solid reactive accessor), call it to get the actual value
  if (typeof value === "function") {
    try {
      const result = (value as () => unknown)();
      return toStringValue(result); // Recursively convert the result
    } catch {
      return "";
    }
  }
  return `${value}`;
}

function flattenChildren(values: unknown[]): VirtualNode[] {
  const result: VirtualNode[] = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      result.push(...flattenChildren(value));
    } else if (typeof value === "function") {
      // If it's a function (Solid reactive accessor), call it and process the result
      try {
        const unwrapped = (value as () => unknown)();
        result.push(...flattenChildren([unwrapped]));
      } catch {
        // Skip if calling the function fails
      }
    } else if (
      value != null &&
      typeof value === "object" &&
      "type" in (value as any)
    ) {
      result.push(value as VirtualNode);
    } else {
      const text = toStringValue(value);
      if (text.length > 0) {
        result.push({
          type: "text",
          text,
        });
      }
    }
  }
  return result;
}

function coerceStyle(style: unknown): Record<string, unknown> | null {
  if (style == null) return null;
  // If it's a function (like a Solid memo), call it to get the actual style object
  if (typeof style === "function") {
    try {
      const result = (style as () => unknown)();
      return coerceStyle(result); // Recursively convert the result
    } catch {
      return null;
    }
  }
  if (typeof style === "object") return style as Record<string, unknown>;
  return null;
}

type ViewConfig = {
  key?: string | number;
  style?: unknown;
  testID?: string;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: "button" | "header" | "link" | "none";
  children: unknown[];
};

type TextConfig = {
  style?: unknown;
  numberOfLines?: number;
  children: unknown[];
};

export function createVirtualListRecorder(): VirtualListRecorder {
  const recorder: VirtualListRecorder = {
    normalize(value) {
      if (!value) return null;

      // If it's a function (Solid might wrap the return value), unwrap it first
      if (typeof value === "function") {
        try {
          const unwrapped = (value as () => unknown)();
          return this.normalize(unwrapped); // Recursively normalize the unwrapped value
        } catch {
          return null;
        }
      }

      if (Array.isArray(value)) {
        const children = flattenChildren(value);
        if (children.length === 1) return children[0];
        return {
          type: "view",
          children,
        };
      }
      if (typeof value === "object" && "type" in (value as any)) {
        return value as VirtualNode;
      }
      const text = toStringValue(value);
      if (text.length === 0) return null;
      return {
        type: "text",
        text,
      };
    },
    createView(config) {
      const children = flattenChildren(config.children ?? []);
      return {
        type: "view",
        key: config.key != null ? String(config.key) : undefined,
        style: coerceStyle(config.style),
        pointerEvents: config.pointerEvents,
        accessibilityLabel: config.accessibilityLabel,
        accessibilityHint: config.accessibilityHint,
        accessibilityRole: config.accessibilityRole,
        testID: config.testID,
        children,
      };
    },
    createText(config) {
      const children = flattenChildren(config.children ?? []);
      const content = children
        .map((child) => (child.type === "text" ? child.text : ""))
        .join("");
      return {
        type: "text",
        text: content,
        style: coerceStyle(config.style),
        numberOfLines: config.numberOfLines,
      };
    },
  };

  return recorder;
}
