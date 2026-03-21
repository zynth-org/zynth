import { Platform, OS } from "@zynth/apis";
import { withHostBatch } from "@zynth/core";

const isAndroid = Platform.OS === OS.ANDROID;

export function runAtomicNavigationTransition(
  enabled: boolean,
  callback: () => void,
): void {
  if (!enabled || !isAndroid) {
    callback();
    return;
  }
  withHostBatch(
    {
      kind: "navigation",
      scope: "app",
      extras: { atomic: true },
    },
    callback,
  );
}
