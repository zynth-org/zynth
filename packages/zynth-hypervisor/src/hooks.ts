import { createSignal, createEffect, onCleanup, useContext } from "solid-js";
import { createContext } from "solid-js";


// --- Host-side API ---

// API for imperative control of the Hypervisor component from the Host
export interface HypervisorBridgeRef {
  reload: () => void;
  destroy: () => void;
  postMessage: (payload: any) => void;
}

// Ref handle object that can be wired to a Hypervisor ref
export interface HypervisorRefHandle {
  api?: HypervisorBridgeRef;
}

export function useHypervisorRefHandle(): [
  HypervisorRefHandle,
  HypervisorBridgeRef,
] {
  const handle: HypervisorRefHandle = {}; 
  
  const api: HypervisorBridgeRef = {
    reload: () => handle.api?.reload(),
    destroy: () => handle.api?.destroy(),
    postMessage: (payload: any) => handle.api?.postMessage(payload),
  };
  return [handle, api];
}


// --- Guest-side API ---

// Context for the host bridge, allowing communication from guest to host
export interface HostBridgeApi {
  postMessage: (payload: any) => void;
  onMessage: (callback: (payload: any) => void) => () => void; // Returns unsubscribe
}

// Internal module exposed by the native side for guest access
declare global {
  interface Window {
    __ZYNTH_HYPERVISOR_BRIDGE__?: {
      postMessage: (payload: string) => void;
      // Native to JS events are typically handled by ZynthNativeEmitter
    };
    ZynthNativeEmitter?: {
      addListener: (eventName: string, callback: (payload: string) => void) => { remove: () => void };
      removeListener: (eventName: string, callback: (payload: string) => void) => void;
    };
  }
}

export function useHost(): HostBridgeApi | null {
  // Check if running inside a hypervisor context
  if (typeof window.__ZYNTH_HYPERVISOR_BRIDGE__ === 'undefined' && typeof window.ZynthNativeEmitter === 'undefined') {
    return null; // Not in a hypervisor
  }

  const postMessageToHost = (payload: any) => {
    window.__ZYNTH_HYPERVISOR_BRIDGE__?.postMessage(JSON.stringify(payload));
  };

  const onMessageFromHost = (callback: (payload: any) => void) => {
    if (!window.ZynthNativeEmitter) {
      console.warn("[ZynthHypervisor] ZynthNativeEmitter not available for Host messages.");
      return () => {};
    }

    const handler = (payload: string) => {
      try {
        const parsed = JSON.parse(payload);
        callback(parsed);
      } catch (e) {
        console.error("[ZynthHypervisor] Failed to parse message from Host:", e, payload);
      }
    };
    
    const subscription = window.ZynthNativeEmitter.addListener("ZynthHypervisor:Message", handler);
    onCleanup(() => subscription.remove()); // Ensure cleanup on unmount
    return () => subscription.remove();
  };

  return {
    postMessage: postMessageToHost,
    onMessage: onMessageFromHost,
  };
}
