import type { SkiaPathCommand, SkiaPathObject, SkiaPathSource } from "./types";

const MAX_PATH_CACHE_ENTRIES = 128;
const parsedPathCache = new Map<string, readonly SkiaPathCommand[]>();

class PathBuilder implements SkiaPathObject {
  private readonly buffer: SkiaPathCommand[];

  constructor(commands: SkiaPathCommand[] = []) {
    this.buffer = commands;
  }

  get commands(): readonly SkiaPathCommand[] {
    return this.buffer;
  }

  moveTo(x: number, y: number): SkiaPathObject {
    this.buffer.push({ type: "moveTo", x, y });
    return this;
  }

  lineTo(x: number, y: number): SkiaPathObject {
    this.buffer.push({ type: "lineTo", x, y });
    return this;
  }

  quadTo(cpx: number, cpy: number, x: number, y: number): SkiaPathObject {
    this.buffer.push({ type: "quadTo", cpx, cpy, x, y });
    return this;
  }

  cubicTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): SkiaPathObject {
    this.buffer.push({ type: "cubicTo", cp1x, cp1y, cp2x, cp2y, x, y });
    return this;
  }

  close(): SkiaPathObject {
    this.buffer.push({ type: "close" });
    return this;
  }

  reset(): SkiaPathObject {
    this.buffer.length = 0;
    return this;
  }

  clone(): SkiaPathObject {
    return new PathBuilder(this.buffer.slice());
  }
}

function parseSvgPath(raw: string): SkiaPathCommand[] {
  const normalized = raw.replace(/,/g, " ").trim();
  if (normalized.length === 0) return [];

  const tokenRegex = /([AaCcHhLlMmQqSsTtVvZz])|(-?\d*\.?\d+(?:e[+-]?\d+)?)/g;
  const tokens: string[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = tokenRegex.exec(normalized)) != null) {
    tokens.push(match[0]!);
  }

  const stripped = normalized.replace(tokenRegex, "").replace(/\s+/g, "");
  if (stripped.length > 0) {
    throw new Error(`Unsupported path token sequence: "${stripped}"`);
  }

  const commands: SkiaPathCommand[] = [];
  let index = 0;
  let cursorX = 0;
  let cursorY = 0;
  let startX = 0;
  let startY = 0;
  let mode:
    | "A" | "M" | "L" | "H" | "V" | "C" | "S" | "Q" | "T"
    | "a" | "m" | "l" | "h" | "v" | "c" | "s" | "q" | "t"
    | null = null;
  let lastCurveControlX: number | null = null;
  let lastCurveControlY: number | null = null;
  let lastCurveKind: "quad" | "cubic" | null = null;

  const readNumber = (): number | null => {
    const token = tokens[index];
    if (token == null) return null;
    if (/^[AaCcHhLlMmQqSsTtVvZz]$/.test(token)) return null;
    index += 1;
    const numeric = Number(token);
    return Number.isFinite(numeric) ? numeric : null;
  };

  while (index < tokens.length) {
    const token = tokens[index]!;
    if (/^[AaCcHhLlMmQqSsTtVvZz]$/.test(token)) {
      const command = token as "A" | "a" | "C" | "c" | "H" | "h" | "L" | "l"
        | "M" | "m" | "Q" | "q" | "S" | "s" | "T" | "t" | "V" | "v" | "Z" | "z";
      index += 1;
      if (command === "Z" || command === "z") {
        commands.push({ type: "close" });
        cursorX = startX;
        cursorY = startY;
        lastCurveControlX = null;
        lastCurveControlY = null;
        lastCurveKind = null;
        continue;
      }
      mode = command;
      continue;
    }

    if (mode == null) {
      break;
    }

    if (mode === "M" || mode === "m") {
      const x = readNumber();
      const y = readNumber();
      if (x == null || y == null) break;
      const nextX = mode === "m" ? cursorX + x : x;
      const nextY = mode === "m" ? cursorY + y : y;
      commands.push({ type: "moveTo", x: nextX, y: nextY });
      cursorX = nextX;
      cursorY = nextY;
      startX = nextX;
      startY = nextY;
      lastCurveControlX = null;
      lastCurveControlY = null;
      lastCurveKind = null;
      mode = mode === "m" ? "l" : "L";
      continue;
    }

    if (mode === "L" || mode === "l") {
      const x = readNumber();
      const y = readNumber();
      if (x == null || y == null) break;
      const nextX = mode === "l" ? cursorX + x : x;
      const nextY = mode === "l" ? cursorY + y : y;
      commands.push({ type: "lineTo", x: nextX, y: nextY });
      cursorX = nextX;
      cursorY = nextY;
      lastCurveControlX = null;
      lastCurveControlY = null;
      lastCurveKind = null;
      continue;
    }

    if (mode === "H" || mode === "h") {
      const x = readNumber();
      if (x == null) break;
      const nextX = mode === "h" ? cursorX + x : x;
      commands.push({ type: "lineTo", x: nextX, y: cursorY });
      cursorX = nextX;
      lastCurveControlX = null;
      lastCurveControlY = null;
      lastCurveKind = null;
      continue;
    }

    if (mode === "V" || mode === "v") {
      const y = readNumber();
      if (y == null) break;
      const nextY = mode === "v" ? cursorY + y : y;
      commands.push({ type: "lineTo", x: cursorX, y: nextY });
      cursorY = nextY;
      lastCurveControlX = null;
      lastCurveControlY = null;
      lastCurveKind = null;
      continue;
    }

    if (mode === "C" || mode === "c") {
      const cp1x = readNumber();
      const cp1y = readNumber();
      const cp2x = readNumber();
      const cp2y = readNumber();
      const x = readNumber();
      const y = readNumber();
      if (
        cp1x == null || cp1y == null || cp2x == null || cp2y == null || x == null
        || y == null
      ) {
        break;
      }
      const nextCp1x = mode === "c" ? cursorX + cp1x : cp1x;
      const nextCp1y = mode === "c" ? cursorY + cp1y : cp1y;
      const nextCp2x = mode === "c" ? cursorX + cp2x : cp2x;
      const nextCp2y = mode === "c" ? cursorY + cp2y : cp2y;
      const nextX = mode === "c" ? cursorX + x : x;
      const nextY = mode === "c" ? cursorY + y : y;
      commands.push({
        type: "cubicTo",
        cp1x: nextCp1x,
        cp1y: nextCp1y,
        cp2x: nextCp2x,
        cp2y: nextCp2y,
        x: nextX,
        y: nextY,
      });
      cursorX = nextX;
      cursorY = nextY;
      lastCurveControlX = nextCp2x;
      lastCurveControlY = nextCp2y;
      lastCurveKind = "cubic";
      continue;
    }

    if (mode === "S" || mode === "s") {
      const cp2x = readNumber();
      const cp2y = readNumber();
      const x = readNumber();
      const y = readNumber();
      if (cp2x == null || cp2y == null || x == null || y == null) break;

      const reflectedCp1x = lastCurveKind === "cubic" && lastCurveControlX != null
        ? (2 * cursorX - lastCurveControlX)
        : cursorX;
      const reflectedCp1y = lastCurveKind === "cubic" && lastCurveControlY != null
        ? (2 * cursorY - lastCurveControlY)
        : cursorY;

      const nextCp2x = mode === "s" ? cursorX + cp2x : cp2x;
      const nextCp2y = mode === "s" ? cursorY + cp2y : cp2y;
      const nextX = mode === "s" ? cursorX + x : x;
      const nextY = mode === "s" ? cursorY + y : y;
      commands.push({
        type: "cubicTo",
        cp1x: reflectedCp1x,
        cp1y: reflectedCp1y,
        cp2x: nextCp2x,
        cp2y: nextCp2y,
        x: nextX,
        y: nextY,
      });
      cursorX = nextX;
      cursorY = nextY;
      lastCurveControlX = nextCp2x;
      lastCurveControlY = nextCp2y;
      lastCurveKind = "cubic";
      continue;
    }

    if (mode === "Q" || mode === "q") {
      const cpx = readNumber();
      const cpy = readNumber();
      const x = readNumber();
      const y = readNumber();
      if (cpx == null || cpy == null || x == null || y == null) break;
      const nextCpx = mode === "q" ? cursorX + cpx : cpx;
      const nextCpy = mode === "q" ? cursorY + cpy : cpy;
      const nextX = mode === "q" ? cursorX + x : x;
      const nextY = mode === "q" ? cursorY + y : y;
      commands.push({ type: "quadTo", cpx: nextCpx, cpy: nextCpy, x: nextX, y: nextY });
      cursorX = nextX;
      cursorY = nextY;
      lastCurveControlX = nextCpx;
      lastCurveControlY = nextCpy;
      lastCurveKind = "quad";
      continue;
    }

    if (mode === "T" || mode === "t") {
      const x = readNumber();
      const y = readNumber();
      if (x == null || y == null) break;

      const reflectedCpx: number = lastCurveKind === "quad" && lastCurveControlX != null
        ? (2 * cursorX - lastCurveControlX)
        : cursorX;
      const reflectedCpy: number = lastCurveKind === "quad" && lastCurveControlY != null
        ? (2 * cursorY - lastCurveControlY)
        : cursorY;

      const nextX = mode === "t" ? cursorX + x : x;
      const nextY = mode === "t" ? cursorY + y : y;
      commands.push({
        type: "quadTo",
        cpx: reflectedCpx,
        cpy: reflectedCpy,
        x: nextX,
        y: nextY,
      });
      cursorX = nextX;
      cursorY = nextY;
      lastCurveControlX = reflectedCpx;
      lastCurveControlY = reflectedCpy;
      lastCurveKind = "quad";
      continue;
    }

    if (mode === "A" || mode === "a") {
      const rx = readNumber();
      const ry = readNumber();
      const xAxisRotation = readNumber();
      const largeArcFlag = readNumber();
      const sweepFlag = readNumber();
      const x = readNumber();
      const y = readNumber();
      if (
        rx == null || ry == null || xAxisRotation == null || largeArcFlag == null
        || sweepFlag == null || x == null || y == null
      ) {
        break;
      }

      const normalizedLargeArc = normalizeArcFlag(largeArcFlag);
      const normalizedSweep = normalizeArcFlag(sweepFlag);

      const endX = mode === "a" ? cursorX + x : x;
      const endY = mode === "a" ? cursorY + y : y;

      const arcSegments = arcToCubicSegments({
        x1: cursorX,
        y1: cursorY,
        x2: endX,
        y2: endY,
        rx,
        ry,
        xAxisRotation,
        largeArc: normalizedLargeArc,
        sweep: normalizedSweep,
      });
      let lastArcCubic: CubicArcSegment | null = null;

      for (let segmentIndex = 0; segmentIndex < arcSegments.length; segmentIndex += 1) {
        const segment = arcSegments[segmentIndex]!;
        if (segment.type === "lineTo") {
          commands.push({ type: "lineTo", x: segment.x, y: segment.y });
          continue;
        }
        lastArcCubic = segment;
        commands.push({
          type: "cubicTo",
          cp1x: segment.cp1x,
          cp1y: segment.cp1y,
          cp2x: segment.cp2x,
          cp2y: segment.cp2y,
          x: segment.x,
          y: segment.y,
        });
      }

      cursorX = endX;
      cursorY = endY;
      lastCurveControlX = lastArcCubic?.cp2x ?? null;
      lastCurveControlY = lastArcCubic?.cp2y ?? null;
      lastCurveKind = lastArcCubic ? "cubic" : null;
      continue;
    }
  }

  return commands;
}

type CubicArcSegment = {
  type: "cubicTo";
  cp1x: number;
  cp1y: number;
  cp2x: number;
  cp2y: number;
  x: number;
  y: number;
};

type LineArcSegment = {
  type: "lineTo";
  x: number;
  y: number;
};

type ArcSegment = CubicArcSegment | LineArcSegment;

type ArcInput = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  rx: number;
  ry: number;
  xAxisRotation: number;
  largeArc: 0 | 1;
  sweep: 0 | 1;
};

function normalizeArcFlag(value: number): 0 | 1 {
  if (value === 0 || value === 1) return value;
  throw new Error(`SVG arc flag must be 0 or 1 (received ${value})`);
}

function clampCosine(value: number): number {
  if (value > 1) return 1;
  if (value < -1) return -1;
  return value;
}

function vectorAngle(ux: number, uy: number, vx: number, vy: number): number {
  const dot = ux * vx + uy * vy;
  const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
  if (len === 0) return 0;
  const cos = clampCosine(dot / len);
  const sign = (ux * vy - uy * vx) < 0 ? -1 : 1;
  return sign * Math.acos(cos);
}

function mapUnitPointToEllipse(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  rx: number,
  ry: number,
  phiRad: number,
): { x: number; y: number } {
  const cosPhi = Math.cos(phiRad);
  const sinPhi = Math.sin(phiRad);
  const ex = x * rx;
  const ey = y * ry;
  return {
    x: centerX + (cosPhi * ex - sinPhi * ey),
    y: centerY + (sinPhi * ex + cosPhi * ey),
  };
}

function approximateUnitArc(
  theta: number,
  delta: number,
): {
  cp1x: number;
  cp1y: number;
  cp2x: number;
  cp2y: number;
  x: number;
  y: number;
} {
  const alpha = (4 / 3) * Math.tan(delta / 4);
  const x1 = Math.cos(theta);
  const y1 = Math.sin(theta);
  const x2 = Math.cos(theta + delta);
  const y2 = Math.sin(theta + delta);

  return {
    cp1x: x1 - y1 * alpha,
    cp1y: y1 + x1 * alpha,
    cp2x: x2 + y2 * alpha,
    cp2y: y2 - x2 * alpha,
    x: x2,
    y: y2,
  };
}

function arcToCubicSegments(input: ArcInput): ArcSegment[] {
  const { x1, y1, x2, y2, xAxisRotation, largeArc, sweep } = input;
  let rx = Math.abs(input.rx);
  let ry = Math.abs(input.ry);

  if (!Number.isFinite(rx) || !Number.isFinite(ry)) {
    throw new Error("SVG arc radii must be finite numbers");
  }

  if ((rx === 0 || ry === 0) || (x1 === x2 && y1 === y2)) {
    return [{ type: "lineTo", x: x2, y: y2 }];
  }

  const phi = (xAxisRotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  const rxSq = rx * rx;
  const rySq = ry * ry;
  const x1pSq = x1p * x1p;
  const y1pSq = y1p * y1p;

  const lambda = (x1pSq / rxSq) + (y1pSq / rySq);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const rxSq2 = rx * rx;
  const rySq2 = ry * ry;

  const numerator = (rxSq2 * rySq2) - (rxSq2 * y1p * y1p) - (rySq2 * x1p * x1p);
  const denominator = (rxSq2 * y1p * y1p) + (rySq2 * x1p * x1p);
  const ratio = denominator === 0 ? 0 : Math.max(0, numerator / denominator);
  const sign = largeArc === sweep ? -1 : 1;
  const coef = sign * Math.sqrt(ratio);

  const cxp = coef * ((rx * y1p) / ry);
  const cyp = coef * (-(ry * x1p) / rx);

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const startUx = (x1p - cxp) / rx;
  const startUy = (y1p - cyp) / ry;
  const endUx = (-x1p - cxp) / rx;
  const endUy = (-y1p - cyp) / ry;

  let theta1 = vectorAngle(1, 0, startUx, startUy);
  let deltaTheta = vectorAngle(startUx, startUy, endUx, endUy);

  if (sweep === 0 && deltaTheta > 0) {
    deltaTheta -= Math.PI * 2;
  } else if (sweep === 1 && deltaTheta < 0) {
    deltaTheta += Math.PI * 2;
  }

  const segments = Math.max(1, Math.ceil(Math.abs(deltaTheta) / (Math.PI / 2)));
  const step = deltaTheta / segments;
  const out: ArcSegment[] = [];

  for (let index = 0; index < segments; index += 1) {
    const unitSegment = approximateUnitArc(theta1, step);
    const cp1 = mapUnitPointToEllipse(unitSegment.cp1x, unitSegment.cp1y, cx, cy, rx, ry, phi);
    const cp2 = mapUnitPointToEllipse(unitSegment.cp2x, unitSegment.cp2y, cx, cy, rx, ry, phi);
    const end = mapUnitPointToEllipse(unitSegment.x, unitSegment.y, cx, cy, rx, ry, phi);
    out.push({
      type: "cubicTo",
      cp1x: cp1.x,
      cp1y: cp1.y,
      cp2x: cp2.x,
      cp2y: cp2.y,
      x: end.x,
      y: end.y,
    });
    theta1 += step;
  }

  return out;
}

function getCachedSvgPath(raw: string): readonly SkiaPathCommand[] {
  const cached = parsedPathCache.get(raw);
  if (cached) return cached;

  const parsed = parseSvgPath(raw);
  if (parsedPathCache.size >= MAX_PATH_CACHE_ENTRIES) {
    const oldestKey = parsedPathCache.keys().next().value;
    if (oldestKey) {
      parsedPathCache.delete(oldestKey);
    }
  }
  parsedPathCache.set(raw, parsed);
  return parsed;
}

export function createPath(initial?: SkiaPathSource): SkiaPathObject {
  const builder = new PathBuilder();
  if (initial == null) {
    return builder;
  }
  if (typeof initial === "string") {
    const parsed = getCachedSvgPath(initial);
    for (let i = 0; i < parsed.length; i += 1) {
      const command = parsed[i]!;
      if (command.type === "moveTo") {
        builder.moveTo(command.x, command.y);
      } else if (command.type === "lineTo") {
        builder.lineTo(command.x, command.y);
      } else if (command.type === "quadTo") {
        builder.quadTo(command.cpx, command.cpy, command.x, command.y);
      } else if (command.type === "cubicTo") {
        builder.cubicTo(
          command.cp1x,
          command.cp1y,
          command.cp2x,
          command.cp2y,
          command.x,
          command.y,
        );
      } else {
        builder.close();
      }
    }
    return builder;
  }

  const commands = "commands" in initial ? initial.commands : initial;
  for (let i = 0; i < commands.length; i += 1) {
    const command = commands[i]!;
    if (command.type === "moveTo") {
      builder.moveTo(command.x, command.y);
    } else if (command.type === "lineTo") {
      builder.lineTo(command.x, command.y);
    } else if (command.type === "quadTo") {
      builder.quadTo(command.cpx, command.cpy, command.x, command.y);
    } else if (command.type === "cubicTo") {
      builder.cubicTo(
        command.cp1x,
        command.cp1y,
        command.cp2x,
        command.cp2y,
        command.x,
        command.y,
      );
    } else {
      builder.close();
    }
  }
  return builder;
}

export function resolvePathCommands(source: SkiaPathSource): readonly SkiaPathCommand[] {
  if (typeof source === "string") {
    return getCachedSvgPath(source);
  }
  if ("commands" in source) {
    return source.commands;
  }
  return source;
}
