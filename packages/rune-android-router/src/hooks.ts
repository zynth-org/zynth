import type { NavigationHelpers } from "./types";
import { navigateNative, goBackNative, setOptionsNative } from "./nativeBridge";

export function useNavigation(): NavigationHelpers {
  return {
    navigate(name, params) {
      void navigateNative(name, params);
    },
    push(name, params) {
      void navigateNative(name, params);
    },
    goBack() {
      void goBackNative();
    },
    setOptions(options) {
      void setOptionsNative(options);
    },
  };
}
