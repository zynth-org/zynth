declare module "node:path" {
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
  export function dirname(path: string): string;
  export function isAbsolute(path: string): boolean;
  export function relative(from: string, to: string): string;
  const path: {
    join: typeof join;
    resolve: typeof resolve;
    dirname: typeof dirname;
    isAbsolute: typeof isAbsolute;
    relative: typeof relative;
  };
  export default path;
}

declare module "node:url" {
  export function fileURLToPath(url: string | { href: string }): string;
}

declare module "node:fs" {
  export const promises: {
    readFile(path: string, encoding?: string): Promise<string>;
    writeFile(
      path: string,
      data: string,
      encoding?: string
    ): Promise<void>;
    mkdir(
      path: string,
      options?: { recursive?: boolean }
    ): Promise<void>;
  };
}

declare namespace NodeJS {
  interface ErrnoException extends Error {
    code?: string;
  }
  interface Process {
    env?: Record<string, string | undefined>;
  }
}

declare const process: NodeJS.Process;

interface ImportMeta {
  url: string;
}
