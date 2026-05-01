#pragma once

#include "ZynthProp.h"
#include "ZynthRendererHost.h"
#include "ZynthRendererTelemetry.h"

#include <yoga/Yoga.h>
#include <vector>
#include <cmath>

namespace zynth {

class ZynthYogaTree {
public:
  ZynthYogaTree(ZynthRendererHost* host) : host_(host) {
    config_ = YGConfigNew();
  }

  ~ZynthYogaTree() {
    YGConfigFree(config_);
  }

  /**
   * @brief Create or verify yoga node existence for all nodes.
   */
  void syncTopology() {
    // In a real implementation this would efficiently diff, but for now
    // we ensure all surfaces have a root and all nodes have a YGNode.
    // We'll manage this through explicit create/insert calls during commit later.
  }

  /**
   * @brief Apply a batch of layout mutations to the yoga tree.
   */
  void applyLayoutMutations(const std::vector<ZynthPropMutation>& mutations) {
    for (const auto& mut : mutations) {
      auto* record = host_->getNode(mut.nodeId);
      if (!record) continue;
      
      if (!record->yoga) {
        record->yoga = YGNodeNewWithConfig(config_);
        YGNodeSetContext(record->yoga, reinterpret_cast<void*>(static_cast<intptr_t>(record->id)));
      }
      
      applyProp(record->yoga, mut);
    }
  }

  /**
   * @brief Calculate layout for all dirty surfaces and update the native tree frames.
   */
  void calculateLayoutForDirtySurfaces(ZynthCommitTelemetry& telemetry, ZynthCommit& commit) {
    ZynthPhaseTimer timer(telemetry.yogaCalculateUs);
    
    const auto& dirtySurfaces = host_->dirtySurfaces();
    __android_log_print(ANDROID_LOG_DEBUG, "ZynthYoga", "Calculating layout for %zu dirty surfaces", dirtySurfaces.size());
    for (int32_t surfaceId : dirtySurfaces) {
      // Find surface
      // We need to iterate over surfaces in host, let's assume we can get it
      auto surfIt = host_->surfaces_.find(surfaceId);
      if (surfIt == host_->surfaces_.end()) {
        __android_log_print(ANDROID_LOG_WARN, "ZynthYoga", "Surface %d NOT FOUND in host!", surfaceId);
        continue;
      }
      if (!surfIt->second.rootYoga) {
        __android_log_print(ANDROID_LOG_WARN, "ZynthYoga", "Surface %d has NO rootYoga!", surfaceId);
        continue;
      }
      
      auto& surface = surfIt->second;
      __android_log_print(ANDROID_LOG_DEBUG, "ZynthYoga", "Surface %d layout start: %.1fx%.1f", surfaceId, surface.width, surface.height);
      
      // Calculate layout
      YGNodeCalculateLayout(surface.rootYoga, YGUndefined, YGUndefined, YGDirectionLTR);
      
      // Extract frames
      extractFrames(surface.rootYoga, telemetry, commit);
      __android_log_print(ANDROID_LOG_DEBUG, "ZynthYoga", "Surface %d layout complete, extracted %u frames", surfaceId, telemetry.changedFrameCount);
    }
    
    // Clear dirty
    host_->clearDirtySurfaces();
  }

private:
  void extractFrames(YGNodeRef node, ZynthCommitTelemetry& telemetry, ZynthCommit& commit) {
    if (!node) return;
    
    int32_t nodeId = static_cast<int32_t>(reinterpret_cast<intptr_t>(YGNodeGetContext(node)));
    
    if (nodeId > 0 && YGNodeGetHasNewLayout(node)) {
      auto* record = host_->getNode(nodeId);
      if (record) {
        float left = YGNodeLayoutGetLeft(node);
        float top = YGNodeLayoutGetTop(node);
        float width = YGNodeLayoutGetWidth(node);
        float height = YGNodeLayoutGetHeight(node);
        
        // Check diff
        if (record->lastFrame.left != left ||
            record->lastFrame.top != top ||
            record->lastFrame.width != width ||
            record->lastFrame.height != height) {
          
          record->lastFrame.left = left;
          record->lastFrame.top = top;
          record->lastFrame.width = width;
          record->lastFrame.height = height;
          record->lastFrame.changed = true;
          
          telemetry.changedFrameCount++;
          
          // Phase 4: Emit to mount transaction
          commit.layoutFrames.push_back({nodeId, left, top, width, height});
        }
      }
      YGNodeSetHasNewLayout(node, false);
    }
    
    for (uint32_t i = 0; i < YGNodeGetChildCount(node); ++i) {
      extractFrames(YGNodeGetChild(node, i), telemetry, commit);
    }
  }

  void applyProp(YGNodeRef node, const ZynthPropMutation& mut) {
    const auto& v = mut.value;
    
    // Helper to get auto/percent/point values
    auto applyDimension = [&](auto ptFn, auto pctFn, auto autoFn) {
      if (v.kind == ZynthValueKind::Number) ptFn(node, host_->dpToPx(static_cast<float>(v.number)));
      else if (v.kind == ZynthValueKind::Percent) pctFn(node, static_cast<float>(v.number));
      else if (v.kind == ZynthValueKind::Auto) autoFn(node);
    };
    
    auto applyEdge = [&](YGEdge edge, auto ptFn, auto pctFn) {
      if (v.kind == ZynthValueKind::Number) ptFn(node, edge, host_->dpToPx(static_cast<float>(v.number)));
      else if (v.kind == ZynthValueKind::Percent) pctFn(node, edge, static_cast<float>(v.number));
    };

    auto noopAuto = [](YGNodeRef) {};

    switch (mut.prop) {
      case ZynthPropId::Width: applyDimension(YGNodeStyleSetWidth, YGNodeStyleSetWidthPercent, YGNodeStyleSetWidthAuto); break;
      case ZynthPropId::Height: applyDimension(YGNodeStyleSetHeight, YGNodeStyleSetHeightPercent, YGNodeStyleSetHeightAuto); break;
      case ZynthPropId::MinWidth: applyDimension(YGNodeStyleSetMinWidth, YGNodeStyleSetMinWidthPercent, noopAuto); break;
      case ZynthPropId::MinHeight: applyDimension(YGNodeStyleSetMinHeight, YGNodeStyleSetMinHeightPercent, noopAuto); break;
      case ZynthPropId::MaxWidth: applyDimension(YGNodeStyleSetMaxWidth, YGNodeStyleSetMaxWidthPercent, noopAuto); break;
      case ZynthPropId::MaxHeight: applyDimension(YGNodeStyleSetMaxHeight, YGNodeStyleSetMaxHeightPercent, noopAuto); break;
      case ZynthPropId::Flex: if (v.kind == ZynthValueKind::Number) YGNodeStyleSetFlex(node, static_cast<float>(v.number)); break;
      case ZynthPropId::FlexGrow: if (v.kind == ZynthValueKind::Number) YGNodeStyleSetFlexGrow(node, static_cast<float>(v.number)); break;
      case ZynthPropId::FlexShrink: if (v.kind == ZynthValueKind::Number) YGNodeStyleSetFlexShrink(node, static_cast<float>(v.number)); break;
      case ZynthPropId::FlexBasis: applyDimension(YGNodeStyleSetFlexBasis, YGNodeStyleSetFlexBasisPercent, YGNodeStyleSetFlexBasisAuto); break;
      
      case ZynthPropId::FlexDirection: if (v.kind == ZynthValueKind::Number) YGNodeStyleSetFlexDirection(node, static_cast<YGFlexDirection>(v.number)); break;
      case ZynthPropId::FlexWrap: if (v.kind == ZynthValueKind::Number) YGNodeStyleSetFlexWrap(node, static_cast<YGWrap>(v.number)); break;
      case ZynthPropId::JustifyContent: if (v.kind == ZynthValueKind::Number) YGNodeStyleSetJustifyContent(node, static_cast<YGJustify>(v.number)); break;
      case ZynthPropId::AlignItems: if (v.kind == ZynthValueKind::Number) YGNodeStyleSetAlignItems(node, static_cast<YGAlign>(v.number)); break;
      case ZynthPropId::AlignSelf: if (v.kind == ZynthValueKind::Number) YGNodeStyleSetAlignSelf(node, static_cast<YGAlign>(v.number)); break;
      case ZynthPropId::AlignContent: if (v.kind == ZynthValueKind::Number) YGNodeStyleSetAlignContent(node, static_cast<YGAlign>(v.number)); break;
      
      case ZynthPropId::Position: if (v.kind == ZynthValueKind::Number) YGNodeStyleSetPositionType(node, static_cast<YGPositionType>(v.number)); break;
      case ZynthPropId::Display: if (v.kind == ZynthValueKind::Number) YGNodeStyleSetDisplay(node, static_cast<YGDisplay>(v.number)); break;
      case ZynthPropId::Overflow: if (v.kind == ZynthValueKind::Number) YGNodeStyleSetOverflow(node, static_cast<YGOverflow>(v.number)); break;
      case ZynthPropId::AspectRatio: if (v.kind == ZynthValueKind::Number) YGNodeStyleSetAspectRatio(node, static_cast<float>(v.number)); break;
      
      case ZynthPropId::Top: applyEdge(YGEdgeTop, YGNodeStyleSetPosition, YGNodeStyleSetPositionPercent); break;
      case ZynthPropId::Right: applyEdge(YGEdgeRight, YGNodeStyleSetPosition, YGNodeStyleSetPositionPercent); break;
      case ZynthPropId::Bottom: applyEdge(YGEdgeBottom, YGNodeStyleSetPosition, YGNodeStyleSetPositionPercent); break;
      case ZynthPropId::Left: applyEdge(YGEdgeLeft, YGNodeStyleSetPosition, YGNodeStyleSetPositionPercent); break;

      case ZynthPropId::Padding: applyEdge(YGEdgeAll, YGNodeStyleSetPadding, YGNodeStyleSetPaddingPercent); break;
      case ZynthPropId::PaddingHorizontal: applyEdge(YGEdgeHorizontal, YGNodeStyleSetPadding, YGNodeStyleSetPaddingPercent); break;
      case ZynthPropId::PaddingVertical: applyEdge(YGEdgeVertical, YGNodeStyleSetPadding, YGNodeStyleSetPaddingPercent); break;
      case ZynthPropId::PaddingTop: applyEdge(YGEdgeTop, YGNodeStyleSetPadding, YGNodeStyleSetPaddingPercent); break;
      case ZynthPropId::PaddingRight: applyEdge(YGEdgeRight, YGNodeStyleSetPadding, YGNodeStyleSetPaddingPercent); break;
      case ZynthPropId::PaddingBottom: applyEdge(YGEdgeBottom, YGNodeStyleSetPadding, YGNodeStyleSetPaddingPercent); break;
      case ZynthPropId::PaddingLeft: applyEdge(YGEdgeLeft, YGNodeStyleSetPadding, YGNodeStyleSetPaddingPercent); break;

      case ZynthPropId::Margin: if (v.kind == ZynthValueKind::Auto) YGNodeStyleSetMarginAuto(node, YGEdgeAll); else applyEdge(YGEdgeAll, YGNodeStyleSetMargin, YGNodeStyleSetMarginPercent); break;
      case ZynthPropId::MarginHorizontal: if (v.kind == ZynthValueKind::Auto) YGNodeStyleSetMarginAuto(node, YGEdgeHorizontal); else applyEdge(YGEdgeHorizontal, YGNodeStyleSetMargin, YGNodeStyleSetMarginPercent); break;
      case ZynthPropId::MarginVertical: if (v.kind == ZynthValueKind::Auto) YGNodeStyleSetMarginAuto(node, YGEdgeVertical); else applyEdge(YGEdgeVertical, YGNodeStyleSetMargin, YGNodeStyleSetMarginPercent); break;
      case ZynthPropId::MarginTop: if (v.kind == ZynthValueKind::Auto) YGNodeStyleSetMarginAuto(node, YGEdgeTop); else applyEdge(YGEdgeTop, YGNodeStyleSetMargin, YGNodeStyleSetMarginPercent); break;
      case ZynthPropId::MarginRight: if (v.kind == ZynthValueKind::Auto) YGNodeStyleSetMarginAuto(node, YGEdgeRight); else applyEdge(YGEdgeRight, YGNodeStyleSetMargin, YGNodeStyleSetMarginPercent); break;
      case ZynthPropId::MarginBottom: if (v.kind == ZynthValueKind::Auto) YGNodeStyleSetMarginAuto(node, YGEdgeBottom); else applyEdge(YGEdgeBottom, YGNodeStyleSetMargin, YGNodeStyleSetMarginPercent); break;
      case ZynthPropId::MarginLeft: if (v.kind == ZynthValueKind::Auto) YGNodeStyleSetMarginAuto(node, YGEdgeLeft); else applyEdge(YGEdgeLeft, YGNodeStyleSetMargin, YGNodeStyleSetMarginPercent); break;

      case ZynthPropId::Gap: if (v.kind == ZynthValueKind::Number) YGNodeStyleSetGap(node, YGGutterAll, host_->dpToPx(static_cast<float>(v.number))); break;
      case ZynthPropId::RowGap: if (v.kind == ZynthValueKind::Number) YGNodeStyleSetGap(node, YGGutterRow, host_->dpToPx(static_cast<float>(v.number))); break;
      case ZynthPropId::ColumnGap: if (v.kind == ZynthValueKind::Number) YGNodeStyleSetGap(node, YGGutterColumn, host_->dpToPx(static_cast<float>(v.number))); break;

      default:
        break;
    }
  }

  ZynthRendererHost* host_;
  YGConfigRef config_;
};

} // namespace zynth
