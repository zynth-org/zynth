import { useContext, type Accessor } from "solid-js";
import { UiContext } from "./UiProvider";
import type { UiState } from "./types";

/**
 * Hook to access Ui state
 * 
 * Returns an Accessor that must be called to get the current state.
 * This preserves SolidJS reactivity.
 * 
 * @example
 * ```tsx
 * const state = useUiState();
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
export function useUiState(): Accessor<UiState> {
  return useContext(UiContext);
}
