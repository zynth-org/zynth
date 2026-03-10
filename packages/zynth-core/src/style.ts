import { createEffect, createRoot, getListener } from "solid-js";
import type { StyleObject as HostStyle, StyleProp } from "./host/HostTypes";

const STYLE_REF_KIND = "__zynth_style_ref_kind";
const STYLE_REF_ID = "__zynth_style_ref_id";

type StyleKey = keyof HostStyle;
type StyleValue = HostStyle[StyleKey];
type DynamicValue<T> = T | null | undefined | (() => T | null | undefined);
type DynamicStyleMap = {
  [K in keyof HostStyle]?: DynamicValue<HostStyle[K]>;
};

type FlatStyleInput = HostStyle | StyleRef | null | undefined;
type FlatStyleInputArray = ReadonlyArray<FlatStyleInput>;
type StyleInput = FlatStyleInput | FlatStyleInputArray;

type SourceEntry =
  | { kind: "static"; value: StyleValue | null | undefined }
  | { kind: "dynamic"; accessor: () => StyleValue | null | undefined };

type SourceMap = Map<StyleKey, SourceEntry[]>;

type KeyState =
  | { kind: "value"; value: StyleValue }
  | { kind: "absent" };

export interface StaticStyleRef {
  readonly [STYLE_REF_KIND]: "static";
  readonly [STYLE_REF_ID]: number;
  readonly style: Readonly<HostStyle>;
}

export interface BoundStyleRef {
  readonly [STYLE_REF_KIND]: "bound";
  readonly [STYLE_REF_ID]: number;
  readonly base?: StyleInput;
  readonly dynamic: Readonly<DynamicStyleMap>;
}

export interface ComposedStyleRef {
  readonly [STYLE_REF_KIND]: "composed";
  readonly [STYLE_REF_ID]: number;
  readonly layers: ReadonlyArray<StyleInput>;
}

export type StyleRef = StaticStyleRef | BoundStyleRef | ComposedStyleRef;
export type StyleCreateRecord = Record<string, HostStyle>;

export interface StylePatch {
  changed: Partial<HostStyle>;
  removed: StyleKey[];
}

export interface StyleGraphBinding {
  initial: HostStyle;
  hasDynamic: boolean;
  attach: (onPatch: (patch: StylePatch) => void) => () => void;
}

let nextStyleRefId = 1;

function makeStyleRefId(): number {
  const id = nextStyleRefId;
  nextStyleRefId += 1;
  return id;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function warnDev(message: string): void {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "production") {
    return;
  }
  // eslint-disable-next-line no-console
  console.warn(message);
}

function maybeWarnOwner(callsite: "create" | "bind"): void {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "production") {
    return;
  }
  // Warn only inside active tracking scopes (memo/effect/rendered expressions),
  // where style ref creation can happen repeatedly and churn identities.
  const listener = getListener();
  if (listener) {
    warnDev(
      `[Style.${callsite}] called inside a reactive owner. Hoist style declarations or memoize to avoid unstable style identities.`
    );
  }
}

function isStyleRefKind(value: unknown): value is StyleRef {
  if (!isObject(value)) return false;
  const kind = value[STYLE_REF_KIND];
  return kind === "static" || kind === "bound" || kind === "composed";
}

function isAccessorValue<T>(
  value: DynamicValue<T>
): value is () => T | null | undefined {
  return typeof value === "function";
}

function sourceArray(map: SourceMap, key: StyleKey): SourceEntry[] {
  const existing = map.get(key);
  if (existing) return existing;
  const next: SourceEntry[] = [];
  map.set(key, next);
  return next;
}

function appendStaticStyle(map: SourceMap, style: HostStyle): void {
  const keys = Object.keys(style) as StyleKey[];
  for (const key of keys) {
    sourceArray(map, key).push({ kind: "static", value: style[key] });
  }
}

function appendDynamicStyle(map: SourceMap, dynamic: DynamicStyleMap): void {
  const keys = Object.keys(dynamic) as StyleKey[];
  for (const key of keys) {
    const raw = dynamic[key];
    if (raw === undefined) continue;
    if (isAccessorValue(raw)) {
      sourceArray(map, key).push({
        kind: "dynamic",
        accessor: raw as () => StyleValue | null | undefined,
      });
    } else {
      sourceArray(map, key).push({ kind: "static", value: raw });
    }
  }
}

function collectSources(target: SourceMap, input: StyleInput): void {
  if (input == null) return;

  if (Array.isArray(input)) {
    for (const entry of input) {
      if (entry != null) {
        collectSources(target, entry);
      }
    }
    return;
  }

  if (isStyleRefKind(input)) {
    if (input[STYLE_REF_KIND] === "static") {
      appendStaticStyle(target, input.style);
      return;
    }
    if (input[STYLE_REF_KIND] === "bound") {
      if (input.base !== undefined) {
        collectSources(target, input.base);
      }
      appendDynamicStyle(target, input.dynamic);
      return;
    }
    for (const layer of input.layers) {
      collectSources(target, layer);
    }
    return;
  }

  appendStaticStyle(target, input as HostStyle);
}

function evaluateKey(entries: SourceEntry[]): StyleValue | null | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const value = entry.kind === "dynamic" ? entry.accessor() : entry.value;
    if (value === undefined) continue;
    return value;
  }
  return undefined;
}

function stateFromValue(value: StyleValue | null | undefined): KeyState {
  if (value === undefined || value === null) {
    return { kind: "absent" };
  }
  return { kind: "value", value };
}

function equalObjects(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (!Object.is(left[key], right[key])) return false;
  }
  return true;
}

function equalArrays(left: ReadonlyArray<unknown>, right: ReadonlyArray<unknown>): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!isStyleValueEqual(left[index], right[index])) return false;
  }
  return true;
}

function isStyleValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return equalArrays(left, right);
  }
  if (isObject(left) && isObject(right)) {
    return equalObjects(left, right);
  }
  return false;
}

function isStateEqual(left: KeyState, right: KeyState): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "absent" || right.kind === "absent") return true;
  return isStyleValueEqual(left.value, right.value);
}

function toStyleObject(sources: SourceMap): HostStyle {
  const output: Partial<Record<StyleKey, StyleValue>> = {};
  for (const [key, entries] of sources) {
    const value = evaluateKey(entries);
    if (value !== undefined && value !== null) {
      output[key] = value;
    }
  }
  return output as HostStyle;
}

function hasDynamicSources(sources: SourceMap): boolean {
  for (const entries of sources.values()) {
    for (const entry of entries) {
      if (entry.kind === "dynamic") return true;
    }
  }
  return false;
}

function dynamicKeys(sources: SourceMap): StyleKey[] {
  const keys: StyleKey[] = [];
  for (const [key, entries] of sources) {
    let isDynamic = false;
    for (const entry of entries) {
      if (entry.kind === "dynamic") {
        isDynamic = true;
        break;
      }
    }
    if (isDynamic) {
      keys.push(key);
    }
  }
  return keys;
}

function toStyleInput(value: StyleProp | undefined): StyleInput {
  if (value === undefined) return undefined;
  return value as StyleInput;
}

export function isStyleRef(value: unknown): value is StyleRef {
  return isStyleRefKind(value);
}

export function flattenStyleProp(style: StyleProp | undefined): HostStyle | undefined {
  if (style === undefined) return undefined;
  const sources = new Map<StyleKey, SourceEntry[]>();
  collectSources(sources, toStyleInput(style));
  const flattened = toStyleObject(sources);
  return Object.keys(flattened).length === 0 ? undefined : flattened;
}

export function createStyleGraphBinding(style: StyleProp | undefined): StyleGraphBinding {
  const sources = new Map<StyleKey, SourceEntry[]>();
  collectSources(sources, toStyleInput(style));
  const initial = toStyleObject(sources);
  const hasDynamic = hasDynamicSources(sources);

  if (!hasDynamic) {
    return {
      initial,
      hasDynamic: false,
      attach: () => () => undefined,
    };
  }

  const keys = dynamicKeys(sources);
  const states = new Map<StyleKey, KeyState>();
  for (const [key, entries] of sources) {
    states.set(key, stateFromValue(evaluateKey(entries)));
  }

  return {
    initial,
    hasDynamic: true,
    attach(onPatch) {
      let disposeRoot: (() => void) | null = null;
      createRoot((dispose) => {
        disposeRoot = dispose;
        for (const key of keys) {
          const entries = sources.get(key);
          if (!entries) continue;
          createEffect(() => {
            const nextState = stateFromValue(evaluateKey(entries));
            const previous = states.get(key) ?? { kind: "absent" };
            if (isStateEqual(previous, nextState)) {
              return;
            }
            states.set(key, nextState);
            if (nextState.kind === "absent") {
              onPatch({ changed: {}, removed: [key] });
              return;
            }
            onPatch({
              changed: { [key]: nextState.value },
              removed: [],
            });
          });
        }
      });
      return () => {
        if (disposeRoot) {
          disposeRoot();
          disposeRoot = null;
        }
      };
    },
  };
}

function cloneStyle(style: HostStyle): HostStyle {
  return { ...style };
}

function freezeIfDev<T>(value: T): T {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "production") {
    return value;
  }
  if (isObject(value)) {
    return Object.freeze(value) as T;
  }
  return value;
}

function createStaticRef(style: HostStyle): StaticStyleRef {
  return freezeIfDev({
    [STYLE_REF_KIND]: "static" as const,
    [STYLE_REF_ID]: makeStyleRefId(),
    style: freezeIfDev(cloneStyle(style)),
  });
}

function createBoundRef(base: StyleInput | undefined, dynamic: DynamicStyleMap): BoundStyleRef {
  return freezeIfDev({
    [STYLE_REF_KIND]: "bound" as const,
    [STYLE_REF_ID]: makeStyleRefId(),
    base,
    dynamic: freezeIfDev({ ...dynamic }),
  });
}

function createComposedRef(layers: ReadonlyArray<StyleInput>): ComposedStyleRef {
  return freezeIfDev({
    [STYLE_REF_KIND]: "composed" as const,
    [STYLE_REF_ID]: makeStyleRefId(),
    layers: freezeIfDev(layers.slice()),
  });
}

function hasInvalidDynamicValue(dynamic: DynamicStyleMap): boolean {
  const keys = Object.keys(dynamic) as StyleKey[];
  for (const key of keys) {
    const value = dynamic[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "function") continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      continue;
    }
    if (Array.isArray(value) || isObject(value)) {
      continue;
    }
    return true;
  }
  return false;
}

function createStyles<TRecord extends StyleCreateRecord>(styles: TRecord): {
  readonly [K in keyof TRecord]: StaticStyleRef;
} {
  maybeWarnOwner("create");
  const result: { [K in keyof TRecord]: StaticStyleRef } = {} as {
    [K in keyof TRecord]: StaticStyleRef;
  };
  const keys = Object.keys(styles) as Array<keyof TRecord>;
  for (const key of keys) {
    result[key] = createStaticRef(styles[key]);
  }
  return result;
}

function bindStyle(dynamic: DynamicStyleMap): BoundStyleRef;
function bindStyle(base: StyleInput, dynamic: DynamicStyleMap): BoundStyleRef;
function bindStyle(
  baseOrDynamic: StyleInput | DynamicStyleMap,
  dynamicMaybe?: DynamicStyleMap
): BoundStyleRef {
  maybeWarnOwner("bind");
  const hasBase = dynamicMaybe !== undefined;
  const base = hasBase ? (baseOrDynamic as StyleInput) : undefined;
  const dynamic = (hasBase ? dynamicMaybe : (baseOrDynamic as DynamicStyleMap)) ?? {};
  if (hasInvalidDynamicValue(dynamic)) {
    warnDev(
      "[Style.bind] received an unsupported dynamic value shape. Use plain style values, arrays, objects, or accessors."
    );
  }
  return createBoundRef(base, dynamic);
}

function composeStyles(...layers: StyleInput[]): ComposedStyleRef {
  return createComposedRef(layers);
}

export interface Style extends HostStyle {}

export const Style = {
  create: createStyles,
  bind: bindStyle,
  compose: composeStyles,
};

/** @deprecated Use Style instead */
export const StyleGraph = Style;
/** @deprecated Use Style instead */
export type StyleGraph = Style;
