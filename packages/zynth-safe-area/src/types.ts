/**
 * Safe area insets in device-independent pixels
 */
export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Safe frame rectangle in window coordinates
 */
export interface SafeAreaFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Complete window metrics including insets and safe frame
 */
export interface WindowMetrics {
  insets: SafeAreaInsets;
  frame: SafeAreaFrame;
}

/**
 * Initial metrics that can be provided to avoid first-paint jumps
 */
export type InitialWindowMetrics = WindowMetrics | null;
