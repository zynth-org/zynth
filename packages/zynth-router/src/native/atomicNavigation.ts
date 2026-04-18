import { platform } from "@zynth/apis";
import { withHostBatch } from "@zynth/core";

const isAndroid = platform.current === "android";

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
