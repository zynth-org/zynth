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

export type ZynthSharedSignalsBridge = {
  createSharedSignal?: (initialValue: number) => number;
  getSharedSignal?: (id: number) => number;
  setSharedSignal?: (id: number, value: number) => void;
  removeSharedSignal?: (id: number) => void;
  createSharedValue?: (initialValue: number) => number;
  getSharedValue?: (id: number) => number;
  setSharedValue?: (id: number, value: number) => void;
  cancelSharedValue?: (id: number) => void;
};

export type ZynthWorkletsBridge = {
  register: (payload: {
    code: string;
    location?: string;
    closure?: Record<string, unknown>;
  }) => number;
  run?: (id: number) => void;
  runAfter?: (id: number, delayMs: number) => void;
};

declare global {
  var __ui: ZynthUIBridge;
  var __modules: ZynthModulesBridge;
  var __startApp: (rootId: number) => void;
  var ZynthNativeEmitter: ZynthNativeEmitterBridge;
  var __zynth_shared_signals: ZynthSharedSignalsBridge;
  var __zynth_worklets: ZynthWorkletsBridge;
}
