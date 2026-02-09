import { children, mergeProps, splitProps } from "solid-js";
import type { Accessor, JSX, ParentComponent } from "solid-js";
import { SkiaView } from "./SkiaView";
import { resolvePathCommands } from "./path";
import type {
  SkiaCanvasProps,
  SkiaCircleProps,
  SkiaColorValue,
  SkiaDrawCommand,
  SkiaGroupProps,
  SkiaPaintProps,
  SkiaPaintStyle,
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
  shader?: SkiaShaderProgram;
};

type CompileState = {
  offsetX: number;
  offsetY: number;
  paint: PaintState;
};

const defaultPaint: PaintState = {
  color: "#FFFFFF",
  style: "fill",
  strokeWidth: 1,
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
    shader: props.shader ?? state.paint.shader,
  };
}

function compileShapeRect(
  props: SkiaRectProps,
  state: CompileState,
  time: number,
  out: SkiaDrawCommand[],
) {
  const x = readNumber(props.x) + state.offsetX;
  const y = readNumber(props.y) + state.offsetY;
  const width = readNumber(props.width);
  const height = readNumber(props.height);
  const paint = mergePaint(state, props);
  const color = evaluateColor(paint.shader, paint.color, {
    x,
    y,
    width,
    height,
    time,
  });

  out.push({
    type: "rect",
    x,
    y,
    width,
    height,
    color,
    style: paint.style,
    strokeWidth: paint.strokeWidth,
  });
}

function compileShapeCircle(
  props: SkiaCircleProps,
  state: CompileState,
  time: number,
  out: SkiaDrawCommand[],
) {
  const cx = readNumber(props.cx) + state.offsetX;
  const cy = readNumber(props.cy) + state.offsetY;
  const r = readNumber(props.r);
  const paint = mergePaint(state, props);
  const color = evaluateColor(paint.shader, paint.color, {
    x: cx,
    y: cy,
    width: r * 2,
    height: r * 2,
    time,
  });

  out.push({
    type: "circle",
    cx,
    cy,
    r,
    color,
    style: paint.style,
    strokeWidth: paint.strokeWidth,
  });
}

function compileShapePath(
  props: SkiaPathProps,
  state: CompileState,
  time: number,
  out: SkiaDrawCommand[],
) {
  const commands = resolvePathCommands(props.path);
  const paint = mergePaint(state, {
    color: props.color,
    style: props.style,
    strokeWidth: props.strokeWidth,
    shader: props.shader,
  });

  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;
  let hasPoint = false;

  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index]!;
    if (command.type === "moveTo") {
      currentX = command.x + state.offsetX;
      currentY = command.y + state.offsetY;
      startX = currentX;
      startY = currentY;
      hasPoint = true;
      continue;
    }

    if (command.type === "lineTo") {
      const x = command.x + state.offsetX;
      const y = command.y + state.offsetY;
      if (!hasPoint) {
        currentX = x;
        currentY = y;
        startX = x;
        startY = y;
        hasPoint = true;
        continue;
      }
      const color = evaluateColor(paint.shader, paint.color, {
        x: (currentX + x) * 0.5,
        y: (currentY + y) * 0.5,
        width: Math.abs(x - currentX),
        height: Math.abs(y - currentY),
        time,
      });
      out.push({
        type: "line",
        x1: currentX,
        y1: currentY,
        x2: x,
        y2: y,
        color,
        strokeWidth: paint.strokeWidth,
      });
      currentX = x;
      currentY = y;
      continue;
    }

    if (!hasPoint) continue;
    const color = evaluateColor(paint.shader, paint.color, {
      x: (currentX + startX) * 0.5,
      y: (currentY + startY) * 0.5,
      width: Math.abs(startX - currentX),
      height: Math.abs(startY - currentY),
      time,
    });
    out.push({
      type: "line",
      x1: currentX,
      y1: currentY,
      x2: startX,
      y2: startY,
      color,
      strokeWidth: paint.strokeWidth,
    });
    currentX = startX;
    currentY = startY;
  }
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
    const groupState: CompileState = {
      offsetX: state.offsetX + readNumber(props.x),
      offsetY: state.offsetY + readNumber(props.y),
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
      offsetX: state.offsetX,
      offsetY: state.offsetY,
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
      offsetX: 0,
      offsetY: 0,
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
    children: resolved,
  }) as unknown as JSX.Element;
}

export function Paint(props: SkiaPaintProps): JSX.Element {
  const resolved = children(() => props.children);
  return createNode("paint", {
    color: props.color,
    style: props.style,
    strokeWidth: props.strokeWidth,
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
