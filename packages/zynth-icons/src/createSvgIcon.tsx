import { mergeProps, splitProps, createComponent } from "solid-js";
import { View } from "@zynthjs/components";

interface IconProps {
  size?: number | string;
  color?: string;
  title?: string;
  style?: any;
  [key: string]: any;
}

interface IconDefinition {
  a: Record<string, any>;
  c: string;
}

/**
 * Universal SVG Icon renderer.
 * On Web: Renders a native SVG element.
 * On Native: Renders an empty View (icons should use font-based createIcon on native).
 */
export function createSvgIcon(definition: IconDefinition) {
  return (props: IconProps) => {
    // 1. Safety check for Native platforms where 'document' is not available.
    // This prevents "Property 'document' doesn't exist" crashes if web icons
    // are accidentally bundled into native artifacts.
    if (typeof document === "undefined") {
      return createComponent(View, {});
    }

    // 2. Web-only logic below this point
    const merged = mergeProps(
      {
        stroke: "currentColor",
        fill: "currentColor",
        strokeWidth: "0",
      },
      definition.a,
      props
    );

    const [local, others] = splitProps(merged, ["size", "color", "title", "style"]);

    // We use a dynamic component approach to avoid JSX compilation to document.createElement
    // in environments where it might cause issues during static analysis or bundling.
    const svgProps = {
      ...others,
      height: local.size || "1em",
      width: local.size || "1em",
      style: {
        ...(local.style || {}),
        color: local.color || "currentColor",
      },
      xmlns: "http://www.w3.org/2000/svg",
      // We use innerHTML for the pre-sanitized path data
      innerHTML: (local.title ? `<title>${local.title}</title>` : "") + `<g>${definition.c}</g>`,
    };

    // 'svg' is a global intrinsic on web
    return createComponent("svg" as any, svgProps);
  };
}
