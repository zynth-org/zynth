import type { SkiaPathCommand, SkiaPathObject, SkiaPathSource } from "./types";

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

  const tokenRegex = /([MLZmlz])|(-?\d*\.?\d+(?:e[+-]?\d+)?)/g;
  const tokens: string[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = tokenRegex.exec(normalized)) != null) {
    tokens.push(match[0]!);
  }

  const commands: SkiaPathCommand[] = [];
  let index = 0;
  let cursorX = 0;
  let cursorY = 0;
  let startX = 0;
  let startY = 0;
  let mode: "M" | "L" | "m" | "l" | null = null;

  const readNumber = (): number | null => {
    const token = tokens[index];
    if (token == null) return null;
    if (/^[MLZmlz]$/.test(token)) return null;
    index += 1;
    const numeric = Number(token);
    return Number.isFinite(numeric) ? numeric : null;
  };

  while (index < tokens.length) {
    const token = tokens[index]!;
    if (/^[MLZmlz]$/.test(token)) {
      const command = token as "M" | "L" | "m" | "l" | "Z" | "z";
      index += 1;
      if (command === "Z" || command === "z") {
        commands.push({ type: "close" });
        cursorX = startX;
        cursorY = startY;
        continue;
      }
      mode = command === "M" || command === "L" || command === "m" || command === "l"
        ? command
        : mode;
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
      continue;
    }
  }

  return commands;
}

export function createPath(initial?: SkiaPathSource): SkiaPathObject {
  const builder = new PathBuilder();
  if (initial == null) {
    return builder;
  }
  if (typeof initial === "string") {
    const parsed = parseSvgPath(initial);
    for (let i = 0; i < parsed.length; i += 1) {
      const command = parsed[i]!;
      if (command.type === "moveTo") {
        builder.moveTo(command.x, command.y);
      } else if (command.type === "lineTo") {
        builder.lineTo(command.x, command.y);
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
    } else {
      builder.close();
    }
  }
  return builder;
}

export function resolvePathCommands(source: SkiaPathSource): readonly SkiaPathCommand[] {
  if (typeof source === "string") {
    return parseSvgPath(source);
  }
  if ("commands" in source) {
    return source.commands;
  }
  return source;
}
