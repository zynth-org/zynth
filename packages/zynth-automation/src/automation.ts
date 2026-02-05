import { readNative, readSyncNative } from "./native";
import type { AutomationReadOptions, AutomationSnapshot } from "./types";

export const Automation = {
  read(options?: AutomationReadOptions): Promise<AutomationSnapshot> {
    return readNative(options);
  },
  readSync(options?: AutomationReadOptions): AutomationSnapshot {
    return readSyncNative(options);
  },
};
