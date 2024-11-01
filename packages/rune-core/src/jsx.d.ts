import type { Style } from "./host/HostTypes";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      view: { style?: Style; children?: any; onPress?: () => void };
      text: { style?: Style; children?: any };
    }
  }
}

export {};

