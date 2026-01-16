import type { Component, JSX } from "solid-js";
import { For, createMemo } from "solid-js";
import { Text, View } from "@zynth/components";
import { parseMarkdown } from "./Markdown";
import type { MarkdownNode, MarkdownParseOptions } from "./types";

export type MarkdownComponentProps = {
  node: MarkdownNode;
  children?: JSX.Element;
};

export type MarkdownComponentMap = Partial<
  Record<MarkdownNode["type"], Component<MarkdownComponentProps>>
>;

export type MarkdownRendererProps = {
  content: string;
  options?: MarkdownParseOptions;
  components?: MarkdownComponentMap;
};

const headingSizes: Record<number, number> = {
  1: 28,
  2: 24,
  3: 20,
  4: 18,
  5: 16,
  6: 14,
};

function renderInlineText(children: JSX.Element): JSX.Element {
  return <Text>{children}</Text>;
}

export function MarkdownRenderer(props: MarkdownRendererProps): JSX.Element {
  const nodes = createMemo(() => parseMarkdown(props.content, props.options));

  const renderChildren = (node: MarkdownNode) => {
    const children = node.children ?? [];
    return <For each={children}>{renderNode}</For>;
  };

  const renderListItem = (
    node: MarkdownNode,
    ordered: boolean,
    index: number
  ): JSX.Element => {
    const checkbox =
      typeof node.checked === "boolean" ? (node.checked ? "[x]" : "[ ]") : null;
    const prefix = ordered ? `${index}.` : "•";
    return (
      <View style={{ flexDirection: "row", marginBottom: 6 }}>
        <Text style={{ width: 28 }}>{checkbox ?? prefix}</Text>
        <View style={{ flex: 1 }}>{renderChildren(node)}</View>
      </View>
    );
  };

  const renderNode = (node: MarkdownNode): JSX.Element => {
    const custom = props.components?.[node.type];
    const children = renderChildren(node);
    if (custom) {
      const Custom = custom;
      return <Custom node={node}>{children}</Custom>;
    }

    switch (node.type) {
      case "text":
        return node.literal ?? "";
      case "emphasis":
        return (
          <Text style={{ fontStyle: "italic" }}>
            {children}
          </Text>
        );
      case "strong":
        return (
          <Text style={{ fontWeight: "700" }}>
            {children}
          </Text>
        );
      case "strikethrough":
        return (
          <Text style={{ textDecorationLine: "line-through" }}>
            {children}
          </Text>
        );
      case "code":
        return (
          <Text
            style={{
              fontFamily: "monospace",
              backgroundColor: "#f3f4f6",
            }}
          >
            {node.literal ?? ""}
          </Text>
        );
      case "code_block":
        return (
          <Text
            style={{
              fontFamily: "monospace",
              backgroundColor: "#f3f4f6",
              padding: 12,
              borderRadius: 6,
              marginBottom: 12,
            }}
          >
            {node.literal ?? ""}
          </Text>
        );
      case "paragraph":
        return (
          <Text style={{ fontSize: 16, lineHeight: 22, marginBottom: 10 }}>
            {children}
          </Text>
        );
      case "heading": {
        const level = node.level ?? 1;
        const fontSize = headingSizes[level] ?? 16;
        return (
          <Text
            style={{
              fontSize,
              fontWeight: "700",
              marginBottom: 12,
              marginTop: level <= 2 ? 12 : 8,
            }}
          >
            {children}
          </Text>
        );
      }
      case "blockquote":
        return (
          <View
            style={{
              borderLeftWidth: 3,
              borderLeftColor: "#d1d5db",
              paddingLeft: 12,
              marginBottom: 10,
            }}
          >
            {children}
          </View>
        );
      case "list": {
        const ordered = node.listType === "ordered";
        const start = node.listStart ?? 1;
        const items = node.children ?? [];
        return (
          <View style={{ marginBottom: 12 }}>
            <For each={items}>
              {(child, index) =>
                renderListItem(child, ordered, start + index())}
            </For>
          </View>
        );
      }
      case "item":
        return renderListItem(node, false, 1);
      case "link":
        return (
          <Text style={{ color: "#2563eb", textDecorationLine: "underline" }}>
            {children}
          </Text>
        );
      case "image":
        return (
          <Text style={{ color: "#6b7280" }}>
            {node.title ?? node.url ?? "[image]"}
          </Text>
        );
      case "thematic_break":
        return (
          <View
            style={{
              height: 1,
              backgroundColor: "#e5e7eb",
              marginVertical: 12,
            }}
          />
        );
      case "softbreak":
      case "linebreak":
        return "\n";
      case "html_inline":
      case "html_block":
        return node.literal ?? "";
      case "table":
        return (
          <View
            style={{
              borderWidth: 1,
              borderColor: "#e5e7eb",
              marginBottom: 12,
            }}
          >
            {children}
          </View>
        );
      case "table_row":
        const rowStyle = node.header
          ? { backgroundColor: "#f8fafc" }
          : undefined;
        return (
          <View
            style={{
              flexDirection: "row",
              borderBottomWidth: 1,
              borderBottomColor: "#e5e7eb",
              ...rowStyle,
            }}
          >
            {children}
          </View>
        );
      case "table_cell":
        const alignItems =
          node.align === "right"
            ? "flex-end"
            : node.align === "center"
              ? "center"
              : "flex-start";
        return (
          <View
            style={{
              flex: 1,
              padding: 8,
              borderRightWidth: 1,
              borderRightColor: "#e5e7eb",
              alignItems,
            }}
          >
            {children}
          </View>
        );
      case "document":
        return <View>{children}</View>;
      default:
        return renderInlineText(children);
    }
  };

  return (
    <View>
      <For each={nodes()}>{renderNode}</For>
    </View>
  );
}
