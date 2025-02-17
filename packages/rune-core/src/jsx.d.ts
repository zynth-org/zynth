import type { Style } from "./host/HostTypes";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      view: { style?: Style; children?: any; onPress?: () => void };
      text: { style?: Style; children?: any };
      button: Record<string, any>;
      pressable: Record<string, any>;
      "scroll-view": Record<string, any>;
      "virtual-list": Record<string, any>;
    }
  }
}

export {};
