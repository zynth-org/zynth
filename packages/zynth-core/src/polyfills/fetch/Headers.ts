import type { HeaderInit } from "./types";
import { normalizeHeaderName } from "./utils";

export class Headers {
  private readonly map: Map<string, string>;

  constructor(init?: HeaderInit) {
    this.map = new Map();
    if (init) {
      const normalized = normalizeHeaders(init);
      for (const [key, value] of Object.entries(normalized)) {
        this.set(key, value);
      }
    }
  }

  append(name: string, value: string): void {
    const key = normalizeHeaderName(name);
    const existing = this.map.get(key);
    if (existing) {
      this.map.set(key, `${existing}, ${String(value)}`);
    } else {
      this.map.set(key, String(value));
    }
  }

  delete(name: string): void {
    this.map.delete(normalizeHeaderName(name));
  }

  get(name: string): string | null {
    const value = this.map.get(normalizeHeaderName(name));
    return value ?? null;
  }

  has(name: string): boolean {
    return this.map.has(normalizeHeaderName(name));
  }

  set(name: string, value: string): void {
    this.map.set(normalizeHeaderName(name), String(value));
  }

  forEach(callback: (value: string, name: string) => void): void {
    for (const [name, value] of this.map.entries()) {
      callback(value, name);
    }
  }

  entries(): IterableIterator<[string, string]> {
    return this.map.entries();
  }

  keys(): IterableIterator<string> {
    return this.map.keys();
  }

  values(): IterableIterator<string> {
    return this.map.values();
  }

  toJSON(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of this.map.entries()) {
      out[key] = value;
    }
    return out;
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries();
  }

  clone(): Headers {
    return new Headers(this);
  }
}

function normalizeHeaders(init?: HeaderInit): Record<string, string> {
  if (!init) return {};
  if (init instanceof Headers) {
    return init.toJSON();
  }
  if (Array.isArray(init)) {
    const map: Record<string, string> = {};
    for (const [key, value] of init) {
      map[String(key)] = String(value);
    }
    return map;
  }
  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(init)) {
    map[String(key)] = String(value);
  }
  return map;
}
