import { createEffect, createComponent, merge, omit } from "solid-js";
import { View } from "@zynthjs/components";

interface IconProps {
  size?: number | string;
  color?: string;
  title?: string;
  style?: Record<string, string | number>;
  [key: string]: unknown;
}

interface IconDefinition {
  a: Record<string, string>;
  c: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function toKebabCase(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/** Unwraps accessor props while keeping the read inside the tracking scope. */
function readProp(value: unknown): unknown {
  return typeof value === "function" ? (value as () => unknown)() : value;
}

function serializeStyle(style: Record<string, string | number>): string {
  return Object.entries(style)
    .map(([key, value]) => `${toKebabCase(key)}:${String(value)}`)
    .join(";");
}

/**
 * Universal SVG Icon renderer.
 * On Web: Renders a real <svg> element with reactively applied attributes.
 * On Native: Renders an empty View (icons should use font-based createIcon on native).
 */
export function createSvgIcon(definition: IconDefinition) {
  return (props: IconProps) => {
    // 1. Safety check for Native platforms where 'document' is not available.
    // This prevents crashes if web icons are accidentally bundled into native
    // artifacts.
    if (typeof document === "undefined") {
      return createComponent(View, {});
    }

    // 2. Web-only logic below this point.
    // `merge` preserves getter/reactive access; never destructure it.
    const merged = merge(
      {
        stroke: "currentColor",
        fill: "currentColor",
        strokeWidth: "0",
      },
      definition.a,
      props
    );

    const others = omit(
      merged as Record<string, unknown>,
      "size",
      "color",
      "title",
      "style"
    );

    const el = document.createElementNS(SVG_NS, "svg");
    el.setAttribute("xmlns", SVG_NS);

    // Static, per-icon attributes are applied once at creation.
    for (const [key, value] of Object.entries(others)) {
      if (value === null || value === undefined) continue;
      el.setAttribute(key, String(value));
    }

    // 3. Reactive attributes applied via the mandatory 2-arg createEffect.
    // Reads happen in the compute fn; DOM writes stay untracked in apply.
    createEffect(
      () => ({
        size: (readProp(merged.size) as number | string | undefined) ?? "1em",
        color: (readProp(merged.color) as string | undefined) ?? "currentColor",
        title: readProp(merged.title),
        style: merged.style,
      }),
      ({ size, color, title, style }) => {
        el.setAttribute("width", String(size));
        el.setAttribute("height", String(size));

        const resolvedStyle: Record<string, string | number> = {
          ...(style && typeof style === "object" ? style : {}),
          color: String(color),
        };
        el.setAttribute("style", serializeStyle(resolvedStyle));

        // Pre-sanitized path data injected as innerHTML.
        el.innerHTML =
          (title ? `<title>${String(title)}</title>` : "") +
          `<g>${definition.c}</g>`;
      }
    );

    return el;
  };
}
