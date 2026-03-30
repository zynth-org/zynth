# Markdown

High-performance native Markdown parsing and rendering for Zynth applications, providing full CommonMark compliance and GitHub Flavored Markdown (GFM) support.

`@zynth/markdown` leverages a native `cmark-gfm` back-end to provide granular, reactive markdown rendering. It abstracts:

- Native-speed parsing via JSI/Bridge
- Full GFM extension support (Tables, Task lists, Strikethrough)
- Customizable component mapping for bespoke design systems
- Efficient tree-to-component transformation using SolidJS primitives

## Basic usage

### Rendering Markdown

The `MarkdownRenderer` is the primary entry point for displaying markdown content. It automatically transforms raw strings into a layout of native Zynth components.

```tsx
import { MarkdownRenderer } from "@zynth/markdown";

function Article(props) {
  return (
    <MarkdownRenderer 
      content={props.markdownSource} 
      options={{
        extensions: {
          tasklist: true,
          strikethrough: true
        }
      }}
    />
  );
}
```

### Manual Parsing

If you need to manipulate the markdown tree before rendering, use `parseMarkdown` to get a structured AST of `MarkdownNode` objects.

```ts
import { parseMarkdown } from "@zynth/markdown";

const nodes = parseMarkdown("# Hello World\nThis is **Zynth**.");

// Result is an array of MarkdownNode objects
nodes.forEach(node => {
  if (node.type === "heading") {
    console.log("Heading level:", node.level);
  }
});
```

## Advanced

### Custom Component Mapping

You can override how specific markdown elements are rendered by providing a `components` map. This is useful for injecting custom styles or specialized internal components (like a custom code block with syntax highlighting).

```tsx
import { MarkdownRenderer, MarkdownComponentProps } from "@zynth/markdown";
import { Text, View } from "@zynth/components";

const MyHeading = (props: MarkdownComponentProps) => (
  <View style={{ borderBottomWidth: 2, borderBottomColor: "blue", marginBottom: 10 }}>
    <Text style={{ fontSize: 24, fontWeight: "800" }}>{props.children}</Text>
  </View>
);

function CustomMarkdown() {
  return (
    <MarkdownRenderer
      content="# Custom Heading\nStandard text here."
      components={{
        heading: MyHeading
      }}
    />
  );
}
```

### Parsing Options and Extensions

Zynth Markdown supports fine-tuning the parser's behavior via the `MarkdownParseOptions` object.

```ts
import { parseMarkdown } from "@zynth/markdown";

const doc = parseMarkdown("~~deleted~~", {
  extensions: {
    strikethrough: true,
    table: true,
    autolink: true,
    tasklist: true
  },
  smart: true,      // Convert straight quotes to curly, etc.
  hardbreaks: true, // Treat newlines as hard line breaks
  sourcepos: true   // Include source position data in nodes
});
```

## Special cases

- **Thematic Breaks**: Standard `---` or `***` markdown syntax renders as a `thematic_break` node, mapped to a `View` with a thin border by default.
- **Native Availability**: The package includes `isMarkdownAvailable()` to verify if the native parser bridge is initialized. If unavailable, the renderer falls back to displaying pre-formatted text to ensure content is always visible.
- **HTML Inlining**: While `html_inline` and `html_block` are supported in the parser, they render their raw literal content unless a custom component is mapping to those types.

## API Reference

### `MarkdownRenderer` Props

- `content: string`
  The raw markdown string to render.
- `options?: MarkdownParseOptions`
  Parsing configuration (extensions and parser flags).
- `components?: MarkdownComponentMap`
  Optional map of custom components to override default rendering behavior.

### Core Functions

- `parseMarkdown(content: string, options?: MarkdownParseOptions): MarkdownNode[]`
  Parses markdown and returns the top-level children nodes of the document.
- `parseMarkdownDocument(content: string, options?: MarkdownParseOptions): MarkdownNode`
  Returns the root `document` node containing all siblings and child nodes.
- `parseMarkdownRaw(content: string, options?: MarkdownParseOptions): string`
  Returns the raw JSON AST string directly from the native parser.
- `isMarkdownAvailable(): boolean`
  Returns `true` if the native back-end is properly linked and available.

### Types

- `MarkdownNode`
  - `type: MarkdownNodeType`
  - `children?: MarkdownNode[]`
  - `literal?: string` (for text, code, etc.)
  - `level?: number` (for headings)
  - `url?: string` (for links and images)
  - `listType?: "bullet" | "ordered"`
  - `align?: "left" | "center" | "right" | "none"` (for tables)

- `MarkdownParseOptions`
  - `extensions?: MarkdownExtensions`
  - `smart?: boolean`
  - `hardbreaks?: boolean`
  - `sourcepos?: boolean`
  - `safe?: boolean`

- `MarkdownExtensions`
  - `table: boolean`
  - `strikethrough: boolean`
  - `autolink: boolean`
  - `tasklist: boolean`
  - `tagfilter: boolean`
