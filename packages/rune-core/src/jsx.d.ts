import type { Style } from "./host/HostTypes";

type ViewLayoutEvent = {
  nativeEvent?: {
    layout?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      view: {
        style?: Style;
        children?: any;
        onPress?: () => void;
        onLayout?: (event: ViewLayoutEvent) => void;
      };
      text: { style?: Style; children?: any };
      button: Record<string, any>;
      pressable: Record<string, any>;
      "scroll-view": Record<string, any>;
    }
  }
}

export {};
