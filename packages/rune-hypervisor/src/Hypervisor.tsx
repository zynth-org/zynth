import { createComponent, mergeProps, JSX } from "solid-js";

export interface HypervisorProps {
  source: { uri: string } | { code: string };
  style?: any;
  fallback?: JSX.Element;
  onLoad?: () => void;
  onError?: (error: Error) => void;
  onMessage?: (message: any) => void;
}

export function Hypervisor(props: HypervisorProps) {
  return (
    // This will correspond to the native RuneHypervisorView
    // @ts-ignore
    <rune-hypervisor-view
      style={props.style}
      source={props.source}
    />
  );
}
