#include "zynth_markdown.h"

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#include "cmark-gfm.h"
#include "cmark-gfm-core-extensions.h"
#include "strikethrough.h"
#include "table.h"

namespace {

void appendEscaped(std::string &out, const char *value) {
  out.push_back('"');
  if (value) {
    for (const unsigned char *p =
           reinterpret_cast<const unsigned char *>(value);
         *p;
         ++p) {
      switch (*p) {
        case '\\':
          out.append("\\\\");
          break;
        case '"':
          out.append("\\\"");
          break;
        case '\b':
          out.append("\\b");
          break;
        case '\f':
          out.append("\\f");
          break;
        case '\n':
          out.append("\\n");
          break;
        case '\r':
          out.append("\\r");
          break;
        case '\t':
          out.append("\\t");
          break;
        default:
          if (*p < 0x20) {
            char buf[7];
            snprintf(buf, sizeof(buf), "\\u%04x", *p);
            out.append(buf);
          } else {
            out.push_back(static_cast<char>(*p));
          }
      }
    }
  }
  out.push_back('"');
}

void appendKey(std::string &out, const char *key, bool &hasField) {
  if (hasField) {
    out.push_back(',');
  }
  hasField = true;
  out.push_back('"');
  out.append(key);
  out.append("\":");
}

void appendStringField(
  std::string &out,
  const char *key,
  const char *value,
  bool &hasField
) {
  if (!value) {
    return;
  }
  appendKey(out, key, hasField);
  appendEscaped(out, value);
}

void appendBoolField(std::string &out, const char *key, bool value, bool &hasField) {
  appendKey(out, key, hasField);
  out.append(value ? "true" : "false");
}

void appendNumberField(
  std::string &out,
  const char *key,
  int value,
  bool &hasField
) {
  appendKey(out, key, hasField);
  out.append(std::to_string(value));
}

const char *nodeTypeToString(cmark_node *node) {
  if (!node) {
    return "document";
  }

  const char *typeString = cmark_node_get_type_string(node);
  if (typeString && std::strcmp(typeString, "tasklist") == 0) {
    return "item";
  }
  if (typeString && std::strcmp(typeString, "strikethrough") == 0) {
    return "strikethrough";
  }

  cmark_node_type type = cmark_node_get_type(node);
  switch (type) {
    case CMARK_NODE_DOCUMENT:
      return "document";
    case CMARK_NODE_PARAGRAPH:
      return "paragraph";
    case CMARK_NODE_TEXT:
      return "text";
    case CMARK_NODE_EMPH:
      return "emphasis";
    case CMARK_NODE_STRONG:
      return "strong";
    case CMARK_NODE_LINK:
      return "link";
    case CMARK_NODE_IMAGE:
      return "image";
    case CMARK_NODE_HEADING:
      return "heading";
    case CMARK_NODE_BLOCK_QUOTE:
      return "blockquote";
    case CMARK_NODE_LIST:
      return "list";
    case CMARK_NODE_ITEM:
      return "item";
    case CMARK_NODE_CODE:
      return "code";
    case CMARK_NODE_CODE_BLOCK:
      return "code_block";
    case CMARK_NODE_HTML_INLINE:
      return "html_inline";
    case CMARK_NODE_HTML_BLOCK:
      return "html_block";
    case CMARK_NODE_THEMATIC_BREAK:
      return "thematic_break";
    case CMARK_NODE_SOFTBREAK:
      return "softbreak";
    case CMARK_NODE_LINEBREAK:
      return "linebreak";
    default:
      break;
  }

  if (type == CMARK_NODE_TABLE) return "table";
  if (type == CMARK_NODE_TABLE_ROW) return "table_row";
  if (type == CMARK_NODE_TABLE_CELL) return "table_cell";

  return typeString ? typeString : "document";
}

const char *alignmentToString(uint8_t value) {
  switch (value) {
    case 'l':
      return "left";
    case 'c':
      return "center";
    case 'r':
      return "right";
    default:
      return "none";
  }
}

void appendSourcepos(std::string &out, cmark_node *node, bool &hasField) {
  int startLine = cmark_node_get_start_line(node);
  int startColumn = cmark_node_get_start_column(node);
  int endLine = cmark_node_get_end_line(node);
  int endColumn = cmark_node_get_end_column(node);
  if (startLine == 0 && startColumn == 0 && endLine == 0 && endColumn == 0) {
    return;
  }

  appendKey(out, "sourcepos", hasField);
  out.append("{\"start\":{\"line\":");
  out.append(std::to_string(startLine));
  out.append(",\"column\":");
  out.append(std::to_string(startColumn));
  out.append("},\"end\":{\"line\":");
  out.append(std::to_string(endLine));
  out.append(",\"column\":");
  out.append(std::to_string(endColumn));
  out.append("}}");
}

void appendNode(std::string &out, cmark_node *node, bool includeSourcepos) {
  bool hasField = false;
  out.push_back('{');

  appendKey(out, "type", hasField);
  appendEscaped(out, nodeTypeToString(node));

  const char *literal = cmark_node_get_literal(node);
  const char *nodeType = cmark_node_get_type_string(node);
  cmark_node_type type = cmark_node_get_type(node);

  if (literal && (type == CMARK_NODE_TEXT || type == CMARK_NODE_CODE ||
                  type == CMARK_NODE_HTML_INLINE || type == CMARK_NODE_HTML_BLOCK ||
                  type == CMARK_NODE_CODE_BLOCK)) {
    appendStringField(out, "literal", literal, hasField);
  }

  if (type == CMARK_NODE_CODE_BLOCK) {
    const char *info = cmark_node_get_fence_info(node);
    if (info && info[0] != '\0') {
      appendStringField(out, "info", info, hasField);
    }
  }

  if (type == CMARK_NODE_HEADING) {
    appendNumberField(out, "level", cmark_node_get_heading_level(node), hasField);
  }

  if (type == CMARK_NODE_LINK || type == CMARK_NODE_IMAGE) {
    appendStringField(out, "url", cmark_node_get_url(node), hasField);
    appendStringField(out, "title", cmark_node_get_title(node), hasField);
  }

  if (type == CMARK_NODE_LIST) {
    cmark_list_type listType = cmark_node_get_list_type(node);
    const char *listTypeString = listType == CMARK_ORDERED_LIST ? "ordered" : "bullet";
    appendStringField(out, "listType", listTypeString, hasField);
    appendNumberField(out, "listStart", cmark_node_get_list_start(node), hasField);
    appendBoolField(out, "listTight", cmark_node_get_list_tight(node), hasField);
  }

  if (type == CMARK_NODE_ITEM && nodeType && std::strcmp(nodeType, "tasklist") == 0) {
    bool checked = cmark_gfm_extensions_get_tasklist_item_checked(node);
    appendBoolField(out, "checked", checked, hasField);
  }

  if (type == CMARK_NODE_TABLE_ROW) {
    int isHeader = cmark_gfm_extensions_get_table_row_is_header(node);
    appendBoolField(out, "header", isHeader != 0, hasField);
  }

  if (type == CMARK_NODE_TABLE_CELL) {
    cmark_node *row = cmark_node_parent(node);
    cmark_node *table = row ? cmark_node_parent(row) : nullptr;
    uint8_t *alignments =
      table ? cmark_gfm_extensions_get_table_alignments(table) : nullptr;
    if (alignments) {
      uint16_t columns = cmark_gfm_extensions_get_table_columns(table);
      int index = 0;
      for (cmark_node *sibling = cmark_node_first_child(row);
           sibling;
           sibling = cmark_node_next(sibling)) {
        if (sibling == node) {
          break;
        }
        if (cmark_node_get_type(sibling) == CMARK_NODE_TABLE_CELL) {
          index++;
        }
      }
      if (index < static_cast<int>(columns)) {
        appendStringField(out, "align", alignmentToString(alignments[index]), hasField);
      }
    }
  }

  if (includeSourcepos) {
    appendSourcepos(out, node, hasField);
  }

  cmark_node *child = cmark_node_first_child(node);
  if (child) {
    appendKey(out, "children", hasField);
    out.push_back('[');
    bool firstChild = true;
    while (child) {
      if (!firstChild) {
        out.push_back(',');
      }
      firstChild = false;
      appendNode(out, child, includeSourcepos);
      child = cmark_node_next(child);
    }
    out.push_back(']');
  }

  out.push_back('}');
}

void attachExtension(cmark_parser *parser, const char *name) {
  cmark_syntax_extension *ext = cmark_find_syntax_extension(name);
  if (ext) {
    cmark_parser_attach_syntax_extension(parser, ext);
  }
}

} // namespace

extern "C" char *zynth_markdown_parse(
  const char *input,
  uint32_t options,
  uint32_t extensions
) {
  const char *payload = input ? input : "";

  int cmarkOptions = 0;
  if (options & ZYNTH_MD_OPT_SOURCEPOS) cmarkOptions |= CMARK_OPT_SOURCEPOS;
  if (options & ZYNTH_MD_OPT_HARDBREAKS) cmarkOptions |= CMARK_OPT_HARDBREAKS;
  if (options & ZYNTH_MD_OPT_SMART) cmarkOptions |= CMARK_OPT_SMART;
  if (options & ZYNTH_MD_OPT_SAFE) cmarkOptions |= CMARK_OPT_SAFE;

  cmark_gfm_core_extensions_ensure_registered();
  cmark_parser *parser = cmark_parser_new(cmarkOptions);

  if (extensions & ZYNTH_MD_EXT_TABLE) attachExtension(parser, "table");
  if (extensions & ZYNTH_MD_EXT_STRIKETHROUGH) attachExtension(parser, "strikethrough");
  if (extensions & ZYNTH_MD_EXT_AUTOLINK) attachExtension(parser, "autolink");
  if (extensions & ZYNTH_MD_EXT_TAGFILTER) attachExtension(parser, "tagfilter");
  if (extensions & ZYNTH_MD_EXT_TASKLIST) attachExtension(parser, "tasklist");

  cmark_parser_feed(parser, payload, std::strlen(payload));
  cmark_node *doc = cmark_parser_finish(parser);

  std::string json;
  json.reserve(std::strlen(payload) + 256);
  if (doc) {
    appendNode(json, doc, (options & ZYNTH_MD_OPT_SOURCEPOS) != 0);
  } else {
    json.assign("{\"type\":\"document\",\"children\":[]}");
  }

  if (doc) {
    cmark_node_free(doc);
  }
  cmark_parser_free(parser);

  char *result = static_cast<char *>(std::malloc(json.size() + 1));
  if (!result) {
    return nullptr;
  }
  std::memcpy(result, json.c_str(), json.size());
  result[json.size()] = '\0';
  return result;
}

extern "C" void zynth_markdown_free(char *value) {
  if (value) {
    std::free(value);
  }
}
