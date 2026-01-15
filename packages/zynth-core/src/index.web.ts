console.log("[Zynth Web] @zynth/core index.web.ts loaded");
export * from "./index.base";
export {
  createWebHost,
  registerWebComponent,
  normalizeStyle,
  registerComponent,
} from "./host/web";
export { start } from "./start.web";
