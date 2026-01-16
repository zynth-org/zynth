export type MarkdownNodeType =
  | "document"
  | "paragraph"
  | "text"
  | "emphasis"
  | "strong"
  | "link"
  | "image"
  | "heading"
  | "blockquote"
  | "list"
  | "item"
  | "code"
  | "code_block"
  | "html_inline"
  | "html_block"
  | "thematic_break"
  | "softbreak"
  | "linebreak"
  | "table"
  | "table_row"
  | "table_cell"
  | "strikethrough";

export type MarkdownTableAlignment = "left" | "center" | "right" | "none";

export type MarkdownSourcePosition = {
  start: { line: number; column: number };
  end: { line: number; column: number };
};

export type MarkdownNode = {
  type: MarkdownNodeType;
  literal?: string;
  url?: string;
  title?: string;
  level?: number;
  listType?: "bullet" | "ordered";
  listStart?: number;
  listTight?: boolean;
  checked?: boolean;
  info?: string;
  align?: MarkdownTableAlignment;
  header?: boolean;
  sourcepos?: MarkdownSourcePosition;
  children?: MarkdownNode[];
};

export type MarkdownExtensions = {
  table?: boolean;
  strikethrough?: boolean;
  autolink?: boolean;
  tagfilter?: boolean;
  tasklist?: boolean;
};

export type MarkdownParseOptions = {
  sourcepos?: boolean;
  hardbreaks?: boolean;
  smart?: boolean;
  safe?: boolean;
  extensions?: MarkdownExtensions;
};

export type MarkdownParseResult = {
  nodes: MarkdownNode[];
};
