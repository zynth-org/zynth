# @zynth/markdown

Ultra-fast native Markdown parsing for Zynth apps using cmark-gfm, exposed through the Zynth native bridge.

## Features

- **cmark-gfm parsing**: Native parser for GitHub Flavored Markdown.
- **Synchronous API**: `parseMarkdown()` returns an AST immediately.
- **Renderer helper**: `MarkdownRenderer` maps nodes to Zynth primitives.

## Installation

```tsx
import { parseMarkdown, MarkdownRenderer } from "@zynth/markdown";
```

## Native Dependency

The cmark-gfm source is provided as a git submodule. Initialize it once with:

```bash
yarn workspace @zynth/markdown setup:cmark-gfm
```

This also installs required headers into the submodule source tree.

## Usage

### Parse Markdown

```ts
import { parseMarkdown } from "@zynth/markdown";

const nodes = parseMarkdown("# Hello\n\n**Bold** text");
```

### Render Markdown

```tsx
import { MarkdownRenderer } from "@zynth/markdown";

export function Article(props: { content: string }) {
  return <MarkdownRenderer content={props.content} />;
}
```

### Custom Components

```tsx
import type { MarkdownComponentMap } from "@zynth/markdown";
import { Text, View } from "@zynth/components";

const components: MarkdownComponentMap = {
  heading: (props) => (
    <Text style={{ fontSize: 24, fontWeight: "700" }}>{props.children}</Text>
  ),
  blockquote: (props) => (
    <View style={{ borderLeftWidth: 3, borderLeftColor: "#ddd", paddingLeft: 12 }}>
      {props.children}
    </View>
  ),
};
```

## API

### `parseMarkdown(content, options?)`

Returns an array of Markdown nodes. Falls back to a plain-text document on non-native platforms.

### `parseMarkdownDocument(content, options?)`

Returns the root document node.

### `parseMarkdownRaw(content, options?)`

Returns the raw JSON string produced by the native parser.

### `MarkdownRenderer`

A convenience renderer that maps Markdown nodes to Zynth primitives.

## Options

```ts
type MarkdownParseOptions = {
  sourcepos?: boolean;
  hardbreaks?: boolean;
  smart?: boolean;
  safe?: boolean;
  extensions?: {
    table?: boolean;
    strikethrough?: boolean;
    autolink?: boolean;
    tagfilter?: boolean;
    tasklist?: boolean;
  };
};
```

## Notes

- Code blocks render as plain text; syntax highlighting can be added later.
- Tables are composed using `View` primitives and basic borders.
