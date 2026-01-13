export interface RuneRsbuildPluginOptions {
  /** Override where the dev artifact is written. Defaults to `<app>/.rune/artifacts.json`. */
  artifactPath?: string;
  /** Explicitly provide the monorepo root path. Will be auto-detected when omitted. */
  workspaceRoot?: string;
  /** Disable Hermes/HMR shimming logic. */
  hermesCompat?: boolean;
  /** Inject extra resolve aliases. */
  extraAliases?: Record<string, string | false | (string | false)[]>;
  /** Skip writing the HMR artifact JSON. */
  writeArtifacts?: boolean;
}

export interface DefineRuneConfigOptions {
  plugin?: RuneRsbuildPluginOptions;
  platform?: "ios" | "android" | "web";
  babel?: {
    enable?: boolean;
    targets?: {
      android?: string;
      ios?: string;
      [platform: string]: string | undefined;
    };
  };
}