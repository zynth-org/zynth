import { JSX, createEffect, untrack, on } from "solid-js";
import { render } from "solid-js/web";

type VirtualWindowProps<T> = {
  items: Array<T>;
  renderItem: (item: T, index: number) => JSX.Element;
  getKey: (item: T) => string;
};

/**
 * TEMPORARY WORKAROUND for SolidJS async reconciliation.
 *
 * The issue: SolidJS batches DOM operations for performance on web,
 * but this causes 200-600ms delays in calling removeChild on the native bridge.
 * During fast scrolling, this creates memory leaks (1000+ leaked nodes).
 *
 * This is a HACK - the proper solution would be to either:
 * 1. Fork SolidJS to add synchronous reconciliation mode
 * 2. Use a different reactive library (Preact, Vue, custom)
 * 3. Write a completely custom list renderer
 *
 * For now, we're stuck with slow cleanup. The best we can do is:
 * - Reduce window size (done: MAX_DYNAMIC_OVERSCAN_ITEMS = 20)
 * - Throttle scroll updates (done: MIN_RANGE_UPDATE_INTERVAL = 100ms)
 * - Accept that node count will grow during fast scrolling
 */
export function VirtualWindow<T>(props: VirtualWindowProps<T>): JSX.Element {
  const mountedMap = new Map<string, { element: JSX.Element; rendered: any }>();

  // Clean up on unmount
  createEffect(() => {
    return () => {
      mountedMap.clear();
    };
  });

  createEffect(
    on(
      () => props.items,
      (targetItems) => {
        const targetKeys = new Set(targetItems.map(props.getKey));

        // Remove old items
        const toRemove: string[] = [];
        for (const key of mountedMap.keys()) {
          if (!targetKeys.has(key)) {
            toRemove.push(key);
          }
        }

        if (toRemove.length > 0) {
          console.log(`[VirtualWindow] Removing ${toRemove.length} items`);
          toRemove.forEach((key) => mountedMap.delete(key));
        }

        // Add new items
        let added = 0;
        for (let i = 0; i < targetItems.length; i++) {
          const item = targetItems[i];
          const key = props.getKey(item);

          if (!mountedMap.has(key)) {
            const element = untrack(() => props.renderItem(item, i));
            mountedMap.set(key, { element, rendered: null });
            added++;
          }
        }

        if (added > 0) {
          console.log(
            `[VirtualWindow] Added ${added} items (total: ${mountedMap.size})`
          );
        }
      },
      { defer: false }
    )
  );

  // Render items in order
  return (
    <>
      {props.items.map((item) => {
        const key = props.getKey(item);
        const entry = mountedMap.get(key);
        return entry?.element;
      })}
    </>
  );
}
