import { callNativeSync, warnMissingNativeOnce } from "./native";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  joinPaths,
  parsePath,
  relative,
  normalizePathInput,
} from "./pathUtils";
import type { PathInfo, PathLike } from "./types";
import { Directory } from "./Directory";

type PathsSnapshot = {
  document: string;
  cache: string;
  bundle: string;
};

type DiskSpaceSnapshot = {
  total: number;
  available: number;
};

let cachedPaths: PathsSnapshot | null = null;
let cachedDiskSpace: DiskSpaceSnapshot | null = null;

function loadPaths(): PathsSnapshot {
  if (!cachedPaths) {
    try {
      cachedPaths = callNativeSync<PathsSnapshot>("getPaths", {});
    } catch (error) {
      warnMissingNativeOnce("getPaths", error);
      cachedPaths = {
        document: "file:///",
        cache: "file:///",
        bundle: "asset://",
      };
    }
  }
  return cachedPaths;
}

function loadDiskSpace(): DiskSpaceSnapshot {
  if (!cachedDiskSpace) {
    try {
      cachedDiskSpace = callNativeSync<DiskSpaceSnapshot>("getDiskSpace", {});
    } catch (error) {
      warnMissingNativeOnce("getDiskSpace", error);
      cachedDiskSpace = { total: 0, available: 0 };
    }
  }
  return cachedDiskSpace;
}

export class Paths {
  static get document(): Directory {
    return new Directory(loadPaths().document);
  }

  static get cache(): Directory {
    return new Directory(loadPaths().cache);
  }

  static get bundle(): Directory {
    return new Directory(loadPaths().bundle);
  }

  static get appleSharedContainers(): Record<string, Directory> {
    try {
      const containers = callNativeSync<Record<string, string>>("getSharedContainers", {});
      return Object.fromEntries(
        Object.entries(containers).map(([key, uri]) => [key, new Directory(uri)])
      );
    } catch {
      return {};
    }
  }

  static get availableDiskSpace(): number {
    return loadDiskSpace().available;
  }

  static get totalDiskSpace(): number {
    return loadDiskSpace().total;
  }

  static basename(path: PathLike, ext?: string): string {
    return basename(path, ext);
  }

  static dirname(path: PathLike): string {
    return dirname(path);
  }

  static extname(path: PathLike): string {
    return extname(path);
  }

  static isAbsolute(path: PathLike): boolean {
    return isAbsolute(path);
  }

  static join(...paths: PathLike[]): string {
    return joinPaths(...paths);
  }

  static normalize(path: PathLike): string {
    return normalizePathInput(path);
  }

  static parse(path: PathLike): {
    base: string;
    dir: string;
    ext: string;
    name: string;
    root: string;
  } {
    return parsePath(path);
  }

  static relative(from: PathLike, to: PathLike): string {
    return relative(from, to);
  }

  static info(...uris: PathLike[]): PathInfo | PathInfo[] {
    if (uris.length === 0) {
      throw new Error("Paths.info requires at least one uri");
    }
    const normalized = uris.map((uri) => (typeof uri === "string" ? uri : uri.uri));
    if (uris.length === 1) {
      return callNativeSync<PathInfo>("getPathInfo", { uri: normalized[0] });
    }
    return normalized.map((uri) => callNativeSync<PathInfo>("getPathInfo", { uri }));
  }
}
