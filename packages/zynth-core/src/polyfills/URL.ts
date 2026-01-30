/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import { URLSearchParams } from "./URLSearchParams";
import { Blob } from "./Blob";

// https://tools.ietf.org/html/rfc3986#appendix-B
const URL_REGEX = /^([^:/?#]+:)?(?:\/\/((?:([^/?#@]*)@)?([^/?#:]*)(?::(\d*))?))?([^?#]*)(\?[^#]*)?(#.*)?$/;

function parseURL(url: string) {
  const match = url.match(URL_REGEX);
  if (!match) return null;
  return {
    protocol: match[1] || "",
    host: match[2] || "",
    userinfo: match[3] || "",
    hostname: match[4] || "",
    port: match[5] || "",
    pathname: match[6] || "/",
    search: match[7] || "",
    hash: match[8] || "",
  };
}

function resolvePath(path: string, base: string) {
  if (path.startsWith("/")) return path;
  const baseParts = base.split("/");
  baseParts.pop(); // remove last segment
  const pathParts = path.split("/");
  for (const part of pathParts) {
    if (part === "..") {
      if (baseParts.length > 1) baseParts.pop();
    } else if (part !== ".") {
      baseParts.push(part);
    }
  }
  return baseParts.join("/");
}

class URLPolyfill {
  private _protocol = "";
  private _username = "";
  private _password = "";
  private _hostname = "";
  private _port = "";
  private _pathname = "/";
  private _hash = "";
  private _searchParams: any;

  constructor(url: string, base?: string | URLPolyfill) {
    let parsedBase = null;
    if (base) {
      parsedBase =
        base instanceof URLPolyfill ? base : new URLPolyfill(base.toString());
    }

    const parsed = parseURL(url);
    if (!parsed) throw new TypeError(`Invalid URL: ${url}`);

    if (parsed.protocol) {
      this._protocol = parsed.protocol;
      this._hostname = parsed.hostname;
      this._port = parsed.port;
      this._pathname = parsed.pathname;
      if (parsed.userinfo) {
        const [u, p] = parsed.userinfo.split(":");
        this._username = u;
        this._password = p || "";
      }
    } else if (parsedBase) {
      this._protocol = parsedBase.protocol;
      this._username = parsedBase.username;
      this._password = parsedBase.password;
      this._hostname = parsedBase.hostname;
      this._port = parsedBase.port;
      if (url.startsWith("//")) {
        const subParsed = parseURL("http:" + url); // hack to parse //
        if (subParsed) {
          this._hostname = subParsed.hostname;
          this._port = subParsed.port;
          this._pathname = subParsed.pathname;
        }
      } else {
        this._pathname = resolvePath(parsed.pathname, parsedBase.pathname);
      }
    } else {
      throw new TypeError(`Invalid URL: ${url}`);
    }

    this._hash = parsed.hash;
    this._searchParams = new URLSearchParams(parsed.search);
  }

  get protocol() {
    return this._protocol;
  }
  set protocol(value: string) {
    this._protocol = value.endsWith(":") ? value : value + ":";
  }

  get username() {
    return this._username;
  }
  set username(value: string) {
    this._username = value;
  }

  get password() {
    return this._password;
  }
  set password(value: string) {
    this._password = value;
  }

  get hostname() {
    return this._hostname;
  }
  set hostname(value: string) {
    this._hostname = value;
  }

  get port() {
    return this._port;
  }
  set port(value: string) {
    this._port = value;
  }

  get pathname() {
    return this._pathname;
  }
  set pathname(value: string) {
    this._pathname = value.startsWith("/") ? value : "/" + value;
  }

  get search() {
    const s = this._searchParams.toString();
    return s ? "?" + s : "";
  }
  set search(value: string) {
    this._searchParams = new URLSearchParams(value);
  }

  get searchParams() {
    return this._searchParams;
  }

  get hash() {
    return this._hash;
  }
  set hash(value: string) {
    this._hash = value.startsWith("#") ? value : "#" + value;
  }

  get host() {
    return this._port ? `${this._hostname}:${this._port}` : this._hostname;
  }
  set host(value: string) {
    const [h, p] = value.split(":");
    this._hostname = h;
    this._port = p || "";
  }

  get hostname_with_port() {
    return this.host;
  }

  get origin() {
    return `${this._protocol}//${this.host}`;
  }

  get href() {
    return this.toString();
  }
  set href(value: string) {
    const next = new URLPolyfill(value);
    this._protocol = next.protocol;
    this._username = next.username;
    this._password = next.password;
    this._hostname = next.hostname;
    this._port = next.port;
    this._pathname = next.pathname;
    this._hash = next.hash;
    this._searchParams = next.searchParams;
  }

  toString() {
    let auth = "";
    if (this._username) {
      auth = this._username;
      if (this._password) {
        auth += ":" + this._password;
      }
      auth += "@";
    }
    return (
      this._protocol +
      "//" +
      auth +
      this.host +
      this._pathname +
      this.search +
      this._hash
    );
  }

  toJSON() {
    return this.toString();
  }

  static createObjectURL(blob: Blob): string {
    // For now, we don't have a native blob provider, so we can't really create a usable URL
    // that works across the bridge. But we can return a placeholder or a data URL if small.
    // React Native uses a custom scheme.
    throw new Error("URL.createObjectURL is not implemented yet in Zynth");
  }

  static revokeObjectURL(url: string): void {
    // No-op
  }
}

const globalObject =
  typeof globalThis !== "undefined"
    ? (globalThis as any)
    : typeof window !== "undefined"
    ? (window as any)
    : typeof self !== "undefined"
    ? (self as any)
    : ({} as any);

if (globalObject && !globalObject.URL) {
  // console.log("[ZynthCore] Polyfilling URL");
  globalObject.URL = URLPolyfill;
}

export { URLPolyfill as URL };
