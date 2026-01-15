import { useContext, type Accessor } from "solid-js";
import { {{MODULE_NAME_PASCAL}}Context } from "./{{MODULE_NAME_PASCAL}}Provider";
import type { {{MODULE_NAME_PASCAL}}State } from "./types";

/**
 * Hook to access {{MODULE_NAME_PASCAL}} state
 * 
 * Returns an Accessor that must be called to get the current state.
 * This preserves SolidJS reactivity.
 * 
 * @example
 * ```tsx
 * const state = use{{MODULE_NAME_PASCAL}}State();
 * 
 * // Access properties by calling the accessor
 * console.log(state().value);
 * console.log(state().status);
 * 
 * // Use in JSX
 * <Text>{state().value}</Text>
 * 
 * // Use in createMemo for derived values
 * const displayText = createMemo(() => {
 *   return `Status: ${state().status}`;
 * });
 * ```
 */
export function use{{MODULE_NAME_PASCAL}}State(): Accessor<{{MODULE_NAME_PASCAL}}State> {
  return useContext({{MODULE_NAME_PASCAL}}Context);
}
