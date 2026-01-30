import sourceMap from "source-map-js";

export type StackFrame = {
  file: string;
  method: string;
  lineNumber: number;
  column: number | null;
};

type ParsedLocation = {
  file: string;
  lineNumber: number | null;
  column: number | null;
};

function parseLocation(location: string): ParsedLocation {
  let loc = location.trim();
  if (loc.endsWith(")")) loc = loc.slice(0, -1);

  const match = loc.match(/:(\d+)(?::(\d+))?$/);
  if (!match || match.index == null) {
    return { file: loc, lineNumber: null, column: null };
  }

  const lineNumber = parseInt(match[1], 10);
  const column = match[2] ? parseInt(match[2], 10) : null;
  const file = loc.slice(0, match.index);

  return { file, lineNumber, column };
}

function parseStack(stack: string): StackFrame[] {
  const lines = stack.split("\n");
  const frames: StackFrame[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("at ")) continue;
    const body = trimmed.slice(3).trim();
    if (body.length === 0) continue;

    let method = "<unknown>";
    let location = body;

    const parenStart = body.indexOf(" (");
    if (parenStart !== -1 && body.endsWith(")")) {
      method = body.slice(0, parenStart).trim() || "<unknown>";
      location = body.slice(parenStart + 2, -1).trim();
    }

    const parsed = parseLocation(location);
    if (parsed.lineNumber == null) continue;

    frames.push({
      method,
      file: parsed.file,
      lineNumber: parsed.lineNumber,
      column: parsed.column,
    });
  }
  return frames;
}

const mapCache = new Map<string, any>();

function resolveOriginalPosition(
  consumer: any,
  frame: StackFrame,
): {
  source: string | null;
  line: number | null;
  column: number | null;
  name?: string | null;
} {
  const line = frame.lineNumber;
  const colInput = frame.column ?? 1;
  const colZero = Math.max(0, colInput - 1);

  const tryPositions = [
    {
      line,
      column: colZero,
      bias: sourceMap.SourceMapConsumer.GREATEST_LOWER_BOUND,
    },
    {
      line,
      column: colInput,
      bias: sourceMap.SourceMapConsumer.GREATEST_LOWER_BOUND,
    },
    {
      line,
      column: colZero,
      bias: sourceMap.SourceMapConsumer.LEAST_UPPER_BOUND,
    },
    {
      line,
      column: colInput,
      bias: sourceMap.SourceMapConsumer.LEAST_UPPER_BOUND,
    },
  ];

  for (const pos of tryPositions) {
    const original = consumer.originalPositionFor(pos);
    if (original && original.source) {
      return original;
    }
  }

  return { source: null, line: null, column: null, name: null };
}

function findClosestMapping(
  consumer: any,
  frame: StackFrame,
): {
  source: string | null;
  line: number | null;
  column: number | null;
  name?: string | null;
} {
  const targetLine = frame.lineNumber;
  const targetCol = frame.column ?? 0;
  let best: {
    delta: number;
    source: string | null;
    line: number | null;
    column: number | null;
    name?: string | null;
  } | null = null;

  try {
    consumer.eachMapping(
      (m: any) => {
        if (m.generatedLine !== targetLine) return;
        const delta = Math.abs(m.generatedColumn - targetCol);
        if (!best || delta < best.delta) {
          best = {
            delta,
            source: m.source ?? null,
            line: m.originalLine ?? null,
            column: m.originalColumn ?? null,
            name: m.name ?? null,
          };
        }
      },
      null,
      sourceMap.SourceMapConsumer.GENERATED_ORDER,
    );
  } catch (error) {
    console.warn("[ZynthSymbolicator] Failed to scan mappings", error);
  }

  return best ?? { source: null, line: null, column: null, name: null };
}

async function fetchMap(bundleUrl: string): Promise<any> {
  // If bundle is main.js, map is main.js.map
  // If bundleUrl has query params, strip them for map URL logic?
  // rsbuild usually serves /main.js and /main.js.map

  // Clean URL
  const urlObj = new URL(bundleUrl);
  urlObj.pathname = urlObj.pathname + ".map";
  const mapUrl = urlObj.toString();
  if (mapCache.has(mapUrl)) {
    return mapCache.get(mapUrl);
  }

  try {
    const res = await fetch(mapUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch map: ${res.status}`);
    }
    const json = await res.json();
    mapCache.set(mapUrl, json);
    return json;
  } catch (e) {
    console.warn("[ZynthSymbolicator] Failed to fetch source map", e);
    return null;
  }
}

export async function symbolicateStackTrace(stack: string): Promise<string> {
  const frames = parseStack(stack);
  if (frames.length === 0) return stack;

  // Assume all frames come from the same bundle for now (common in dev)
  // or cache consumers by file.
  const consumers = new Map<string, any>();

  const symbolicatedFrames: string[] = [];

  for (const frame of frames) {
    // Only try to symbolicate http(s) urls (dev server), ignore local files or [native code]
    if (!frame.file.startsWith("http")) {
      symbolicatedFrames.push(
        `at ${frame.method} (${frame.file}:${frame.lineNumber}:${frame.column})`,
      );
      continue;
    }

    let consumer = consumers.get(frame.file);
    if (!consumer) {
      const mapData = await fetchMap(frame.file);
      if (mapData) {
        try {
          consumer = new sourceMap.SourceMapConsumer(mapData);
          consumers.set(frame.file, consumer);
        } catch (e) {
          console.warn("[ZynthSymbolicator] Failed to create consumer", e);
        }
      }
    }

    if (consumer) {
      let original: {
        source: string | null;
        line: number | null;
        column: number | null;
        name?: string | null;
      };
      try {
        original = resolveOriginalPosition(consumer, frame);
      } catch (error) {
        original = { source: null, line: null, column: null, name: null };
      }
      if (!original.source) {
        original = findClosestMapping(consumer, frame);
      }
      if (original.source) {
        const name = original.name || frame.method;
        const source = original.source;
        symbolicatedFrames.push(
          `at ${name} (${source}:${original.line}:${original.column})`,
        );
        continue;
      }
    }

    // Fallback
    symbolicatedFrames.push(
      `at ${frame.method} (${frame.file}:${frame.lineNumber}:${frame.column})`,
    );
  }

  return symbolicatedFrames.join("\n");
}
