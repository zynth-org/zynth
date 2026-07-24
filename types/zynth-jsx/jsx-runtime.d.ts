// Shim for solid-js/jsx-runtime — required by TypeScript's `jsxImportSource` resolution.
// SolidJS 2.0 does not ship a real jsx-runtime module. This shim satisfies the
// TypeScript jsxImportSource contract by exporting a JSX factory function and
// the JSX namespace. IntrinsicElements are contributed via the module augmentation
// in zynth-components/src/jsx.d.ts (loaded via zynth-jsx global types).

import type { Element as SolidElement, Component } from "solid-js";

export function jsx(type: Component<any> | string, props: Record<string, unknown>): SolidElement;
export function jsxs(type: Component<any> | string, props: Record<string, unknown>): SolidElement;
export function jsxDEV(type: Component<any> | string, props: Record<string, unknown>): SolidElement;

export namespace JSX {
  // Populated by declare module "solid-js/jsx-runtime" augmentation in jsx.d.ts.
  interface IntrinsicElements {}
  type Element = SolidElement;
}
