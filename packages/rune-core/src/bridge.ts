import type { RuneNativeEmitterBridge } from "./nativeEmitter";

export type RuneUIBridge = {
  createNode(type: string): number;
  setProp(id: number, name: string, value: any): void;
  setText(id: number, text: string): void;
  insertChild(parent: number, child: number, index: number): void;
  removeChild(parent: number, child: number): void;
  setHandler(id: number, name: string, fn: Function): void;
  flush(): void;
};

export type RuneModulesBridge = {
  call(name: string, method: string, args: any): any;
  callSync?: (name: string, method: string, args: any) => any;
};

declare global {
  var __ui: RuneUIBridge;
  var __modules: RuneModulesBridge;
  var __startApp: (rootId: number) => void;
  var RuneNativeEmitter: RuneNativeEmitterBridge;
}
