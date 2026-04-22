type AnimationStep = (time: number) => boolean;

type RafHandle = number | ReturnType<typeof setTimeout>;

type GlobalWithRaf = typeof globalThis & {
  requestAnimationFrame?: (cb: (time: number) => void) => RafHandle;
  cancelAnimationFrame?: (handle: RafHandle) => void;
  performance?: { now?: () => number };
};

const globalObj: GlobalWithRaf =
  typeof globalThis !== "undefined" ? (globalThis as GlobalWithRaf) : ({} as GlobalWithRaf);

const requestFrame =
  typeof globalObj.requestAnimationFrame === "function"
    ? globalObj.requestAnimationFrame.bind(globalObj)
    : (cb: (time: number) => void) => setTimeout(() => cb(now()), 16);

const cancelFrame =
  typeof globalObj.cancelAnimationFrame === "function"
    ? globalObj.cancelAnimationFrame.bind(globalObj)
    : (handle: RafHandle) => clearTimeout(handle as ReturnType<typeof setTimeout>);

const activeSteps = new Set<AnimationStep>();
let rafId: RafHandle | null = null;

/** Returns the current high-resolution timestamp in milliseconds. */
export function now(): number {
  if (globalObj.performance && typeof globalObj.performance.now === "function") {
    return globalObj.performance.now();
  }
  return Date.now();
}

function tick(_time: number): void {
  rafId = null;
  const current = now();
  for (const step of Array.from(activeSteps)) {
    const done = step(current);
    if (done) {
      activeSteps.delete(step);
    }
  }
  if (activeSteps.size > 0) {
    rafId = requestFrame(tick);
  }
}

/**
 * Schedules an animation step to run each frame.
 * The step receives the current timestamp and returns `true` when done.
 * @returns A cancellation function.
 */
export function startAnimation(step: AnimationStep): () => void {
  activeSteps.add(step);
  if (rafId === null) {
    rafId = requestFrame(tick);
  }
  return () => {
    if (activeSteps.delete(step) && activeSteps.size === 0 && rafId !== null) {
      cancelFrame(rafId);
      rafId = null;
    }
  };
}
