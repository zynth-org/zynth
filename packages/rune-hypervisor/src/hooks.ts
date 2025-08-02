import { createSignal } from "solid-js";

export function useHost() {
  // TODO: Implement host bridge hook
  return null;
}

export function useHypervisorController() {
    return {
        reload: () => console.log("Reload requested"),
        send: (msg: any) => console.log("Sending message to guest", msg)
    }
}
