#include "ZynthYogaLayoutRuntime.h"

#include <yoga/Yoga.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <memory>
#include <string>
#include <unordered_map>

struct YogaNodeState;
struct ZynthYogaLayoutRuntime {
  void *userData = nullptr;
  ZynthYogaMeasureFn textMeasure = nullptr;
  ZynthYogaMeasureFn nodeMeasure = nullptr;
  std::unordered_map<int, YogaNodeState> nodes;
};

struct YogaNodeContext {
  ZynthYogaLayoutRuntime *runtime = nullptr;
  int nodeId = 0;
};

struct YogaNodeState {
  YGNodeRef node = nullptr;
  std::unique_ptr<YogaNodeContext> context;
  std::string type;
  std::string text;
  bool measureEnabled = false;
};

YGNodeRef yogaEnsureNode(ZynthYogaLayoutRuntime *runtime, int nodeId) {
  auto it = runtime->nodes.find(nodeId);
  if (it != runtime->nodes.end()) {
    return it->second.node;
  }

  YogaNodeState state;
  state.node = YGNodeNew();
  state.context = std::make_unique<YogaNodeContext>();
  state.context->runtime = runtime;
  state.context->nodeId = nodeId;
  YGNodeSetContext(state.node, state.context.get());
  YGNodeStyleSetFlexDirection(state.node, YGFlexDirectionColumn);
  YGNodeStyleSetAlignItems(state.node, YGAlignStretch);
  auto [insertResult, didInsert] = runtime->nodes.emplace(nodeId, std::move(state));
  static_cast<void>(didInsert);
  return insertResult->second.node;
}

int yogaModeToInt(YGMeasureMode mode) {
  switch (mode) {
    case YGMeasureModeExactly:
      return 1;
    case YGMeasureModeAtMost:
      return 2;
    case YGMeasureModeUndefined:
    default:
      return 0;
  }
}

YGSize yogaMeasureNode(
    YGNodeConstRef node,
    float width,
    YGMeasureMode widthMode,
    float height,
    YGMeasureMode heightMode) {
  auto *context = static_cast<YogaNodeContext *>(YGNodeGetContext(node));
  if (!context || !context->runtime) {
    return YGSize{0.0f, 0.0f};
  }
  auto runtime = context->runtime;
  auto it = runtime->nodes.find(context->nodeId);
  if (it == runtime->nodes.end()) {
    return YGSize{0.0f, 0.0f};
  }

  float outWidth = 0.0f;
  float outHeight = 0.0f;
  const YogaNodeState &state = it->second;
  bool measured = false;
  if (state.type == "text" && runtime->textMeasure) {
    measured = runtime->textMeasure(
        runtime->userData,
        context->nodeId,
        width,
        yogaModeToInt(widthMode),
        height,
        yogaModeToInt(heightMode),
        &outWidth,
        &outHeight);
  } else if (state.measureEnabled && runtime->nodeMeasure) {
    measured = runtime->nodeMeasure(
        runtime->userData,
        context->nodeId,
        width,
        yogaModeToInt(widthMode),
        height,
        yogaModeToInt(heightMode),
        &outWidth,
        &outHeight);
  }
  if (!measured) {
    return YGSize{0.0f, 0.0f};
  }
  return YGSize{
      std::max(outWidth, 0.0f),
      std::max(outHeight, 0.0f),
  };
}

void yogaRefreshMeasureFunc(ZynthYogaLayoutRuntime *runtime, int nodeId) {
  auto it = runtime->nodes.find(nodeId);
  if (it == runtime->nodes.end()) {
    return;
  }
  bool shouldMeasure = it->second.type == "text" || it->second.measureEnabled;
  YGNodeSetMeasureFunc(it->second.node, shouldMeasure ? yogaMeasureNode : nullptr);
  if (shouldMeasure && YGNodeGetOwner(it->second.node) != nullptr) {
    YGNodeMarkDirty(it->second.node);
  }
}

bool yogaApplyLength(
    YGNodeRef node,
    std::uint32_t propId,
    float value,
    bool isPercent) {
  switch (propId) {
    case 1:
      if (isPercent) YGNodeStyleSetWidthPercent(node, value);
      else YGNodeStyleSetWidth(node, value);
      return true;
    case 2:
      if (isPercent) YGNodeStyleSetHeightPercent(node, value);
      else YGNodeStyleSetHeight(node, value);
      return true;
    case 3:
      if (isPercent) YGNodeStyleSetMinWidthPercent(node, value);
      else YGNodeStyleSetMinWidth(node, value);
      return true;
    case 4:
      if (isPercent) YGNodeStyleSetMinHeightPercent(node, value);
      else YGNodeStyleSetMinHeight(node, value);
      return true;
    case 5:
      if (isPercent) YGNodeStyleSetMaxWidthPercent(node, value);
      else YGNodeStyleSetMaxWidth(node, value);
      return true;
    case 6:
      if (isPercent) YGNodeStyleSetMaxHeightPercent(node, value);
      else YGNodeStyleSetMaxHeight(node, value);
      return true;
    case 10:
      if (isPercent) YGNodeStyleSetFlexBasisPercent(node, value);
      else YGNodeStyleSetFlexBasis(node, value);
      return true;
    default:
      return false;
  }
}

bool yogaApplyEdgeNumber(YGNodeRef node, std::uint32_t propId, float value) {
  switch (propId) {
    case 11:
      YGNodeStyleSetPosition(node, YGEdgeTop, value);
      return true;
    case 12:
      YGNodeStyleSetPosition(node, YGEdgeRight, value);
      return true;
    case 13:
      YGNodeStyleSetPosition(node, YGEdgeBottom, value);
      return true;
    case 14:
      YGNodeStyleSetPosition(node, YGEdgeLeft, value);
      return true;
    case 15:
      YGNodeStyleSetPadding(node, YGEdgeAll, value);
      return true;
    case 16:
      YGNodeStyleSetPadding(node, YGEdgeHorizontal, value);
      return true;
    case 17:
      YGNodeStyleSetPadding(node, YGEdgeVertical, value);
      return true;
    case 18:
      YGNodeStyleSetPadding(node, YGEdgeTop, value);
      return true;
    case 19:
      YGNodeStyleSetPadding(node, YGEdgeRight, value);
      return true;
    case 20:
      YGNodeStyleSetPadding(node, YGEdgeBottom, value);
      return true;
    case 21:
      YGNodeStyleSetPadding(node, YGEdgeLeft, value);
      return true;
    case 22:
      YGNodeStyleSetMargin(node, YGEdgeAll, value);
      return true;
    case 23:
      YGNodeStyleSetMargin(node, YGEdgeHorizontal, value);
      return true;
    case 24:
      YGNodeStyleSetMargin(node, YGEdgeVertical, value);
      return true;
    case 25:
      YGNodeStyleSetMargin(node, YGEdgeTop, value);
      return true;
    case 26:
      YGNodeStyleSetMargin(node, YGEdgeRight, value);
      return true;
    case 27:
      YGNodeStyleSetMargin(node, YGEdgeBottom, value);
      return true;
    case 28:
      YGNodeStyleSetMargin(node, YGEdgeLeft, value);
      return true;
    case 29:
      YGNodeStyleSetGap(node, YGGutterAll, value);
      return true;
    case 30:
      YGNodeStyleSetGap(node, YGGutterRow, value);
      return true;
    case 31:
      YGNodeStyleSetGap(node, YGGutterColumn, value);
      return true;
    default:
      return false;
  }
}

YGAlign yogaParseAlign(const char *value) {
  if (!value) return YGAlignAuto;
  if (std::strcmp(value, "flex-start") == 0) return YGAlignFlexStart;
  if (std::strcmp(value, "flex-end") == 0) return YGAlignFlexEnd;
  if (std::strcmp(value, "center") == 0) return YGAlignCenter;
  if (std::strcmp(value, "space-between") == 0) return YGAlignSpaceBetween;
  if (std::strcmp(value, "space-around") == 0) return YGAlignSpaceAround;
  if (std::strcmp(value, "stretch") == 0) return YGAlignStretch;
  if (std::strcmp(value, "baseline") == 0) return YGAlignBaseline;
  return YGAlignAuto;
}

bool yogaApplyStringStyle(YGNodeRef node, std::uint32_t propId, const char *value) {
  if (!value) return false;
  switch (propId) {
    case 1:
      if (std::strcmp(value, "auto") == 0) {
        YGNodeStyleSetWidthAuto(node);
        return true;
      }
      break;
    case 2:
      if (std::strcmp(value, "auto") == 0) {
        YGNodeStyleSetHeightAuto(node);
        return true;
      }
      break;
    case 10:
      if (std::strcmp(value, "auto") == 0) {
        YGNodeStyleSetFlexBasisAuto(node);
        return true;
      }
      break;
    case 33:
      if (std::strcmp(value, "row") == 0) YGNodeStyleSetFlexDirection(node, YGFlexDirectionRow);
      else if (std::strcmp(value, "row-reverse") == 0) YGNodeStyleSetFlexDirection(node, YGFlexDirectionRowReverse);
      else if (std::strcmp(value, "column-reverse") == 0) YGNodeStyleSetFlexDirection(node, YGFlexDirectionColumnReverse);
      else YGNodeStyleSetFlexDirection(node, YGFlexDirectionColumn);
      return true;
    case 34:
      if (std::strcmp(value, "flex-end") == 0) YGNodeStyleSetJustifyContent(node, YGJustifyFlexEnd);
      else if (std::strcmp(value, "center") == 0) YGNodeStyleSetJustifyContent(node, YGJustifyCenter);
      else if (std::strcmp(value, "space-between") == 0) YGNodeStyleSetJustifyContent(node, YGJustifySpaceBetween);
      else if (std::strcmp(value, "space-around") == 0) YGNodeStyleSetJustifyContent(node, YGJustifySpaceAround);
      else if (std::strcmp(value, "space-evenly") == 0) YGNodeStyleSetJustifyContent(node, YGJustifySpaceEvenly);
      else YGNodeStyleSetJustifyContent(node, YGJustifyFlexStart);
      return true;
    case 35:
      YGNodeStyleSetAlignItems(node, yogaParseAlign(value));
      return true;
    case 36:
      YGNodeStyleSetAlignSelf(node, yogaParseAlign(value));
      return true;
    case 37:
      YGNodeStyleSetAlignContent(node, yogaParseAlign(value));
      return true;
    case 38:
      if (std::strcmp(value, "wrap") == 0) YGNodeStyleSetFlexWrap(node, YGWrapWrap);
      else if (std::strcmp(value, "wrap-reverse") == 0) YGNodeStyleSetFlexWrap(node, YGWrapWrapReverse);
      else YGNodeStyleSetFlexWrap(node, YGWrapNoWrap);
      return true;
    case 39:
      if (std::strcmp(value, "absolute") == 0) YGNodeStyleSetPositionType(node, YGPositionTypeAbsolute);
      else YGNodeStyleSetPositionType(node, YGPositionTypeRelative);
      return true;
    case 40:
      if (std::strcmp(value, "none") == 0) YGNodeStyleSetDisplay(node, YGDisplayNone);
      else YGNodeStyleSetDisplay(node, YGDisplayFlex);
      return true;
    case 41:
      if (std::strcmp(value, "hidden") == 0) YGNodeStyleSetOverflow(node, YGOverflowHidden);
      else if (std::strcmp(value, "scroll") == 0) YGNodeStyleSetOverflow(node, YGOverflowScroll);
      else YGNodeStyleSetOverflow(node, YGOverflowVisible);
      return true;
    case 114:
      if (std::strcmp(value, "rtl") == 0) YGNodeStyleSetDirection(node, YGDirectionRTL);
      else if (std::strcmp(value, "ltr") == 0) YGNodeStyleSetDirection(node, YGDirectionLTR);
      else YGNodeStyleSetDirection(node, YGDirectionInherit);
      return true;
    default:
      break;
  }

  const std::size_t length = std::strlen(value);
  if (length > 1 && value[length - 1] == '%') {
    const float parsed = std::strtof(value, nullptr);
    return yogaApplyLength(node, propId, parsed, true);
  }
  return false;
}

bool yogaIsInlineTextChild(ZynthYogaLayoutRuntime *runtime, int parentId, int childId) {
  auto parentIt = runtime->nodes.find(parentId);
  auto childIt = runtime->nodes.find(childId);
  if (parentIt == runtime->nodes.end() || childIt == runtime->nodes.end()) {
    return false;
  }
  return parentIt->second.type == "text" && childIt->second.type == "text";
}

void yogaFreeNodeShallow(YGNodeRef node) {
  if (!node) return;
  while (YGNodeGetChildCount(node) > 0) {
    YGNodeRef child = YGNodeGetChild(node, 0);
    YGNodeRemoveChild(node, child);
  }
  YGNodeFree(node);
}

ZynthYogaLayoutRuntime *zynth_yoga_runtime_create(
    void *userData,
    ZynthYogaMeasureFn textMeasure,
    ZynthYogaMeasureFn nodeMeasure) {
  auto *runtime = new ZynthYogaLayoutRuntime();
  runtime->userData = userData;
  runtime->textMeasure = textMeasure;
  runtime->nodeMeasure = nodeMeasure;
  return runtime;
}

void zynth_yoga_runtime_destroy(ZynthYogaLayoutRuntime *runtime) {
  if (!runtime) return;
  for (auto &entry : runtime->nodes) {
    yogaFreeNodeShallow(entry.second.node);
  }
  delete runtime;
}

void zynth_yoga_runtime_set_surface_root(ZynthYogaLayoutRuntime *runtime, int surfaceId) {
  if (!runtime) return;
  YGNodeRef node = yogaEnsureNode(runtime, surfaceId);
  auto &state = runtime->nodes[surfaceId];
  state.type = "root";
  YGNodeStyleSetFlexDirection(node, YGFlexDirectionColumn);
  YGNodeStyleSetAlignItems(node, YGAlignStretch);
}

void zynth_yoga_runtime_set_node_type(
    ZynthYogaLayoutRuntime *runtime,
    int nodeId,
    const char *type) {
  if (!runtime) return;
  yogaEnsureNode(runtime, nodeId);
  runtime->nodes[nodeId].type = type ? type : "";
  yogaRefreshMeasureFunc(runtime, nodeId);
}

void zynth_yoga_runtime_set_text(
    ZynthYogaLayoutRuntime *runtime,
    int nodeId,
    const char *text) {
  if (!runtime) return;
  yogaEnsureNode(runtime, nodeId);
  auto &state = runtime->nodes[nodeId];
  state.text = text ? text : "";
  if (state.type == "text" && YGNodeGetOwner(state.node) != nullptr) {
    YGNodeMarkDirty(state.node);
  }
}

void zynth_yoga_runtime_set_measure_handler(
    ZynthYogaLayoutRuntime *runtime,
    int nodeId,
    bool enabled) {
  if (!runtime) return;
  yogaEnsureNode(runtime, nodeId);
  runtime->nodes[nodeId].measureEnabled = enabled;
  yogaRefreshMeasureFunc(runtime, nodeId);
}

void zynth_yoga_runtime_insert_child(
    ZynthYogaLayoutRuntime *runtime,
    int parentId,
    int childId,
    int index) {
  if (!runtime) return;
  if (yogaIsInlineTextChild(runtime, parentId, childId)) return;
  YGNodeRef parent = yogaEnsureNode(runtime, parentId);
  YGNodeRef child = yogaEnsureNode(runtime, childId);
  if (YGNodeHasMeasureFunc(parent)) return;
  if (YGNodeGetOwner(child) != nullptr) {
    YGNodeRemoveChild(YGNodeGetOwner(child), child);
  }
  std::uint32_t count = YGNodeGetChildCount(parent);
  std::uint32_t clamped = static_cast<std::uint32_t>(std::max(0, std::min(index, static_cast<int>(count))));
  YGNodeInsertChild(parent, child, clamped);
}

void zynth_yoga_runtime_remove_child(
    ZynthYogaLayoutRuntime *runtime,
    int parentId,
    int childId) {
  if (!runtime) return;
  if (yogaIsInlineTextChild(runtime, parentId, childId)) return;
  auto parentIt = runtime->nodes.find(parentId);
  auto childIt = runtime->nodes.find(childId);
  if (parentIt == runtime->nodes.end() || childIt == runtime->nodes.end()) return;
  YGNodeRemoveChild(parentIt->second.node, childIt->second.node);
}

void zynth_yoga_runtime_drop_node(ZynthYogaLayoutRuntime *runtime, int nodeId) {
  if (!runtime) return;
  auto it = runtime->nodes.find(nodeId);
  if (it == runtime->nodes.end()) return;
  YGNodeRef node = it->second.node;
  if (YGNodeGetOwner(node) != nullptr) {
    YGNodeRemoveChild(YGNodeGetOwner(node), node);
  }
  yogaFreeNodeShallow(node);
  runtime->nodes.erase(it);
}

bool zynth_yoga_runtime_set_style_number(
    ZynthYogaLayoutRuntime *runtime,
    int nodeId,
    std::uint32_t propId,
    float value) {
  if (!runtime) return false;
  YGNodeRef node = yogaEnsureNode(runtime, nodeId);
  if (yogaApplyLength(node, propId, value, false)) return true;
  if (yogaApplyEdgeNumber(node, propId, value)) return true;
  switch (propId) {
    case 7:
      YGNodeStyleSetFlex(node, value);
      return true;
    case 8:
      YGNodeStyleSetFlexGrow(node, value);
      return true;
    case 9:
      YGNodeStyleSetFlexShrink(node, value);
      return true;
    case 32:
      YGNodeStyleSetAspectRatio(node, value);
      return true;
    default:
      return false;
  }
}

bool zynth_yoga_runtime_set_style_string(
    ZynthYogaLayoutRuntime *runtime,
    int nodeId,
    std::uint32_t propId,
    const char *value) {
  if (!runtime) return false;
  YGNodeRef node = yogaEnsureNode(runtime, nodeId);
  return yogaApplyStringStyle(node, propId, value);
}

bool zynth_yoga_runtime_compute_layout(
    ZynthYogaLayoutRuntime *runtime,
    int rootId,
    float width,
    float height) {
  if (!runtime) return false;
  YGNodeRef root = yogaEnsureNode(runtime, rootId);
  const float layoutWidth = std::isfinite(width) && width > 0.0f ? width : YGUndefined;
  const float layoutHeight = std::isfinite(height) && height > 0.0f ? height : YGUndefined;
  if (std::isfinite(layoutWidth)) {
    YGNodeStyleSetWidth(root, layoutWidth);
  } else {
    YGNodeStyleSetWidthAuto(root);
  }
  if (std::isfinite(layoutHeight)) {
    YGNodeStyleSetHeight(root, layoutHeight);
  } else {
    YGNodeStyleSetHeightAuto(root);
  }
  YGNodeCalculateLayout(root, layoutWidth, layoutHeight, YGDirectionLTR);
  return true;
}

bool zynth_yoga_runtime_collect_frames(
    ZynthYogaLayoutRuntime *runtime,
    const int *nodeIds,
    std::size_t count,
    float *outFrames) {
  if (!runtime || !nodeIds || !outFrames) return false;
  for (std::size_t i = 0; i < count; i++) {
    const auto it = runtime->nodes.find(nodeIds[i]);
    if (it == runtime->nodes.end()) {
      continue;
    }
    const YGNodeRef node = it->second.node;
    const std::size_t base = i * 4;
    outFrames[base + 0] = YGNodeLayoutGetLeft(node);
    outFrames[base + 1] = YGNodeLayoutGetTop(node);
    outFrames[base + 2] = YGNodeLayoutGetWidth(node);
    outFrames[base + 3] = YGNodeLayoutGetHeight(node);
  }
  return true;
}
