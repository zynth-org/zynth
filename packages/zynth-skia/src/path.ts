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
    | "M" | "L" | "H" | "V" | "C" | "S" | "Q" | "T"
    | "m" | "l" | "h" | "v" | "c" | "s" | "q" | "t"
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
      if (command === "A" || command === "a") {
        throw new Error("SVG path arc commands (A/a) are not supported yet");
      }
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
  }

  return commands;
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
