import { URLSearchParams } from "@rune/core";
import type { LinkingOptions, LinkingRouteConfig, NavigationState } from "../ios/core/types";
import { dispatchNavigationAction } from "./nativeBridge";

let currentLinkingOptions: LinkingOptions | null = null;

export function setLinkingOptions(options: LinkingOptions | null): void {
  currentLinkingOptions = options;
}

export function getLinkingOptions(): LinkingOptions | null {
  return currentLinkingOptions;
}

export function handleLink(url: string): boolean {
  if (!currentLinkingOptions) {
    return false;
  }

  const { filter, prefixes, getStateFromPath, config, onUnhandledURL } =
    currentLinkingOptions;

  if (filter && !filter(url)) {
    return false;
  }

  const path = stripPrefix(url, prefixes ?? []);
  if (path.length === 0) {
    return false;
  }

  const state =
    getStateFromPath?.(path) ?? (config ? matchStateFromConfig(path, config) : undefined);

  if (state) {
    dispatchNavigationAction({ type: "RESET", state });
    return true;
  }

  onUnhandledURL?.(url);
  return false;
}

export function getPathFromState(state: NavigationState): string | null {
  const options = currentLinkingOptions;
  if (!options) {
    return null;
  }

  const path =
    options.getPathFromState?.(state) ??
    (options.config ? buildPathFromState(state, options.config) : undefined);

  if (!path) {
    return null;
  }

  const prefix = options.prefixes?.[0];
  return prefix ? joinPath(prefix, path) : path;
}

function stripPrefix(url: string, prefixes: string[]): string {
  if (prefixes.length === 0) {
    return sanitizePath(url);
  }

  const normalized = sanitizePath(url);
  for (const prefix of prefixes) {
    const normalizedPrefix = sanitizePath(prefix);
    if (normalized.startsWith(normalizedPrefix)) {
      return normalized.slice(normalizedPrefix.length);
    }
  }
  return normalized;
}

function sanitizePath(path: string): string {
  return path.replace(/^[^:]+:\/\//, "").replace(/^\/+/, "");
}

function joinPath(prefix: string, path: string): string {
  const sanitizedPrefix = prefix.replace(/\/+$/, "");
  const sanitizedPath = path.replace(/^\/+/, "");
  return `${sanitizedPrefix}/${sanitizedPath}`;
}

function normalizeConfigEntry(
  name: string,
  entry: LinkingRouteConfig | string
): LinkingRouteConfig & { name: string } {
  if (typeof entry === "string") {
    return { name, path: entry };
  }
  return { name, ...entry };
}

function matchStateFromConfig(
  path: string,
  config: Record<string, LinkingRouteConfig | string>
): NavigationState | undefined {
  const [pathname, queryString = ""] = path.split("?");
  const segments = pathname.split("/").filter(Boolean);
  const query = new URLSearchParams(queryString);

  const result = matchScreens(segments, config);
  if (!result) {
    return undefined;
  }

  if (queryString.length > 0) {
    applyQueryToState(result.route, query);
  }

  return {
    key: "root",
    type: "stack",
    index: 0,
    routes: [result.route],
  };
}

/*
function parseQueryString(queryString: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!queryString) return result;
  const pairs = queryString.split("&");
  for (const pair of pairs) {
    const [key, value] = pair.split("=");
    if (key) {
      result[decodeURIComponent(key)] = value
        ? decodeURIComponent(value)
        : "";
    }
  }
  return result;
}
*/

interface MatchResult {
  route: ReturnType<typeof createRouteNode>;
  consumed: number;
}

function matchScreens(
  segments: string[],
  config: Record<string, LinkingRouteConfig | string>
): MatchResult | null {
  for (const [name, entry] of Object.entries(config)) {
    const descriptor = normalizeConfigEntry(name, entry);
    const pattern = descriptor.path?.split("/").filter(Boolean) ?? [];
    const { matched, params, consumed } = matchPattern(pattern, segments);
    if (!matched) {
      continue;
    }
    const parsedParams = applyParsers(params, descriptor.parse);

    let childConsumed = 0;
    let childState: NavigationState | undefined;
    if (descriptor.screens) {
      const restSegments = segments.slice(consumed);
      const childMatch = matchScreens(restSegments, descriptor.screens);
      if (childMatch) {
        childConsumed = childMatch.consumed;
        childState = {
          key: `${name}-nested`,
          type: "stack",
          index: 0,
          routes: [childMatch.route],
        };
      } else if (restSegments.length > 0) {
        continue;
      }
    } else if (segments.length > consumed) {
      continue;
    }

    return {
      route: createRouteNode(name, parsedParams, childState),
      consumed: consumed + childConsumed,
    };
  }
  return null;
}

function matchPattern(
  patternSegments: string[],
  pathSegments: string[]
): { matched: boolean; params: Record<string, unknown>; consumed: number } {
  if (patternSegments.length === 0) {
    return { matched: true, params: {}, consumed: 0 };
  }

  if (pathSegments.length < patternSegments.length) {
    return { matched: false, params: {}, consumed: 0 };
  }

  const params: Record<string, unknown> = {};
  for (let i = 0; i < patternSegments.length; i += 1) {
    const pattern = patternSegments[i];
    const segment = pathSegments[i];
    if (pattern.startsWith(":")) {
      const key = pattern.slice(1);
      params[key] = decodeURIComponent(segment);
    } else if (pattern !== segment) {
      return { matched: false, params: {}, consumed: 0 };
    }
  }

  return { matched: true, params, consumed: patternSegments.length };
}

function createRouteNode(
  name: string,
  params: Record<string, unknown>,
  state?: NavigationState
) {
  return {
    key: `${name}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    params,
    state,
  };
}

function applyQueryToState(
  route: ReturnType<typeof createRouteNode>,
  query: URLSearchParams
): void {
  const params = route.params ?? {};
  for (const [key, value] of query.entries()) {
    params[key] = value;
  }
  route.params = params;
}

function applyParsers(
  params: Record<string, unknown>,
  parsers?: Record<string, (value: string) => unknown>
): Record<string, unknown> {
  if (!parsers) {
    return params;
  }
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    const parser = parsers[key];
    next[key] = typeof parser === "function" ? parser(String(value)) : value;
  }
  return next;
}

function buildPathFromState(
  state: NavigationState,
  config: Record<string, LinkingRouteConfig | string>
): string | undefined {
  const route = state.routes[state.index ?? 0];
  if (!route) {
    return undefined;
  }

  const descriptor = config[route.name];
  if (!descriptor) {
    return undefined;
  }
  const normalized = normalizeConfigEntry(route.name, descriptor);
  const patternSegments = normalized.path?.split("/").filter(Boolean) ?? [];
  const builtSegments = patternSegments.map((segment) => {
    if (!segment.startsWith(":")) {
      return segment;
    }
    const key = segment.slice(1);
    const raw = route.params?.[key];
    const stringify = normalized.stringify?.[key];
    const value =
      typeof stringify === "function" ? stringify(raw) : String(raw ?? "");
    return encodeURIComponent(value);
  });

  let childPath: string | undefined;
  if (normalized.screens && route.state) {
    childPath = buildPathFromState(route.state, normalized.screens);
  }

  return [...builtSegments, childPath].filter(Boolean).join("/");
}
