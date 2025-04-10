/**
 * State interface for {{MODULE_NAME_PASCAL}} module
 * 
 * TODO: Define your module's state shape here
 */
export interface {{MODULE_NAME_PASCAL}}State {
  // Example properties - customize for your module
  value: number;
  status: "idle" | "active" | "error";
  timestamp: number;
}

/**
 * Native module interface exposed via globalThis
 * 
 * This interface is installed by the native side and provides
 * the bridge between native code and JavaScript
 */
export interface {{MODULE_NAME_PASCAL}}NativeModule {
  /**
   * Get the initial state synchronously
   */
  getInitialState(): {{MODULE_NAME_PASCAL}}State | null;
  
  /**
   * Subscribe to state changes
   * @returns Unsubscribe function
   */
  addChangeListener(listener: (state: {{MODULE_NAME_PASCAL}}State) => void): () => void;
  
  /**
   * Internal method called by native side to update state
   * @internal
   */
  _updateState(state: {{MODULE_NAME_PASCAL}}State): void;
}

declare global {
  interface Window {
    __{{MODULE_NAME_UPPER}}__?: {{MODULE_NAME_PASCAL}}NativeModule;
  }
  
  var __{{MODULE_NAME_UPPER}}__: {{MODULE_NAME_PASCAL}}NativeModule | undefined;
}
