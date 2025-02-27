import {
  JSX,
  createRoot,
  getOwner,
  runWithOwner,
  createEffect,
  onCleanup,
} from "solid-js";

/**
 * ImperativeListManager - DEPRECATED
 *
 * This class was an attempt to bypass SolidJS reconciliation but had issues
 * with items not rendering due to reactivity isolation.
 *
 * The CORRECT solution is implemented directly in FlatList.tsx using:
 * - Element cache Map with stable JSX references
 * - createRoot per item for proper cleanup
 * - Immediate disposal in createEffect
 *
 * This class is kept for reference but is NOT used.
 * See FlatList.tsx getCachedElement() for the working implementation.
 */

export interface ManagedItem<T> {
  key: string;
  data: T;
  index: number;
}

interface CacheEntry {
  dispose: () => void; // SolidJS cleanup
  element: JSX.Element; // The actual JSX element
  key: string; // For debugging
  mounted: boolean; // Whether currently in DOM
}

export class ImperativeListManager<T> {
  private cache = new Map<string, CacheEntry>();
  private owner: any = null;
  private currentItems: ManagedItem<T>[] = [];
  private containerElement: any = null;
  private isReady = false;

  // Statistics
  private stats = {
    created: 0,
    removed: 0,
    reused: 0,
  };

  constructor() {
    this.owner = getOwner();
  }

  /**
   * Set the container element for mounting items
   */
  setContainer(container: any) {
    this.containerElement = container;
    console.log("[ImperativeListManager] Container set", { container });
  }

  /**
   * Check if the manager is ready to render
   */
  isContentReady(): boolean {
    return this.isReady && this.currentItems.length > 0;
  }

  /**
   * Get current cache size (for debugging)
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      cached: this.cache.size,
      mounted: Array.from(this.cache.values()).filter((e) => e.mounted).length,
    };
  }

  /**
   * Update the list with new items - this is where the magic happens!
   * This method is called by FlatList when the visible range changes.
   */
  update(
    items: ManagedItem<T>[],
    renderItem: (item: T, index: number) => JSX.Element
  ): void {
    const startTime = Date.now();
    const currentKeys = new Set(items.map((i) => i.key));
    const previousKeys = new Set(this.currentItems.map((i) => i.key));

    // Calculate changes
    const toRemove: string[] = [];
    const toAdd: ManagedItem<T>[] = [];

    // Find items to remove
    for (const prevItem of this.currentItems) {
      if (!currentKeys.has(prevItem.key)) {
        toRemove.push(prevItem.key);
      }
    }

    // Find items to add
    for (const item of items) {
      if (!previousKeys.has(item.key)) {
        toAdd.push(item);
      }
    }

    // PHASE 1: IMMEDIATE REMOVAL (no SolidJS delay!)
    if (toRemove.length > 0) {
      console.log(`[ImperativeListManager] Removing ${toRemove.length} items`);
      toRemove.forEach((key) => {
        const entry = this.cache.get(key);
        if (entry && entry.mounted) {
          // Call dispose to cleanup SolidJS reactivity
          entry.dispose();
          this.cache.delete(key);
          this.stats.removed++;
        }
      });
    }

    // PHASE 2: IMMEDIATE ADDITION
    if (toAdd.length > 0) {
      console.log(`[ImperativeListManager] Adding ${toAdd.length} items`);
      toAdd.forEach((item) => {
        if (!this.cache.has(item.key)) {
          // Create a reactive root for this item - this makes it actually render!
          let dispose: () => void;
          let element: any;

          createRoot((d) => {
            dispose = d;
            // Preserve parent owner context while creating isolated root
            element = runWithOwner(this.owner, () =>
              renderItem(item.data, item.index)
            );
          });

          this.cache.set(item.key, {
            dispose: () => {
              dispose();
              console.log(`[ImperativeListManager] Disposed item ${item.key}`);
            },
            element,
            key: item.key,
            mounted: true,
          });

          this.stats.created++;
        } else {
          // Item already exists in cache, reuse it
          const entry = this.cache.get(item.key)!;
          entry.mounted = true;
          this.stats.reused++;
        }
      });
    }

    // Store current items for next update
    this.currentItems = items;
    this.isReady = true;

    const elapsed = Date.now() - startTime;
    if (toRemove.length > 0 || toAdd.length > 0) {
      console.log(
        `[ImperativeListManager] Update complete in ${elapsed.toFixed(1)}ms`,
        {
          added: toAdd.length,
          removed: toRemove.length,
          total: items.length,
          cached: this.cache.size,
          stats: this.getStats(),
        }
      );
    }
  }

  /**
   * Force a recovery from blank screen state
   * This re-mounts all current items
   */
  forceRecovery(): void {
    console.log("[ImperativeListManager] Force recovery triggered");

    // Clear mounted flags
    this.cache.forEach((entry) => {
      entry.mounted = false;
    });

    // Mark as not ready to trigger re-render
    this.isReady = false;

    // Will be ready again on next update
    setTimeout(() => {
      this.isReady = true;
    }, 0);
  }

  /**
   * Get the current items as JSX elements for rendering
   * Returns a reactive signal that FlatList can use
   */
  getElements(): JSX.Element[] {
    // Map items and get their elements - this ensures they're in the right order
    const elements = this.currentItems
      .map((item) => {
        const entry = this.cache.get(item.key);
        if (!entry) {
          console.warn(
            `[ImperativeListManager] Missing cache entry for ${item.key}`
          );
          return null;
        }
        return entry.element;
      })
      .filter(Boolean);

    console.log(
      `[ImperativeListManager] getElements returning ${elements.length} elements`
    );
    return elements;
  }

  /**
   * Cleanup all items
   */
  dispose(): void {
    console.log("[ImperativeListManager] Disposing all items");
    this.cache.forEach((entry) => {
      entry.dispose();
    });
    this.cache.clear();
    this.currentItems = [];
    this.isReady = false;
  }

  /**
   * Get debug information
   */
  getDebugInfo() {
    return {
      containerSet: !!this.containerElement,
      ready: this.isReady,
      currentItemsCount: this.currentItems.length,
      cacheSize: this.cache.size,
      mountedCount: Array.from(this.cache.values()).filter((e) => e.mounted)
        .length,
      stats: this.stats,
    };
  }
}

/**
 * Component wrapper for ImperativeListManager
 */
export interface ImperativeListProps<T> {
  items: ManagedItem<T>[];
  renderItem: (item: T, index: number) => JSX.Element;
  manager: ImperativeListManager<T>;
  onContentReady?: (ready: boolean) => void;
}

export function ImperativeList<T>(props: ImperativeListProps<T>) {
  let containerRef: any;

  // Set container reference when mounted
  const setRef = (el: any) => {
    containerRef = el;
    if (el) {
      props.manager.setContainer(el);
    }
  };

  // Update items when props change
  createEffect(() => {
    const items = props.items;
    const renderItem = props.renderItem;

    props.manager.update(items, renderItem);

    // Notify parent about content readiness
    if (props.onContentReady) {
      props.onContentReady(props.manager.isContentReady());
    }
  });

  // Cleanup on unmount
  onCleanup(() => {
    props.manager.dispose();
  });

  // Return the container with elements
  return <>{props.manager.getElements()}</>;
}
