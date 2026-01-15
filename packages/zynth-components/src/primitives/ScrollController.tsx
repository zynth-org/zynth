/**
 * ScrollController - Apple-style scroll interruption
 *
 * Detects when content isn't ready and imperatively stops scroll
 * to prevent blank screens, just like iOS Mail and Contacts apps.
 */

export interface ScrollStopController {
  /**
   * Check if scroll should be stopped due to content not being ready
   */
  shouldStopScroll(
    targetOffset: number,
    contentReady: boolean,
    isScrolling: boolean
  ): boolean;

  /**
   * Imperatively stop the scroll at current position
   */
  stopScroll(): void;

  /**
   * Allow scroll to resume
   */
  resumeScroll(): void;

  /**
   * Check if scroll is currently blocked
   */
  isBlocked(): boolean;

  /**
   * Reset the controller state
   */
  reset(): void;
}

export class AppleStyleScrollController implements ScrollStopController {
  private blocked = false;
  private blockStartTime = 0;
  private maxBlockDuration = 500; // Maximum time to block scroll (ms)
  private scrollControllerRef: any = null;

  constructor(scrollController?: any) {
    this.scrollControllerRef = scrollController;
  }

  setScrollController(controller: any) {
    this.scrollControllerRef = controller;
  }

  shouldStopScroll(
    targetOffset: number,
    contentReady: boolean,
    isScrolling: boolean
  ): boolean {
    // Don't block if content is ready
    if (contentReady) {
      if (this.blocked) {
        console.log(
          "[ScrollController] Content ready, resuming scroll after block"
        );
        this.resumeScroll();
      }
      return false;
    }

    // Don't block if not actively scrolling
    if (!isScrolling) {
      return false;
    }

    // Check if we've been blocking too long
    if (this.blocked) {
      const blockDuration = Date.now() - this.blockStartTime;
      if (blockDuration > this.maxBlockDuration) {
        console.warn(
          `[ScrollController] Block timeout (${blockDuration}ms), forcing resume`
        );
        this.resumeScroll();
        return false;
      }
    }

    // Content not ready during scroll - block it!
    if (!this.blocked) {
      console.log(
        "[ScrollController] Content not ready, blocking scroll (Apple-style)"
      );
      this.stopScroll();
    }

    return true;
  }

  stopScroll(): void {
    if (this.blocked) return;

    this.blocked = true;
    this.blockStartTime = Date.now();

    // TODO: Call native scroll controller to stop scroll
    // This would require exposing a method on the scroll controller
    // For now, we log it - the integration with FlatList will handle it
    console.log("[ScrollController] Scroll STOPPED imperatively");
  }

  resumeScroll(): void {
    if (!this.blocked) return;

    const blockDuration = Date.now() - this.blockStartTime;
    this.blocked = false;
    this.blockStartTime = 0;

    console.log(
      `[ScrollController] Scroll RESUMED after ${blockDuration}ms block`
    );
  }

  isBlocked(): boolean {
    return this.blocked;
  }

  reset(): void {
    this.blocked = false;
    this.blockStartTime = 0;
  }
}

/**
 * Gap Recovery Manager - Detects and recovers from blank screen states
 */
export class GapRecoveryManager {
  private lastRecoveryTime = 0;
  private recoveryThrottleMs = 1000; // Don't recover more than once per second
  private consecutiveGaps = 0;
  private maxConsecutiveGaps = 3;

  /**
   * Detect if we're in a gap state
   */
  detectGap(
    itemsInRange: number,
    contentReady: boolean,
    isScrolling: boolean
  ): boolean {
    // Gap detected if:
    // 1. We should have items (range not empty)
    // 2. Content is not ready
    // 3. Not currently scrolling (scroll has settled)
    const isGap = itemsInRange > 0 && !contentReady && !isScrolling;

    if (isGap) {
      this.consecutiveGaps++;
      // console.warn(
      //   `[GapRecovery] Gap detected (consecutive: ${this.consecutiveGaps}/${this.maxConsecutiveGaps})`
      // );
    } else {
      this.consecutiveGaps = 0;
    }

    return isGap;
  }

  /**
   * Attempt recovery from gap state
   */
  attemptRecovery(forceRecoveryFn: () => void): boolean {
    const now = Date.now();
    const timeSinceLastRecovery = now - this.lastRecoveryTime;

    // Throttle recovery attempts
    if (timeSinceLastRecovery < this.recoveryThrottleMs) {
      // console.log(
      //   `[GapRecovery] Throttling recovery (${timeSinceLastRecovery}ms since last)`
      // );
      return false;
    }

    // Only recover if we've had consecutive gaps
    if (this.consecutiveGaps < 2) {
      return false;
    }

    // console.log(
    //   `[GapRecovery] Attempting recovery (${this.consecutiveGaps} consecutive gaps)`
    // );

    this.lastRecoveryTime = now;
    this.consecutiveGaps = 0;

    // Call the recovery function
    forceRecoveryFn();

    return true;
  }

  /**
   * Reset the manager state
   */
  reset(): void {
    this.consecutiveGaps = 0;
    this.lastRecoveryTime = 0;
  }
}
