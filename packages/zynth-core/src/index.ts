export * from "./index.base";
export { start } from "./start";

// Stub for Web-only API to satisfy shared types
export function registerComponent(type: string, Component: (props: any) => any) {
  // No-op on native
}