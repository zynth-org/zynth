export interface ZynthRsbuildPluginOptions {
  /** Override where the dev artifact is written. Defaults to `<app>/.zynth/artifacts.json`. */
  artifactPath?: string;
  /** Explicitly provide the monorepo root path. Will be auto-detected when omitted. */
  workspaceRoot?: string;
  /** Disable Hermes/HMR shimming logic. */
  hermesCompat?: boolean;
  /** Inject extra resolve aliases. */
  extraAliases?: Record<string, string | false | (string | false)[]>;
  /** Skip writing the HMR artifact JSON. */
  writeArtifacts?: boolean;
  /** Extensible build features that can generate virtual modules/artifacts. */
  features?: ZynthBuildFeature[];
}

export interface ZynthBuildFeatureContext {
  appRoot: string;
  workspaceRoot: string;
  platform: "ios" | "android" | "web";
}

export interface ZynthGeneratedModuleFeature {
  kind: "generated-module";
  /** Exact import id exposed to application source code. */
  moduleId: string;
  /** Output file path for generated module. Relative to app root if not absolute. */
  outputPath?: string;
  /** Module source code generator. */
  generate: (
    context: ZynthBuildFeatureContext
  ) => string | Promise<string>;
}

/** Opaque feature descriptors owned by framework packages. */
export interface ZynthOpaqueFeature {
  kind: string;
  [key: string]: unknown;
}

export type ZynthBuildFeature =
  | ZynthGeneratedModuleFeature
  | ZynthOpaqueFeature;

export interface DefineZynthConfigOptions {
  plugin?: ZynthRsbuildPluginOptions;
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
