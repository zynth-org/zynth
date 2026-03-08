export interface RouterFileSystemFeatureOptions {
  enable?: boolean;
  screensDir?: string;
  outputPath?: string;
  moduleId?: string;
}

export interface ResolvedRouterFileSystemOptions {
  screensDir: string;
  outputPath: string;
  moduleId: string;
}

export interface GeneratedModuleFeatureContext {
  appRoot: string;
  workspaceRoot: string;
  platform: "ios" | "android" | "web";
}

export interface GeneratedModuleFeature {
  kind: "generated-module";
  moduleId: string;
  outputPath?: string;
  generate(
    context: GeneratedModuleFeatureContext,
  ): string | Promise<string>;
}

export declare function resolveFileSystemRouterOptions(
  options: RouterFileSystemFeatureOptions | undefined,
  appRoot: string,
): ResolvedRouterFileSystemOptions | null;

export declare function routerFileSystemGeneratedModule(
  options?: RouterFileSystemFeatureOptions,
): GeneratedModuleFeature;
