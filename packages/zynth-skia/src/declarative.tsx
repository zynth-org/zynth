import { children, mergeProps, splitProps } from "solid-js";
import type { Accessor, JSX, ParentComponent } from "solid-js";
import { captureSharedSignals } from "@zynth/core";
import { assertSkiaFeature } from "./native";
import { resolvePathCommands } from "./path";
import {
  createShader,
  isRuntimeShaderProgram,
  resolveRuntimeShaderUniformMap,
  resolveRuntimeUniforms,
} from "./shader";
import { SkiaView } from "./SkiaView";
import {
  applyMatrixPoint,
  boundsFromPoints,
  identityMatrix,
  isAxisAligned,
  resolveCircleUniformScale,
  resolveGroupTransform,
  type Matrix2D,
} from "./declarativeMath";
import type {
  SkiaCanvasProps,
  SkiaCircleProps,
  SkiaColorValue,
  SkiaDrawCommand,
  SkiaDrawRuntimeShaderCircle,
  SkiaDrawRuntimeShaderPath,
  SkiaDrawRuntimeShaderRect,
  SkiaGroupProps,
  SkiaPaintProps,
  SkiaPaintStyle,
  SkiaPathCommand,
  SkiaPathProps,
  SkiaRectProps,
  SkiaRuntimeEffect,
  SkiaRuntimeUniforms,
  SkiaSharedSignalToken,
  SkiaShaderProps,
  SkiaShaderProgram,
} from "./types";

const SKIA_NODE = Symbol("zynth.skia.node");

type SkiaNodeKind = "group" | "paint" | "rect" | "circle" | "path" | "shader";

type SkiaNode<T extends object> = {
  readonly [SKIA_NODE]: true;
  readonly kind: SkiaNodeKind;
  readonly props: T & { children?: JSX.Element };
};

type ShaderNodeProps = {
  source: SkiaShaderProgram | SkiaRuntimeEffect;
  uniforms?: SkiaRuntimeUniforms;
};

type PaintState = {
  color: SkiaColorValue;
  style: SkiaPaintStyle;
  strokeWidth: number | SkiaSharedSignalToken;
  antiAlias: boolean;
  opacity: number | SkiaSharedSignalToken;
  strokeCap: "butt" | "round" | "square";
  strokeJoin: "miter" | "round" | "bevel";
  strokeMiter: number | SkiaSharedSignalToken;
  shader?: SkiaShaderProgram;
};

type CompileState = {
  transform: Matrix2D;
  paint: PaintState;
};

const defaultPaint: PaintState = {
  color: "#FFFFFF",
  style: "fill",
  strokeWidth: 1,
  antiAlias: true,
  opacity: 1,
  strokeCap: "butt",
  strokeJoin: "miter",
  strokeMiter: 4,
};

function createNode<T extends object>(kind: SkiaNodeKind, props: T): SkiaNode<T> {
  return {
    [SKIA_NODE]: true,
    kind,
    props,
  };
}

function isNode(value: unknown): value is SkiaNode<Record<string, unknown>> {
  if (!value || typeof value !== "object") {
    return false;
  }
  return (value as Record<PropertyKey, unknown>)[SKIA_NODE] === true;
}

function toChildArray(value: unknown): unknown[] {
  if (value == null || value === false || value === true) {
    return [];
  }
  if (
    typeof value === "function"
    && value != null
    && typeof (value as { toArray?: unknown }).toArray === "function"
  ) {
    const accessor = value as unknown as { toArray: () => unknown };
    return toChildArray(accessor.toArray());
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const next = toChildArray(value[index]);
      for (let inner = 0; inner < next.length; inner += 1) {
        out.push(next[inner]);
      }
    }
    return out;
  }
  return [value];
}

function readNumber(value: unknown, fallback = 0): number {
  if (isSharedSignalToken(value)) {
    return readNumber(value.__zynth_shared_signal_current, fallback);
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isSharedSignalToken(value: unknown): value is SkiaSharedSignalToken {
  if (!value || typeof value !== "object") return false;
  const token = value as Partial<SkiaSharedSignalToken>;
  return (
    typeof token.__zynth_shared_value === "number"
    && typeof token.__zynth_shared_signal_current === "number"
  );
}

function resolveScalar(value: unknown, fallback = 0): number | SkiaSharedSignalToken {
  if (isSharedSignalToken(value)) return value;
  return readNumber(value, fallback);
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function readTime(value: SkiaCanvasProps["time"]): number {
  if (typeof value === "function") {
    return readNumber((value as Accessor<number>)(), 0);
  }
  return readNumber(value, 0);
}

function evaluateColor(
  shader: SkiaShaderProgram | undefined,
  fallback: SkiaColorValue,
  input: { x: number; y: number; width: number; height: number; time: number },
): SkiaColorValue {
  if (!shader) return fallback;
  return shader.evaluate(input);
}

function isRuntimeEffect(value: unknown): value is SkiaRuntimeEffect {
  if (!value || typeof value !== "object") return false;
  const runtimeEffect = value as Partial<SkiaRuntimeEffect>;
  return typeof runtimeEffect.source === "string" && typeof runtimeEffect.makeShader === "function";
}

function createProgramFromShaderNode(props: ShaderNodeProps): SkiaShaderProgram {
  if (isRuntimeEffect(props.source)) {
    return props.source.makeShader(props.uniforms);
  }
  if (isRuntimeShaderProgram(props.source)) {
    const uniforms = resolveRuntimeUniforms(props.uniforms);
    return props.source.runtimeEffect!.makeShader({
      ...props.source.uniforms,
      ...uniforms,
    });
  }
  const uniforms = resolveRuntimeUniforms(props.uniforms);
  if (Object.keys(uniforms).length === 0) {
    return props.source;
  }
  return createShader(props.source.source, {
    ...props.source.uniforms,
    ...uniforms,
  });
}

function resolveShaderChild(
  value: unknown,
): SkiaShaderProgram | undefined {
  const items = toChildArray(value);
  for (let index = 0; index < items.length; index += 1) {
    const child = items[index];
    if (!isNode(child) || child.kind !== "shader") {
      continue;
    }
    return createProgramFromShaderNode(child.props as ShaderNodeProps);
  }
  return undefined;
}

function mergePaint(state: CompileState, props: Partial<SkiaPaintProps>): PaintState {
  const nextOpacityRaw = props.opacity ?? state.paint.opacity;
  const nextOpacity = isSharedSignalToken(nextOpacityRaw)
    ? nextOpacityRaw
    : clampUnit(readNumber(nextOpacityRaw, 1));

  return {
    color: props.color ?? state.paint.color,
    style: props.style ?? state.paint.style,
    strokeWidth: resolveScalar(props.strokeWidth ?? state.paint.strokeWidth, 1),
    antiAlias: props.antiAlias ?? state.paint.antiAlias,
    opacity: nextOpacity,
    strokeCap: props.strokeCap ?? state.paint.strokeCap,
    strokeJoin: props.strokeJoin ?? state.paint.strokeJoin,
    strokeMiter: resolveScalar(props.strokeMiter ?? state.paint.strokeMiter, 4),
    shader: props.shader ?? state.paint.shader,
  };
}

function hasCurveCommands(commands: readonly SkiaPathCommand[]): boolean {
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index]!;
    if (command.type === "quadTo" || command.type === "cubicTo") {
      return true;
    }
  }
  return false;
}

function hasTokenizedPathScalars(commands: readonly SkiaPathCommand[]): boolean {
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index]!;
    if (command.type === "moveTo" || command.type === "lineTo") {
      if (isSharedSignalToken(command.x) || isSharedSignalToken(command.y)) {
        return true;
      }
      continue;
    }
    if (command.type === "quadTo") {
      if (
        isSharedSignalToken(command.cpx)
        || isSharedSignalToken(command.cpy)
        || isSharedSignalToken(command.x)
        || isSharedSignalToken(command.y)
      ) {
        return true;
      }
      continue;
    }
    if (command.type === "cubicTo") {
      if (
        isSharedSignalToken(command.cp1x)
        || isSharedSignalToken(command.cp1y)
        || isSharedSignalToken(command.cp2x)
        || isSharedSignalToken(command.cp2y)
        || isSharedSignalToken(command.x)
        || isSharedSignalToken(command.y)
      ) {
        return true;
      }
    }
  }
  return false;
}

function isIdentityTransform(matrix: Matrix2D): boolean {
  const epsilon = 1e-6;
  return (
    Math.abs(matrix.a - 1) <= epsilon
    && Math.abs(matrix.b) <= epsilon
    && Math.abs(matrix.c) <= epsilon
    && Math.abs(matrix.d - 1) <= epsilon
    && Math.abs(matrix.tx) <= epsilon
    && Math.abs(matrix.ty) <= epsilon
  );
}

function boundsFromPathCommands(commands: readonly SkiaPathCommand[]) {
  const points: { x: number; y: number }[] = [];
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index]!;
    if (command.type === "moveTo" || command.type === "lineTo") {
      points.push({ x: readNumber(command.x), y: readNumber(command.y) });
      continue;
    }
    if (command.type === "quadTo") {
      points.push(
        { x: readNumber(command.cpx), y: readNumber(command.cpy) },
        { x: readNumber(command.x), y: readNumber(command.y) },
      );
      continue;
    }
    if (command.type === "cubicTo") {
      points.push(
        { x: readNumber(command.cp1x), y: readNumber(command.cp1y) },
        { x: readNumber(command.cp2x), y: readNumber(command.cp2y) },
        { x: readNumber(command.x), y: readNumber(command.y) },
      );
    }
  }
  return boundsFromPoints(points);
}

function transformPathCommands(
  commands: readonly SkiaPathCommand[],
  matrix: Matrix2D,
): { commands: SkiaPathCommand[]; bounds: { x: number; y: number; width: number; height: number } } {
  const transformed: SkiaPathCommand[] = [];
  const points: { x: number; y: number }[] = [];

  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index]!;
    if (command.type === "moveTo") {
      const point = applyMatrixPoint(matrix, command.x, command.y);
      transformed.push({ type: "moveTo", x: point.x, y: point.y });
      points.push(point);
      continue;
    }

    if (command.type === "lineTo") {
      const point = applyMatrixPoint(matrix, command.x, command.y);
      transformed.push({ type: "lineTo", x: point.x, y: point.y });
      points.push(point);
      continue;
    }

    if (command.type === "quadTo") {
      const cp = applyMatrixPoint(matrix, command.cpx, command.cpy);
      const end = applyMatrixPoint(matrix, command.x, command.y);
      transformed.push({ type: "quadTo", cpx: cp.x, cpy: cp.y, x: end.x, y: end.y });
      points.push(cp, end);
      continue;
    }

    if (command.type === "cubicTo") {
      const cp1 = applyMatrixPoint(matrix, command.cp1x, command.cp1y);
      const cp2 = applyMatrixPoint(matrix, command.cp2x, command.cp2y);
      const end = applyMatrixPoint(matrix, command.x, command.y);
      transformed.push({
        type: "cubicTo",
        cp1x: cp1.x,
        cp1y: cp1.y,
        cp2x: cp2.x,
        cp2y: cp2.y,
        x: end.x,
        y: end.y,
      });
      points.push(cp1, cp2, end);
      continue;
    }

    transformed.push({ type: "close" });
  }

  return {
    commands: transformed,
    bounds: boundsFromPoints(points),
  };
}

function pushPaintedShape(
  out: SkiaDrawCommand[],
  command: Exclude<SkiaDrawCommand, { type: "clear" }>,
): void {
  out.push(command);
}

function compileShapeRect(
  props: SkiaRectProps,
  state: CompileState,
  time: number,
  out: SkiaDrawCommand[],
) {
  const xScalar = resolveScalar(props.x);
  const yScalar = resolveScalar(props.y);
  const widthScalar = resolveScalar(props.width);
  const heightScalar = resolveScalar(props.height);
  const x = readNumber(xScalar);
  const y = readNumber(yScalar);
  const width = readNumber(widthScalar);
  const height = readNumber(heightScalar);
  const paint = mergePaint(state, props);
  const childShader = resolveShaderChild(props.children);
  if (childShader) {
    paint.shader = childShader;
  }
  const runtimeShader = paint.shader;

  const p1 = applyMatrixPoint(state.transform, x, y);
  const p2 = applyMatrixPoint(state.transform, x + width, y);
  const p3 = applyMatrixPoint(state.transform, x + width, y + height);
  const p4 = applyMatrixPoint(state.transform, x, y + height);
  const bounds = boundsFromPoints([p1, p2, p3, p4]);
  const x1 = Math.min(p1.x, p3.x);
  const y1 = Math.min(p1.y, p3.y);
  const w = Math.abs(p3.x - p1.x);
  const h = Math.abs(p3.y - p1.y);

  if (runtimeShader && isRuntimeShaderProgram(runtimeShader)) {
    if (!isAxisAligned(state.transform)) {
      throw new Error("Skia runtime shaders currently support axis-aligned Rect only");
    }
    if (paint.style === "stroke") {
      throw new Error("Skia runtime shaders currently support fill style only");
    }
    const runtimeCommand: SkiaDrawRuntimeShaderRect = {
      type: "runtimeShaderRect",
      x: (isAxisAligned(state.transform) ? xScalar : x1) as unknown as number,
      y: (isAxisAligned(state.transform) ? yScalar : y1) as unknown as number,
      width: (isAxisAligned(state.transform) ? widthScalar : w) as unknown as number,
      height: (isAxisAligned(state.transform) ? heightScalar : h) as unknown as number,
      source: runtimeShader.runtimeEffect.source,
      uniforms: resolveRuntimeShaderUniformMap(runtimeShader.uniforms),
      antiAlias: paint.antiAlias,
      opacity: paint.opacity as unknown as number,
    };
    pushPaintedShape(out, runtimeCommand);
    return;
  }

  const color = evaluateColor(paint.shader, paint.color, {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    time,
  });

  if (isAxisAligned(state.transform)) {
    pushPaintedShape(out, {
      type: "rect",
      x: (isAxisAligned(state.transform) ? xScalar : x1) as unknown as number,
      y: (isAxisAligned(state.transform) ? yScalar : y1) as unknown as number,
      width: (isAxisAligned(state.transform) ? widthScalar : w) as unknown as number,
      height: (isAxisAligned(state.transform) ? heightScalar : h) as unknown as number,
      color,
      style: paint.style,
      strokeWidth: paint.strokeWidth as unknown as number,
      antiAlias: paint.antiAlias,
      opacity: paint.opacity as unknown as number,
      strokeCap: paint.strokeCap,
      strokeJoin: paint.strokeJoin,
      strokeMiter: paint.strokeMiter as unknown as number,
    });
    return;
  }

  assertSkiaFeature("paths", "transformed Rect fallback");
  pushPaintedShape(out, {
    type: "path",
    commands: [
      { type: "moveTo", x: p1.x, y: p1.y },
      { type: "lineTo", x: p2.x, y: p2.y },
      { type: "lineTo", x: p3.x, y: p3.y },
      { type: "lineTo", x: p4.x, y: p4.y },
      { type: "close" },
    ],
    color,
    style: paint.style,
    strokeWidth: paint.strokeWidth as unknown as number,
    antiAlias: paint.antiAlias,
    opacity: paint.opacity as unknown as number,
    strokeCap: paint.strokeCap,
    strokeJoin: paint.strokeJoin,
    strokeMiter: paint.strokeMiter as unknown as number,
  });
}

function compileShapeCircle(
  props: SkiaCircleProps,
  state: CompileState,
  time: number,
  out: SkiaDrawCommand[],
) {
  const cxScalar = resolveScalar(props.cx);
  const cyScalar = resolveScalar(props.cy);
  const rScalar = resolveScalar(props.r);
  const cx = readNumber(cxScalar);
  const cy = readNumber(cyScalar);
  const r = readNumber(rScalar);
  const paint = mergePaint(state, props);
  const childShader = resolveShaderChild(props.children);
  if (childShader) {
    paint.shader = childShader;
  }
  const runtimeShader = paint.shader;

  const center = applyMatrixPoint(state.transform, cx, cy);
  const right = applyMatrixPoint(state.transform, cx + r, cy);
  const bottom = applyMatrixPoint(state.transform, cx, cy + r);

  if (runtimeShader && isRuntimeShaderProgram(runtimeShader)) {
    if (paint.style === "stroke") {
      throw new Error("Skia runtime shaders currently support fill style only");
    }
    const uniformScale = resolveCircleUniformScale(state.transform);
    if (uniformScale != null) {
      pushPaintedShape(out, {
        type: "runtimeShaderCircle",
        cx: (isAxisAligned(state.transform) ? cxScalar : center.x) as unknown as number,
        cy: (isAxisAligned(state.transform) ? cyScalar : center.y) as unknown as number,
        r: (isAxisAligned(state.transform) ? rScalar : Math.abs(r * uniformScale)) as unknown as number,
        source: runtimeShader.runtimeEffect.source,
        uniforms: resolveRuntimeShaderUniformMap(runtimeShader.uniforms),
        antiAlias: paint.antiAlias,
        opacity: paint.opacity as unknown as number,
      } satisfies SkiaDrawRuntimeShaderCircle);
      return;
    }

    assertSkiaFeature("paths", "transformed Circle runtime shader");
    assertSkiaFeature("path.curves", "transformed Circle runtime shader");
    const k = 0.5522847498307936;
    const transformedPath = transformPathCommands(
      [
        { type: "moveTo", x: cx + r, y: cy },
        {
          type: "cubicTo",
          cp1x: cx + r,
          cp1y: cy + k * r,
          cp2x: cx + k * r,
          cp2y: cy + r,
          x: cx,
          y: cy + r,
        },
        {
          type: "cubicTo",
          cp1x: cx - k * r,
          cp1y: cy + r,
          cp2x: cx - r,
          cp2y: cy + k * r,
          x: cx - r,
          y: cy,
        },
        {
          type: "cubicTo",
          cp1x: cx - r,
          cp1y: cy - k * r,
          cp2x: cx - k * r,
          cp2y: cy - r,
          x: cx,
          y: cy - r,
        },
        {
          type: "cubicTo",
          cp1x: cx + k * r,
          cp1y: cy - r,
          cp2x: cx + r,
          cp2y: cy - k * r,
          x: cx + r,
          y: cy,
        },
        { type: "close" },
      ],
      state.transform,
    );

    pushPaintedShape(out, {
      type: "runtimeShaderPath",
      commands: transformedPath.commands,
      source: runtimeShader.runtimeEffect.source,
      uniforms: resolveRuntimeShaderUniformMap(runtimeShader.uniforms),
      antiAlias: paint.antiAlias,
      opacity: paint.opacity as unknown as number,
    } satisfies SkiaDrawRuntimeShaderPath);
    return;
  }

  const bounds = boundsFromPoints([
    { x: center.x - Math.abs(right.x - center.x), y: center.y - Math.abs(bottom.y - center.y) },
    { x: center.x + Math.abs(right.x - center.x), y: center.y + Math.abs(bottom.y - center.y) },
  ]);

  const color = evaluateColor(paint.shader, paint.color, {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    time,
  });

  const uniformScale = resolveCircleUniformScale(state.transform);
  if (uniformScale != null) {
    pushPaintedShape(out, {
      type: "circle",
      cx: (isAxisAligned(state.transform) ? cxScalar : center.x) as unknown as number,
      cy: (isAxisAligned(state.transform) ? cyScalar : center.y) as unknown as number,
      r: (isAxisAligned(state.transform) ? rScalar : Math.abs(r * uniformScale)) as unknown as number,
      color,
      style: paint.style,
      strokeWidth: paint.strokeWidth as unknown as number,
      antiAlias: paint.antiAlias,
      opacity: paint.opacity as unknown as number,
      strokeCap: paint.strokeCap,
      strokeJoin: paint.strokeJoin,
      strokeMiter: paint.strokeMiter as unknown as number,
    });
    return;
  }

  assertSkiaFeature("paths", "transformed Circle fallback");
  assertSkiaFeature("path.curves", "transformed Circle fallback");
  const k = 0.5522847498307936;
  const path = transformPathCommands(
    [
      { type: "moveTo", x: cx + r, y: cy },
      { type: "cubicTo", cp1x: cx + r, cp1y: cy + k * r, cp2x: cx + k * r, cp2y: cy + r, x: cx, y: cy + r },
      { type: "cubicTo", cp1x: cx - k * r, cp1y: cy + r, cp2x: cx - r, cp2y: cy + k * r, x: cx - r, y: cy },
      { type: "cubicTo", cp1x: cx - r, cp1y: cy - k * r, cp2x: cx - k * r, cp2y: cy - r, x: cx, y: cy - r },
      { type: "cubicTo", cp1x: cx + k * r, cp1y: cy - r, cp2x: cx + r, cp2y: cy - k * r, x: cx + r, y: cy },
      { type: "close" },
    ],
    state.transform,
  );

  pushPaintedShape(out, {
    type: "path",
    commands: path.commands,
    color,
    style: paint.style,
    strokeWidth: paint.strokeWidth as unknown as number,
    antiAlias: paint.antiAlias,
    opacity: paint.opacity as unknown as number,
    strokeCap: paint.strokeCap,
    strokeJoin: paint.strokeJoin,
    strokeMiter: paint.strokeMiter as unknown as number,
  });
}

function compileShapePath(
  props: SkiaPathProps,
  state: CompileState,
  time: number,
  out: SkiaDrawCommand[],
) {
  const sourceCommands = resolvePathCommands(props.path);
  const tokenizedPath = hasTokenizedPathScalars(sourceCommands);
  const identityTransform = isIdentityTransform(state.transform);
  if (tokenizedPath && !identityTransform) {
    throw new Error("Skia tokenized path interpolation currently requires an identity Group transform");
  }
  const paint = mergePaint(state, props);
  const childShader = resolveShaderChild(props.children);
  if (childShader) {
    paint.shader = childShader;
  }
  if (isRuntimeShaderProgram(paint.shader)) {
    if (paint.style === "stroke") {
      throw new Error("Skia runtime shaders currently support fill style only");
    }
    assertSkiaFeature("paths", "Path runtime shader");
    if (hasCurveCommands(sourceCommands)) {
      assertSkiaFeature("path.curves", "Path runtime shader");
    }
    const transformedPath = tokenizedPath
      ? { commands: sourceCommands, bounds: boundsFromPathCommands(sourceCommands) }
      : transformPathCommands(sourceCommands, state.transform);
    pushPaintedShape(out, {
      type: "runtimeShaderPath",
      commands: transformedPath.commands,
      source: paint.shader.runtimeEffect.source,
      uniforms: resolveRuntimeShaderUniformMap(paint.shader.uniforms),
      antiAlias: paint.antiAlias,
      opacity: paint.opacity as unknown as number,
    } satisfies SkiaDrawRuntimeShaderPath);
    return;
  }

  assertSkiaFeature("paths", "Path");
  if (hasCurveCommands(sourceCommands)) {
    assertSkiaFeature("path.curves", "Path");
  }

  const transformed = tokenizedPath
    ? { commands: sourceCommands, bounds: boundsFromPathCommands(sourceCommands) }
    : transformPathCommands(sourceCommands, state.transform);
  const color = evaluateColor(paint.shader, paint.color, {
    x: transformed.bounds.x,
    y: transformed.bounds.y,
    width: transformed.bounds.width,
    height: transformed.bounds.height,
    time,
  });

  pushPaintedShape(out, {
    type: "path",
    commands: transformed.commands,
    color,
    style: paint.style,
    strokeWidth: paint.strokeWidth as unknown as number,
    antiAlias: paint.antiAlias,
    opacity: paint.opacity as unknown as number,
    strokeCap: paint.strokeCap,
    strokeJoin: paint.strokeJoin,
    strokeMiter: paint.strokeMiter as unknown as number,
  });
}

function compileNode(
  value: unknown,
  state: CompileState,
  time: number,
  out: SkiaDrawCommand[],
): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      compileNode(value[index], state, time, out);
    }
    return;
  }

  if (!isNode(value)) {
    return;
  }

  if (value.kind === "group") {
    const props = value.props as SkiaGroupProps;
    if (
      props.translateX != null || props.translateY != null || props.scale != null
      || props.scaleX != null || props.scaleY != null || props.rotate != null
      || props.originX != null || props.originY != null
    ) {
      assertSkiaFeature("group.transforms", "Group");
    }

    const groupState: CompileState = {
      transform: resolveGroupTransform(state.transform, props),
      paint: state.paint,
    };
    const items = toChildArray(props.children);
    for (let index = 0; index < items.length; index += 1) {
      compileNode(items[index], groupState, time, out);
    }
    return;
  }

  if (value.kind === "paint") {
    const props = value.props as SkiaPaintProps;
    const shader = resolveShaderChild(props.children) ?? props.shader;
    const paintState: CompileState = {
      transform: state.transform,
      paint: mergePaint(state, { ...props, shader }),
    };
    const items = toChildArray(props.children);
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (isNode(item) && item.kind === "shader") continue;
      compileNode(item, paintState, time, out);
    }
    return;
  }

  if (value.kind === "rect") {
    compileShapeRect(value.props as SkiaRectProps, state, time, out);
    return;
  }

  if (value.kind === "circle") {
    compileShapeCircle(value.props as SkiaCircleProps, state, time, out);
    return;
  }

  if (value.kind === "shader") {
    return;
  }

  compileShapePath(value.props as SkiaPathProps, state, time, out);
}

export const Canvas: ParentComponent<SkiaCanvasProps> = (props) => {
  const merged = mergeProps(
    {
      frameLoop: false,
      clearColor: "transparent",
      allowFallback: true,
    },
    props,
  );

  const [local, passThrough] = splitProps(merged, [
    "style",
    "frameLoop",
    "clearColor",
    "allowFallback",
    "time",
    "children",
    "ref",
    "onNativeReady",
  ]);

  const resolvedChildren = children(() => local.children);

  const buildCommands = () => {
    const compiled = captureSharedSignals(() => {
      const commandBuffer: SkiaDrawCommand[] = [];
      const state: CompileState = {
        transform: identityMatrix,
        paint: defaultPaint,
      };
      const items = toChildArray(resolvedChildren);
      const time = readTime(local.time);
      for (let index = 0; index < items.length; index += 1) {
        compileNode(items[index], state, time, commandBuffer);
      }
      return commandBuffer;
    });
    return compiled.result;
  };

  return (
    <SkiaView
      {...passThrough}
      ref={(node) => local.ref?.(node)}
      style={local.style}
      frameLoop={local.frameLoop}
      clearColor={local.clearColor}
      allowFallback={local.allowFallback}
      commands={buildCommands}
      onNativeReady={local.onNativeReady}
    />
  );
};

export function Group(props: SkiaGroupProps): JSX.Element {
  const resolved = children(() => props.children);
  return createNode("group", {
    x: props.x,
    y: props.y,
    translateX: props.translateX,
    translateY: props.translateY,
    scale: props.scale,
    scaleX: props.scaleX,
    scaleY: props.scaleY,
    rotate: props.rotate,
    originX: props.originX,
    originY: props.originY,
    children: resolved,
  }) as unknown as JSX.Element;
}

export function Paint(props: SkiaPaintProps): JSX.Element {
  const resolved = children(() => props.children);
  return createNode("paint", {
    color: props.color,
    style: props.style,
    strokeWidth: props.strokeWidth,
    antiAlias: props.antiAlias,
    opacity: props.opacity,
    strokeCap: props.strokeCap,
    strokeJoin: props.strokeJoin,
    strokeMiter: props.strokeMiter,
    shader: props.shader,
    children: resolved,
  }) as unknown as JSX.Element;
}

export function Rect(props: SkiaRectProps): JSX.Element {
  const resolved = children(() => props.children);
  return createNode("rect", {
    ...props,
    children: resolved,
  }) as unknown as JSX.Element;
}

export function Circle(props: SkiaCircleProps): JSX.Element {
  const resolved = children(() => props.children);
  return createNode("circle", {
    ...props,
    children: resolved,
  }) as unknown as JSX.Element;
}

export function Path(props: SkiaPathProps): JSX.Element {
  const resolved = children(() => props.children);
  return createNode("path", {
    ...props,
    children: resolved,
  }) as unknown as JSX.Element;
}

export function Shader(props: SkiaShaderProps): JSX.Element {
  return createNode("shader", {
    source: props.source,
    uniforms: props.uniforms,
  }) as unknown as JSX.Element;
}
