import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type LoadEnvResult = {
  loadedPaths: string[];
};

function loadSkyhookEnv(): LoadEnvResult {
  const candidates: string[] = [];

  if (process.env.SKYHOOK_ENV_PATH) {
    candidates.push(process.env.SKYHOOK_ENV_PATH);
  }

  const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
  candidates.push(`${packageRoot}.env.local`);
  candidates.push(`${packageRoot}.env`);

  const loadedPaths: string[] = [];

  for (const path of candidates) {
    if (!path || loadedPaths.includes(path)) continue;
    if (!existsSync(path)) continue;

    const content = readFileSync(path, "utf8");
    applyEnvFile(content);
    loadedPaths.push(path);
  }

  return { loadedPaths };
}

function applyEnvFile(content: string) {
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equalsIndex = normalized.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = normalized.slice(0, equalsIndex).trim();
    const rawValue = normalized.slice(equalsIndex + 1).trim();
    if (!key) continue;
    if (process.env[key] !== undefined) continue;

    process.env[key] = decodeEnvValue(rawValue);
  }
}

function decodeEnvValue(value: string) {
  if (!value) return "";

  const first = value[0];
  const last = value[value.length - 1];

  if (first === '"' && last === '"') {
    return unescapeDoubleQuoted(value.slice(1, -1));
  }

  if (first === "'" && last === "'") {
    return value.slice(1, -1);
  }

  return value;
}

function unescapeDoubleQuoted(value: string) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

export { loadSkyhookEnv };
export type { LoadEnvResult };

