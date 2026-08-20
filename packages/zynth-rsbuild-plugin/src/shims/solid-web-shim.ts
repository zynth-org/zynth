export * from "@solidjs/web";

export function use(fn: any, element: any, arg?: any) {
  return typeof fn === "function" ? fn(element, arg) : undefined;
}
