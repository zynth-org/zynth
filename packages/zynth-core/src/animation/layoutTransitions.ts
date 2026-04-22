import { resolveEasingName, type EasingFunction, type EasingName } from "./easing";

export type LayoutTransitionConfig = {
  type: "linear";
  duration?: number;
  delay?: number;
  easing?: EasingFunction | EasingName;
};

export type ResolvedLayoutTransition = {
  type: "linear";
  duration: number;
  delay: number;
  easing: EasingName;
};

export class LayoutTransitionBuilder {
  private readonly config: LayoutTransitionConfig;

  constructor(config: LayoutTransitionConfig) {
    this.config = config;
  }

  build(): LayoutTransitionConfig {
    return { ...this.config };
  }

  duration(duration: number): LayoutTransitionBuilder {
    return new LayoutTransitionBuilder({ ...this.config, duration });
  }

  delay(delay: number): LayoutTransitionBuilder {
    return new LayoutTransitionBuilder({ ...this.config, delay });
  }

  easing(easing: EasingFunction | EasingName): LayoutTransitionBuilder {
    return new LayoutTransitionBuilder({ ...this.config, easing });
  }
}

export type LayoutTransitionLike = LayoutTransitionConfig | LayoutTransitionBuilder;

/** Pre-built linear layout transition over 300ms with easeOutCubic easing. */
export const LinearTransition = new LayoutTransitionBuilder({
  type: "linear",
  duration: 300,
  delay: 0,
  easing: "easeOutCubic",
});

export const resolveLayoutTransition = (
  input?: LayoutTransitionLike | null
): ResolvedLayoutTransition | null => {
  if (!input) return null;
  const resolved =
    input instanceof LayoutTransitionBuilder ? input.build() : input;
  return {
    type: resolved.type ?? "linear",
    duration: resolved.duration ?? 300,
    delay: resolved.delay ?? 0,
    easing: resolveEasingName(resolved.easing),
  };
};
