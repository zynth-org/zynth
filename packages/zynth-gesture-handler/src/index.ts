/**
 * @deprecated
 *
 * `@zynth/gesture-handler` has been consolidated into `@zynth/core` and `@zynth/components`.
 * This package now re-exports from those locations for backward compatibility
 * and **will be removed in a future release**.
 *
 * ## Migration guide
 *
 * ### Gesture builders
 * ```diff
 * - import { createPanGesture, createTapGesture } from "@zynth/gesture-handler";
 * + import { createPanGesture, createTapGesture } from "@zynth/core/gesture";
 * ```
 *
 * ### GestureDetector
 * ```diff
 * - import { GestureDetector } from "@zynth/gesture-handler";
 * + import { GestureDetector } from "@zynth/components";
 * ```
 *
 * @see https://zynth.dev/docs/migration/motion-gesture
 */

// Re-export all gesture builders and types from the canonical core entry point.
export * from "@zynth/core/gesture";

/**
 * @deprecated Import `GestureDetector` from `@zynth/components` instead.
 */
export { GestureDetector } from "@zynth/components";
