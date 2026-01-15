import type { ZynthNativeEmitterBridge } from "./nativeEmitter";

export type ZynthUIBridge = {
  createNode(type: string): number;
  setProp(id: number, name: string, value: any): void;
  setText(id: number, text: string): void;
  insertChild(parent: number, child: number, index: number): void;
  removeChild(parent: number, child: number): void;
  setHandler(id: number, name: string, fn: Function): void;
  flush(): void;
  applyBatch?(payload: string | Record<string, any>): void;
  setSurface?(surfaceId: number): void;
};

export type ZynthModulesBridge = {
  call(name: string, method: string, args: any): any;
  callSync?: (name: string, method: string, args: any) => any;
};

declare global {
  var __ui: ZynthUIBridge;
  var __modules: ZynthModulesBridge;
  var __startApp: (rootId: number) => void;
  var ZynthNativeEmitter: ZynthNativeEmitterBridge;
}
