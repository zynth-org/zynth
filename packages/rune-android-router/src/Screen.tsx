import type {
  RouterScreenComponentProps,
  ScreenComponent,
  ScreenOptions,
} from "./types";

export interface ScreenProps<Params = any> {
  name: string;
  component: ScreenComponent<Params>;
  options?: ScreenOptions;
}

export function Screen(_props: ScreenProps) {
  return null;
}

export type { ScreenOptions, ScreenComponent, RouterScreenComponentProps };
