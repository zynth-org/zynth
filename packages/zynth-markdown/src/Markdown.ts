import { callNativeSync, isNativeAvailable } from "./native";
import type {
  MarkdownExtensions,
  MarkdownNode,
  MarkdownParseOptions,
  MarkdownTableAlignment,
} from "./types";

const OPTION_SOURCEPOS = 1 << 0;
const OPTION_HARDBREAKS = 1 << 1;
const OPTION_SMART = 1 << 2;
const OPTION_SAFE = 1 << 3;

const EXT_TABLE = 1 << 0;
const EXT_STRIKETHROUGH = 1 << 1;
const EXT_AUTOLINK = 1 << 2;
const EXT_TAGFILTER = 1 << 3;
const EXT_TASKLIST = 1 << 4;

const DEFAULT_EXTENSIONS: Required<MarkdownExtensions> = {
  table: true,
  strikethrough: true,
  autolink: true,
  tagfilter: true,
  tasklist: true,
};

function normalizeExtensions(
  extensions?: MarkdownExtensions
): Required<MarkdownExtensions> {
  if (!extensions) {
    return { ...DEFAULT_EXTENSIONS };
  }
  return {
    table: extensions.table ?? DEFAULT_EXTENSIONS.table,
    strikethrough: extensions.strikethrough ?? DEFAULT_EXTENSIONS.strikethrough,
    autolink: extensions.autolink ?? DEFAULT_EXTENSIONS.autolink,
    tagfilter: extensions.tagfilter ?? DEFAULT_EXTENSIONS.tagfilter,
    tasklist: extensions.tasklist ?? DEFAULT_EXTENSIONS.tasklist,
  };
}

function buildFlags(options?: MarkdownParseOptions): {
  options: number;
  extensions: number;
} {
  const resolved = options ?? {};
  let optionFlags = 0;
  if (resolved.sourcepos) optionFlags |= OPTION_SOURCEPOS;
  if (resolved.hardbreaks) optionFlags |= OPTION_HARDBREAKS;
  if (resolved.smart) optionFlags |= OPTION_SMART;
  if (resolved.safe) optionFlags |= OPTION_SAFE;

  const extensions = normalizeExtensions(resolved.extensions);
  let extensionFlags = 0;
  if (extensions.table) extensionFlags |= EXT_TABLE;
  if (extensions.strikethrough) extensionFlags |= EXT_STRIKETHROUGH;
  if (extensions.autolink) extensionFlags |= EXT_AUTOLINK;
  if (extensions.tagfilter) extensionFlags |= EXT_TAGFILTER;
  if (extensions.tasklist) extensionFlags |= EXT_TASKLIST;

  return { options: optionFlags, extensions: extensionFlags };
}

function createFallbackDocument(content: string): MarkdownNode {
  if (!content) {
    return { type: "document", children: [] };
  }
  return {
    type: "document",
    children: [
      {
        type: "paragraph",
        children: [{ type: "text", literal: content }],
      },
    ],
  };
}

function normalizeAlignment(value: unknown): MarkdownTableAlignment | undefined {
  if (value === "left" || value === "center" || value === "right") {
    return value;
  }
  if (value === "none") {
    return "none";
  }
  return undefined;
}

function normalizeNode(node: MarkdownNode): MarkdownNode {
  if (node.align) {
    node.align = normalizeAlignment(node.align) ?? "none";
  }
  if (node.children) {
    node.children = node.children.map(normalizeNode);
  }
  return node;
}

export function parseMarkdownDocument(
  content: string,
  options?: MarkdownParseOptions
): MarkdownNode {
  if (!isNativeAvailable()) {
    return createFallbackDocument(content);
  }

  const flags = buildFlags(options);
  const raw = callNativeSync<string>("parse", {
    content: content ?? "",
    options: flags.options,
    extensions: flags.extensions,
  });

  if (typeof raw !== "string") {
    throw new Error("Markdown parse failed: invalid response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Markdown parse failed: ${message}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Markdown parse failed: malformed document");
  }

  return normalizeNode(parsed as MarkdownNode);
}

export function parseMarkdown(
  content: string,
  options?: MarkdownParseOptions
): MarkdownNode[] {
  const doc = parseMarkdownDocument(content, options);
  return Array.isArray(doc.children) ? doc.children : [];
}

export function parseMarkdownRaw(
  content: string,
  options?: MarkdownParseOptions
): string {
  if (!isNativeAvailable()) {
    return JSON.stringify(createFallbackDocument(content));
  }

  const flags = buildFlags(options);
  const raw = callNativeSync<string>("parse", {
    content: content ?? "",
    options: flags.options,
    extensions: flags.extensions,
  });

  if (typeof raw !== "string") {
    throw new Error("Markdown parse failed: invalid response");
  }

  return raw;
}

export function isMarkdownAvailable(): boolean {
  return isNativeAvailable();
}
