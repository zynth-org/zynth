import { createSignal, mergeProps, JSX } from "solid-js";
import type { HostNode } from "@zynth/core";

export interface HypervisorRef extends HostNode {
  reload: () => void;
  destroy: () => void;
  postMessage: (payload: unknown) => void;
}

export interface HypervisorProps {
  source: { uri: string } | { code: string };
  style?: any;
  fallback?: JSX.Element;
  onLoad?: () => void;
  onError?: (error: { message: string }) => void;
  onMessage?: (message: unknown) => void;
  ref?: (node: HypervisorRef | null) => void;
}

export function Hypervisor(props: HypervisorProps) {
  const merged = mergeProps({
    onLoad: () => {},
    onError: (e: { message: string }) =>
      console.error("Hypervisor Error:", e.message),
    onMessage: (_m: unknown) => {},
  }, props);

  // Signals to imperatively trigger native methods
  const [reloadTrigger, setReloadTrigger] = createSignal(false);
  const [destroyTrigger, setDestroyTrigger] = createSignal(false);
  const [postMessagePayload, setPostMessagePayload] = createSignal<unknown>(
    undefined,
  );

  const attachRef = (node: HypervisorRef | null) => {
    if (node) {
      node.reload = () => {
        setReloadTrigger(true);
        setTimeout(() => setReloadTrigger(false), 10);
      };
      node.destroy = () => {
        setDestroyTrigger(true);
        setTimeout(() => setDestroyTrigger(false), 10);
      };
      node.postMessage = (payload: unknown) => {
        setPostMessagePayload(payload);
        setTimeout(() => setPostMessagePayload(undefined), 10);
      };
    }
    merged.ref?.(node);
  };

  return (
    // @ts-ignore: Custom native element
    <zynth-hypervisor-view
      ref={attachRef}
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
