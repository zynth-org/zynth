export type KeychainAccessibilityConstant = number;

export type SecureStoreOptions = {
  accessGroup?: string;
  authenticationPrompt?: string;
  keychainAccessible?: KeychainAccessibilityConstant;
  keychainService?: string;
  requireAuthentication?: boolean;
};

export type SecureStoreMethods = {
  getItemAsync(key: string, options?: SecureStoreOptions): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: SecureStoreOptions): Promise<void>;
  deleteItemAsync(key: string, options?: SecureStoreOptions): Promise<void>;
  getItem(key: string, options?: SecureStoreOptions): string | null;
  setItem(key: string, value: string, options?: SecureStoreOptions): void;
  deleteItem(key: string, options?: SecureStoreOptions): void;
  isAvailableAsync(): Promise<boolean>;
  canUseBiometricAuthentication(): Promise<boolean>;
};
