export interface MemoryRouterFileSystemFeatureOptions {
  enable?: boolean;
  screensDir?: string;
  outputPath?: string;
  moduleId?: string;
}

export interface ResolvedMemoryRouterFileSystemOptions {
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
  options: MemoryRouterFileSystemFeatureOptions | undefined,
  appRoot: string,
): ResolvedMemoryRouterFileSystemOptions | null;

export declare function memoryRouterFileSystemGeneratedModule(
  options?: MemoryRouterFileSystemFeatureOptions,
): GeneratedModuleFeature;
