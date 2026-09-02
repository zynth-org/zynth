/// <reference types="@zynthjs/components" />

// Shim for solid-js/jsx-runtime — required by TypeScript's `jsxImportSource` resolution.
// SolidJS 2.0 does not ship a jsx-runtime module. This declaration satisfies TypeScript's
// jsxImportSource contract by exporting the JSX factory functions and JSX namespace.
// IntrinsicElements are contributed via the module augmentation in @zynthjs/components.

declare module "solid-js/jsx-runtime" {
  import type { Element as SolidElement, Component } from "solid-js";

  export function jsx(
    type: Component<any> | string,
    props: Record<string, unknown>,
  ): SolidElement;
  export function jsxs(
    type: Component<any> | string,
    props: Record<string, unknown>,
  ): SolidElement;
  export function jsxDEV(
    type: Component<any> | string,
    props: Record<string, unknown>,
  ): SolidElement;

  export namespace JSX {
    interface IntrinsicElements {}
    type Element = SolidElement;
  }
}

declare module "solid-js/jsx-dev-runtime" {
  export * from "solid-js/jsx-runtime";
}
