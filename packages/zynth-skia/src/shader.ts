import { createSharedSignal } from "@zynth/core";
import { createSignal } from "solid-js";
import type {
  CreateSkiaValueOptions,
  SkiaColorValue,
  SkiaRuntimeShaderUniformMap,
  SkiaRuntimeEffect,
  SkiaRuntimeUniforms,
  SkiaShaderInput,
  SkiaShaderProgram,
  SkiaUniformMap,
  SkiaUniformPrimitive,
  SkiaUniformValue,
  SkiaValueTuple,
} from "./types";

type RuntimeShaderProgram = SkiaShaderProgram & { runtimeEffect: SkiaRuntimeEffect };

type ShaderHelpers = {
  clamp(value: number, min: number, max: number): number;
  mix(a: number, b: number, t: number): number;
  smoothstep(edge0: number, edge1: number, x: number): number;
  fract(value: number): number;
  vec2(x: number, y: number): readonly [number, number];
  vec3(x: number, y: number, z: number): readonly [number, number, number];
  vec4(x: number, y: number, z: number, w: number): readonly [number, number, number, number];
  rgb(r: number, g: number, b: number): string;
  rgba(r: number, g: number, b: number, a: number): string;
  toColor(value: unknown): string;
};

type ShaderEvaluator = (
  uniforms: Record<string, SkiaUniformPrimitive>,
  input: SkiaShaderInput,
  helpers: ShaderHelpers,
) => unknown;

const compiledShaderCache = new Map<string, ShaderEvaluator>();

const shaderHelpers: ShaderHelpers = {
  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  },
  mix(a, b, t) {
    return a + (b - a) * t;
  },
  smoothstep(edge0, edge1, x) {
    if (edge0 === edge1) {
      return x < edge0 ? 0 : 1;
    }
    const t = shaderHelpers.clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  },
  fract(value) {
    return value - Math.floor(value);
  },
  vec2(x, y) {
    return [x, y] as const;
  },
  vec3(x, y, z) {
    return [x, y, z] as const;
  },
  vec4(x, y, z, w) {
    return [x, y, z, w] as const;
  },
  rgb(r, g, b) {
    return toHexColor([r, g, b, 1]);
  },
  rgba(r, g, b, a) {
    return toHexColor([r, g, b, a]);
  },
  toColor(value) {
    return normalizeColor(value, "#FFFFFF");
  },
};

function isAccessor(value: SkiaUniformValue): value is () => SkiaUniformPrimitive {
  return typeof value === "function";
}

function isUniformMapAccessor(value: SkiaRuntimeUniforms): value is () => SkiaUniformMap {
  return typeof value === "function";
}

function normalizeNumber(raw: unknown, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function normalizeColor(value: unknown, fallback: SkiaColorValue): SkiaColorValue {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
    return fallback;
  }
  if (Array.isArray(value)) {
    if (value.length === 3) {
      return toHexColor([value[0], value[1], value[2], 1]);
    }
    if (value.length >= 4) {
      return toHexColor([value[0], value[1], value[2], value[3]]);
    }
    return fallback;
  }
  if (typeof value === "number") {
    return toHexColor([value, value, value, 1]);
  }
  if (value && typeof value === "object") {
    const maybeRgba = value as { r?: unknown; g?: unknown; b?: unknown; a?: unknown };
    if (maybeRgba.r != null && maybeRgba.g != null && maybeRgba.b != null) {
      return toHexColor([
        maybeRgba.r,
        maybeRgba.g,
        maybeRgba.b,
        maybeRgba.a == null ? 1 : maybeRgba.a,
      ]);
    }
  }
  return fallback;
}

function toHexColor(input: readonly unknown[]): SkiaColorValue {
  const values = input.slice(0, 4).map((item, index) => {
    const fallback = index === 3 ? 1 : 0;
    const numeric = normalizeNumber(item, fallback);
    const unit = numeric <= 1 ? numeric * 255 : numeric;
    const clamped = shaderHelpers.clamp(unit, 0, 255);
    return Math.round(clamped)
      .toString(16)
      .padStart(2, "0");
  });
  const [r, g, b, a = "ff"] = values;
  return `#${a}${r}${g}${b}`;
}

function compileShader(source: string): ShaderEvaluator {
  const cached = compiledShaderCache.get(source);
  if (cached) return cached;
  const body = `"use strict"; return (${source});`;
  const fn = new Function("u", "input", "h", body) as (
    u: Record<string, SkiaUniformPrimitive>,
    input: SkiaShaderInput,
    h: ShaderHelpers,
  ) => unknown;

  const evaluator: ShaderEvaluator = (uniforms, input, helpers) => fn(uniforms, input, helpers);
  compiledShaderCache.set(source, evaluator);
  return evaluator;
}

function resolveUniforms(uniforms: SkiaUniformMap, into: Record<string, SkiaUniformPrimitive>) {
  const keys = Object.keys(uniforms);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const raw = uniforms[key];
    if (raw == null) continue;
    const value = isAccessor(raw) ? raw() : raw;
    if (Array.isArray(value)) {
      into[key] = value.map((item) => normalizeNumber(item, 0));
      continue;
    }
    if (typeof value === "number") {
      into[key] = normalizeNumber(value, 0);
      continue;
    }
    into[key] = value;
  }
}

export function createShader(
  source: string,
  uniforms: SkiaUniformMap = {},
): SkiaShaderProgram {
  const evaluator = compileShader(source);
  const uniformMap: SkiaUniformMap = { ...uniforms };
  const uniformSnapshot: Record<string, SkiaUniformPrimitive> = Object.create(null) as Record<
    string,
    SkiaUniformPrimitive
  >;

  return {
    source,
    uniforms: uniformMap,
    setUniform(name, value) {
      uniformMap[name] = value;
    },
    evaluate(input) {
      resolveUniforms(uniformMap, uniformSnapshot);
      const result = evaluator(uniformSnapshot, input, shaderHelpers);
      return normalizeColor(result, "#FFFFFF");
    },
  };
}

export function resolveRuntimeUniforms(uniforms?: SkiaRuntimeUniforms): SkiaUniformMap {
  if (!uniforms) return {};
  const resolved = isUniformMapAccessor(uniforms) ? uniforms() : uniforms;
  return resolved && typeof resolved === "object" ? resolved : {};
}

export function createRuntimeEffect(source: string): SkiaRuntimeEffect | null {
  if (typeof source !== "string" || source.trim().length === 0) {
    return null;
  }
  const trimmedSource = source.trim();
  const effect: SkiaRuntimeEffect = {
    source: trimmedSource,
    makeShader(uniforms = {}) {
      const uniformMap = resolveRuntimeUniforms(uniforms);
      return {
        source: trimmedSource,
        uniforms: uniformMap,
        runtimeEffect: effect,
        setUniform(name, value) {
          uniformMap[name] = value;
        },
        evaluate() {
          // Runtime shaders are executed natively; JS color evaluation is only a fallback.
          return "#FFFFFFFF";
        },
      };
    },
  };
  return effect;
}

export function isRuntimeShaderProgram(
  program: SkiaShaderProgram | undefined,
): program is RuntimeShaderProgram {
  if (!program) return false;
  return (
    typeof program.runtimeEffect?.source === "string"
    && program.runtimeEffect.source.trim().length > 0
  );
}

export function resolveRuntimeShaderUniformMap(
  uniforms: SkiaUniformMap,
): SkiaRuntimeShaderUniformMap {
  const output: SkiaRuntimeShaderUniformMap = {};
  const keys = Object.keys(uniforms);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const raw = uniforms[key];
    if (raw == null) continue;
    const value = isAccessor(raw) ? raw() : raw;
    if (typeof value === "number") {
      const parsed = normalizeNumber(value, 0);
      output[key] = parsed;
      continue;
    }
    if (Array.isArray(value)) {
      const packed: number[] = [];
      for (let i = 0; i < value.length; i += 1) {
        packed.push(normalizeNumber(value[i], 0));
      }
      output[key] = packed;
    }
  }
  return output;
}

export const Skia = {
  RuntimeEffect: {
    Make(source: string) {
      return createRuntimeEffect(source);
    },
  },
} as const;

export function createSkiaValue<T>(
  initial: T,
  options: CreateSkiaValueOptions = {},
): SkiaValueTuple<T> {
  if (options.shared && typeof initial === "number") {
    return createSharedSignal(initial) as SkiaValueTuple<T>;
  }
  return createSignal(initial) as SkiaValueTuple<T>;
}
