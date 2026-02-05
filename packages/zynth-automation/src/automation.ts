import { configureNative, readNative, readSyncNative } from "./native";
import type { AutomationConfig, AutomationReadOptions, AutomationSnapshot } from "./types";

export const Automation = {
  read(options?: AutomationReadOptions): Promise<AutomationSnapshot> {
    return readNative(options);
  },
  readSync(options?: AutomationReadOptions): AutomationSnapshot {
    return readSyncNative(options);
  },
  configure(config: AutomationConfig): { productionInspectionEnabled: boolean } {
    return configureNative(config);
  },
};
