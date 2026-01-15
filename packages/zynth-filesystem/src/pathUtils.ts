import type { PathLike } from "./types";

const FILE_SCHEME = "file://";
const URI_REGEX = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

export function pathLikeToString(value: PathLike): string {
  if (typeof value === "string") return value;
  return value.uri;
}

export function getUriScheme(uri: string): string | null {
  const match = uri.match(URI_REGEX);
  if (!match) return null;
  return match[0].slice(0, -3);
}

export function isUri(value: string): boolean {
  return URI_REGEX.test(value);
}

export function stripFileScheme(uri: string): string {
  if (uri.startsWith(FILE_SCHEME)) {
    return uri.slice(FILE_SCHEME.length) || "/";
  }
  return uri;
}

export function stripScheme(uri: string): string {
  const match = uri.match(URI_REGEX);
  if (!match) return uri;
  return uri.slice(match[0].length);
}

export function normalizeFileUri(uri: string): string {
  if (isUri(uri)) {
    return uri;
  }
  if (uri.startsWith("/")) {
    return `${FILE_SCHEME}${uri}`;
  }
  return uri;
}

export function normalizePath(path: string): string {
  if (!path) return "";
  const isAbsolute = path.startsWith("/");
  const parts = path.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (stack.length && stack[stack.length - 1] !== "..") {
        stack.pop();
      } else if (!isAbsolute) {
        stack.push("..");
      }
      continue;
    }
    stack.push(part);
  }
  const joined = stack.join("/");
  if (isAbsolute) {
    return `/${joined}`.replace(/\/+$/, "") || "/";
  }
  return joined || ".";
}

export function joinPaths(...segments: PathLike[]): string {
  const parts = segments.map(pathLikeToString).filter(Boolean);
  if (parts.length === 0) return "";

  const first = parts[0];
  const scheme = getUriScheme(first);
  if (scheme && scheme !== "file" && scheme !== "asset" && scheme !== "bundle") {
    if (parts.length > 1) {
      throw new Error(`Cannot join paths for ${scheme} URIs`);
    }
    return first;
  }

  const basePath = scheme ? stripScheme(first) : first;
  let combined = basePath;
  for (const segment of parts.slice(1)) {
    const cleanSegment = scheme ? stripScheme(segment) : segment;
    if (!cleanSegment) continue;
    if (cleanSegment.startsWith("/")) {
      combined = cleanSegment;
    } else {
      combined = combined.endsWith("/") ? `${combined}${cleanSegment}` : `${combined}/${cleanSegment}`;
    }
  }

  const normalized = normalizePath(combined);
  if (scheme === "file") {
    return normalizeFileUri(normalized);
  }
  if (scheme === "asset" || scheme === "bundle") {
    const trimmed = normalized === "." ? "" : normalized.replace(/^\/+/, "");
    return `${scheme}://${trimmed}`;
  }
  return normalized;
}

export function basename(pathInput: PathLike, ext?: string): string {
  const input = pathLikeToString(pathInput);
  const scheme = getUriScheme(input);
  const path = scheme ? stripScheme(input) : input;
  const parts = path.split("/").filter(Boolean);
  let base = parts.length ? parts[parts.length - 1] : "";
  if (ext && base.endsWith(ext)) {
    base = base.slice(0, base.length - ext.length);
  }
  return base;
}

export function dirname(pathInput: PathLike): string {
  const input = pathLikeToString(pathInput);
  const scheme = getUriScheme(input);
  const path = scheme ? stripScheme(input) : input;
  const isAbsolutePath = path.startsWith("/");
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  if (!parts.length) {
    const fallback = isAbsolutePath ? "/" : ".";
    if (scheme === "file") {
      return normalizeFileUri(fallback);
    }
    if (scheme === "asset" || scheme === "bundle") {
      const trimmed = fallback === "." ? "" : fallback.replace(/^\/+/, "");
      return `${scheme}://${trimmed}`;
    }
    return fallback;
  }
  const dirPath = (isAbsolutePath ? "/" : "") + parts.join("/");
  const normalized = normalizePath(dirPath);
  if (scheme === "file") {
    return normalizeFileUri(normalized);
  }
  if (scheme === "asset" || scheme === "bundle") {
    const trimmed = normalized === "." ? "" : normalized.replace(/^\/+/, "");
    return `${scheme}://${trimmed}`;
  }
  return normalized;
}

export function extname(pathInput: PathLike): string {
  const base = basename(pathInput);
  const index = base.lastIndexOf(".");
  if (index <= 0) return "";
  return base.slice(index);
}

export function isAbsolute(pathInput: PathLike): boolean {
  const input = pathLikeToString(pathInput);
  if (isUri(input)) return true;
  return input.startsWith("/");
}

export function parsePath(pathInput: PathLike): {
  root: string;
  dir: string;
  base: string;
  ext: string;
  name: string;
} {
  const input = pathLikeToString(pathInput);
  const scheme = getUriScheme(input);
  const path = scheme ? stripScheme(input) : input;
  const base = basename(path);
  const ext = extname(path);
  const name = ext ? base.slice(0, base.length - ext.length) : base;
  const dirPath = dirname(path);
  const root = path.startsWith("/") ? "/" : "";
  let dir = normalizePath(dirPath);
  if (scheme === "file") {
    dir = normalizeFileUri(dir);
  } else if (scheme === "asset" || scheme === "bundle") {
    const trimmed = dir === "." ? "" : dir.replace(/^\/+/, "");
    dir = `${scheme}://${trimmed}`;
  }
  return {
    root,
    dir,
    base,
    ext,
    name,
  };
}

export function relative(fromInput: PathLike, toInput: PathLike): string {
  const from = normalizePath(stripScheme(pathLikeToString(fromInput)));
  const to = normalizePath(stripScheme(pathLikeToString(toInput)));
  const fromParts = from.split("/").filter(Boolean);
  const toParts = to.split("/").filter(Boolean);
  let shared = 0;
  while (shared < fromParts.length && shared < toParts.length) {
    if (fromParts[shared] !== toParts[shared]) break;
    shared += 1;
  }
  const up = fromParts.slice(shared).map(() => "..");
  const down = toParts.slice(shared);
  const joined = [...up, ...down].join("/");
  return joined || ".";
}

export function normalizePathInput(pathInput: PathLike): string {
  const input = pathLikeToString(pathInput);
  const scheme = getUriScheme(input);
  if (scheme === "file") {
    return normalizeFileUri(normalizePath(stripScheme(input)));
  }
  if (scheme === "asset" || scheme === "bundle") {
    const normalized = normalizePath(stripScheme(input));
    const trimmed = normalized === "." ? "" : normalized.replace(/^\/+/, "");
    return `${scheme}://${trimmed}`;
  }
  if (scheme) return input;
  return normalizePath(input);
}
