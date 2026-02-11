import { children, mergeProps, splitProps } from "solid-js";
import type { Accessor, JSX, ParentComponent } from "solid-js";
import { assertSkiaFeature } from "./native";
import { resolvePathCommands } from "./path";
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
  SkiaGroupProps,
  SkiaPaintProps,
  SkiaPaintStyle,
  SkiaPathCommand,
  SkiaPathProps,
  SkiaRectProps,
  SkiaShaderProgram,
} from "./types";

const SKIA_NODE = Symbol("zynth.skia.node");

type SkiaNodeKind = "group" | "paint" | "rect" | "circle" | "path";

type SkiaNode<T extends object> = {
  readonly [SKIA_NODE]: true;
  readonly kind: SkiaNodeKind;
  readonly props: T & { children?: JSX.Element };
};

type PaintState = {
  color: SkiaColorValue;
  style: SkiaPaintStyle;
  strokeWidth: number;
  antiAlias: boolean;
  opacity: number;
  strokeCap: "butt" | "round" | "square";
  strokeJoin: "miter" | "round" | "bevel";
  strokeMiter: number;
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
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
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

function mergePaint(state: CompileState, props: Partial<SkiaPaintProps>): PaintState {
  return {
    color: props.color ?? state.paint.color,
    style: props.style ?? state.paint.style,
    strokeWidth: props.strokeWidth ?? state.paint.strokeWidth,
    antiAlias: props.antiAlias ?? state.paint.antiAlias,
    opacity: clampUnit(props.opacity ?? state.paint.opacity),
    strokeCap: props.strokeCap ?? state.paint.strokeCap,
    strokeJoin: props.strokeJoin ?? state.paint.strokeJoin,
    strokeMiter: props.strokeMiter ?? state.paint.strokeMiter,
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
  const x = readNumber(props.x);
  const y = readNumber(props.y);
  const width = readNumber(props.width);
  const height = readNumber(props.height);
  const paint = mergePaint(state, props);

  const p1 = applyMatrixPoint(state.transform, x, y);
  const p2 = applyMatrixPoint(state.transform, x + width, y);
  const p3 = applyMatrixPoint(state.transform, x + width, y + height);
  const p4 = applyMatrixPoint(state.transform, x, y + height);
  const bounds = boundsFromPoints([p1, p2, p3, p4]);
  const color = evaluateColor(paint.shader, paint.color, {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    time,
  });

  if (isAxisAligned(state.transform)) {
    const x1 = Math.min(p1.x, p3.x);
    const y1 = Math.min(p1.y, p3.y);
    const w = Math.abs(p3.x - p1.x);
    const h = Math.abs(p3.y - p1.y);
    pushPaintedShape(out, {
      type: "rect",
      x: x1,
      y: y1,
      width: w,
      height: h,
      color,
      style: paint.style,
      strokeWidth: paint.strokeWidth,
      antiAlias: paint.antiAlias,
      opacity: paint.opacity,
      strokeCap: paint.strokeCap,
      strokeJoin: paint.strokeJoin,
      strokeMiter: paint.strokeMiter,
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
    strokeWidth: paint.strokeWidth,
    antiAlias: paint.antiAlias,
    opacity: paint.opacity,
    strokeCap: paint.strokeCap,
    strokeJoin: paint.strokeJoin,
    strokeMiter: paint.strokeMiter,
  });
}

function compileShapeCircle(
  props: SkiaCircleProps,
  state: CompileState,
  time: number,
  out: SkiaDrawCommand[],
) {
  const cx = readNumber(props.cx);
  const cy = readNumber(props.cy);
  const r = readNumber(props.r);
  const paint = mergePaint(state, props);

  const center = applyMatrixPoint(state.transform, cx, cy);
  const right = applyMatrixPoint(state.transform, cx + r, cy);
  const bottom = applyMatrixPoint(state.transform, cx, cy + r);

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
      cx: center.x,
      cy: center.y,
      r: Math.abs(r * uniformScale),
      color,
      style: paint.style,
      strokeWidth: paint.strokeWidth,
      antiAlias: paint.antiAlias,
      opacity: paint.opacity,
      strokeCap: paint.strokeCap,
      strokeJoin: paint.strokeJoin,
      strokeMiter: paint.strokeMiter,
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
    strokeWidth: paint.strokeWidth,
    antiAlias: paint.antiAlias,
    opacity: paint.opacity,
    strokeCap: paint.strokeCap,
    strokeJoin: paint.strokeJoin,
    strokeMiter: paint.strokeMiter,
  });
}

function compileShapePath(
  props: SkiaPathProps,
  state: CompileState,
  time: number,
  out: SkiaDrawCommand[],
) {
  const sourceCommands = resolvePathCommands(props.path);
  const paint = mergePaint(state, props);

  assertSkiaFeature("paths", "Path");
  if (hasCurveCommands(sourceCommands)) {
    assertSkiaFeature("path.curves", "Path");
  }

  const transformed = transformPathCommands(sourceCommands, state.transform);
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
    strokeWidth: paint.strokeWidth,
    antiAlias: paint.antiAlias,
    opacity: paint.opacity,
    strokeCap: paint.strokeCap,
    strokeJoin: paint.strokeJoin,
    strokeMiter: paint.strokeMiter,
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
    const paintState: CompileState = {
      transform: state.transform,
      paint: mergePaint(state, props),
    };
    const items = toChildArray(props.children);
    for (let index = 0; index < items.length; index += 1) {
      compileNode(items[index], paintState, time, out);
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
  return createNode("rect", props) as unknown as JSX.Element;
}

export function Circle(props: SkiaCircleProps): JSX.Element {
  return createNode("circle", props) as unknown as JSX.Element;
}

export function Path(props: SkiaPathProps): JSX.Element {
  return createNode("path", props) as unknown as JSX.Element;
}
