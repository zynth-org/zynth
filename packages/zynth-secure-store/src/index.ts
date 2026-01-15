import type { KeychainAccessibilityConstant } from "./types";
import { SecureStore } from "./SecureStore";

export const WHEN_UNLOCKED: KeychainAccessibilityConstant = 0;
export const AFTER_FIRST_UNLOCK: KeychainAccessibilityConstant = 1;
export const ALWAYS: KeychainAccessibilityConstant = 2;
export const WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: KeychainAccessibilityConstant = 3;
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY: KeychainAccessibilityConstant = 4;
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: KeychainAccessibilityConstant = 5;
export const ALWAYS_THIS_DEVICE_ONLY: KeychainAccessibilityConstant = 6;

export { SecureStore };
export type { SecureStoreOptions, SecureStoreMethods, KeychainAccessibilityConstant } from "./types";
export default SecureStore;
