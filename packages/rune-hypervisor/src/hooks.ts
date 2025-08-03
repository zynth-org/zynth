import { createSignal, createEffect, onCleanup, useContext } from "solid-js";
import { createContext } from "solid-js";
import { JSX } from "solid-js"; // Import JSX for element types if needed

// --- Host-side API ---

// API for imperative control of the Hypervisor component from the Host
export interface HypervisorControllerApi {
  reload: () => void;
  destroy: () => void;
  postMessage: (payload: any) => void;
}

// Controller object passed to Hypervisor component
export interface HypervisorController {
  api?: HypervisorControllerApi;
}

export function useHypervisorController(): [HypervisorController, HypervisorControllerApi] {
  const controller: HypervisorController = {}; 
  
  const api: HypervisorControllerApi = {
    reload: () => controller.api?.reload(),
    destroy: () => controller.api?.destroy(),
    postMessage: (payload: any) => controller.api?.postMessage(payload),
  };
  return [controller, api];
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
    __RUNE_HYPERVISOR_BRIDGE__?: {
      postMessage: (payload: string) => void;
      // Native to JS events are typically handled by RuneNativeEmitter
    };
    RuneNativeEmitter?: {
      addListener: (eventName: string, callback: (payload: string) => void) => { remove: () => void };
      removeListener: (eventName: string, callback: (payload: string) => void) => void;
    };
  }
}

export function useHost(): HostBridgeApi | null {
  // Check if running inside a hypervisor context
  if (typeof window.__RUNE_HYPERVISOR_BRIDGE__ === 'undefined' && typeof window.RuneNativeEmitter === 'undefined') {
    return null; // Not in a hypervisor
  }

  const postMessageToHost = (payload: any) => {
    window.__RUNE_HYPERVISOR_BRIDGE__?.postMessage(JSON.stringify(payload));
  };

  const onMessageFromHost = (callback: (payload: any) => void) => {
    if (!window.RuneNativeEmitter) {
      console.warn("[RuneHypervisor] RuneNativeEmitter not available for Host messages.");
      return () => {};
    }

    const handler = (payload: string) => {
      try {
        const parsed = JSON.parse(payload);
        callback(parsed);
      } catch (e) {
        console.error("[RuneHypervisor] Failed to parse message from Host:", e, payload);
      }
    };
    
    const subscription = window.RuneNativeEmitter.addListener("RuneHypervisor:Message", handler);
    onCleanup(() => subscription.remove()); // Ensure cleanup on unmount
    return () => subscription.remove();
  };

  return {
    postMessage: postMessageToHost,
    onMessage: onMessageFromHost,
  };
}
