import type { Style } from "@rune/core";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      view: { style?: Style; children?: any; onPress?: () => void };
      text: { style?: Style; children?: any };
    }
  }
}

export {};
