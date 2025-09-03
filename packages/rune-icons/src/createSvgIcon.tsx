import { mergeProps, splitProps } from "solid-js";
import type { JSX } from "solid-js";

export type IconDefinition = {
  a: Record<string, string | number | undefined>;
  c: string;
};

export type IconProps = JSX.SvgSVGAttributes<SVGSVGElement> & {
  size?: number | string;
  title?: string;
};

export function createSvgIcon(definition: IconDefinition) {
  return function Icon(props: IconProps) {
    const merged = mergeProps(
      { color: "currentColor", size: "1em" },
      definition.a,
      props
    );
    const [local, svgProps] = splitProps(merged, [
      "title",
      "color",
      "size",
      "style",
    ]);
    const content = local.title
      ? `${definition.c}<title>${local.title}</title>`
      : definition.c;

    const colorValue =
      typeof local.color === "string" ? local.color : String(local.color);
    const sizeValue =
      typeof local.size === "string" ? local.size : String(local.size);

    return (
      <svg
        stroke={(definition.a?.stroke as string | undefined) ?? colorValue}
        color={colorValue}
        fill={colorValue}
        stroke-width="0"
        style={{ overflow: "visible", ...(local.style as any) }}
        innerHTML={content}
        height={sizeValue}
        width={sizeValue}
        xmlns="http://www.w3.org/2000/svg"
        {...(svgProps as any)}
      />
    ) as any;
  };
}
