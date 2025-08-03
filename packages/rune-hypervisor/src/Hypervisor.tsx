import { createEffect, createSignal, mergeProps, JSX } from "solid-js";
import { HypervisorController, HypervisorControllerApi } from "./hooks";

export interface HypervisorProps {
  source: { uri: string } | { code: string };
  style?: any;
  fallback?: JSX.Element;
  onLoad?: () => void;
  onError?: (error: { message: string }) => void;
  onMessage?: (message: any) => void;
  controller?: HypervisorController; // Add controller prop
}

export function Hypervisor(props: HypervisorProps) {
  const merged = mergeProps({
    onLoad: () => {},
    onError: (e: { message: string }) => console.error("Hypervisor Error:", e.message),
    onMessage: (m: any) => {},
  }, props);

  // Signals to imperatively trigger native methods
  const [reloadTrigger, setReloadTrigger] = createSignal(false);
  const [destroyTrigger, setDestroyTrigger] = createSignal(false);
  const [postMessagePayload, setPostMessagePayload] = createSignal<any>(undefined);

  createEffect(() => {
    if (merged.controller) {
      // Connect controller actions to native view props
      merged.controller.api = {
        reload: () => {
          setReloadTrigger(true);
          // Reset after a short delay to allow native to pick it up
          setTimeout(() => setReloadTrigger(false), 10);
        },
        destroy: () => {
          setDestroyTrigger(true);
          setTimeout(() => setDestroyTrigger(false), 10);
        },
        postMessage: (payload: any) => {
          setPostMessagePayload(payload);
          setTimeout(() => setPostMessagePayload(undefined), 10); // Clear payload after sending
        }
      };
    }
  });

  return (
    // @ts-ignore: Custom native element
    <rune-hypervisor-view
      style={merged.style}
      source={merged.source}
      onLoad={merged.onLoad}
      onError={merged.onError}
      onMessage={merged.onMessage}
      
      // Imperative triggers from controller
      reload={reloadTrigger()}
      destroy={destroyTrigger()}
      postMessage={postMessagePayload()}
    />
  );
}
