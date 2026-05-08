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

  bool applyProp(YGNodeRef node, const ZynthPropMutation& mut) {
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
        return false;
    }
    return true;
  }

  /**
   * @brief Calculate layout for all dirty surfaces and extract the frames
   *        that were affected.
   */
  void calculateLayoutForDirtySurfaces(ZynthCommitTelemetry& telemetry, ZynthCommit& commit) {
    ZynthPhaseTimer timer(telemetry.yogaCalculateUs);
    
    const auto& dirtySurfaces = host_->dirtySurfaces();
    bool hasJsMutations = !commit.inserts.empty() || !commit.removes.empty() || 
                         !commit.creates.empty() || !commit.layoutProps.empty() || 
                         !commit.textProps.empty() || !commit.textMutations.empty();

    for (int32_t surfaceId : dirtySurfaces) {
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
      
      // Calculate layout — Yoga skips clean subtrees internally
      YGNodeCalculateLayout(surface.rootYoga, YGUndefined, YGUndefined, YGDirectionLTR);

      // If this is a native-only commit (e.g. from an animation frame), we won't have 
      // JS mutation records to seed extractFramesForMutatedNodes. We must walk the tree
      // to find what Yoga changed.
      if (!hasJsMutations) {
        extractFrames(surface.rootYoga, telemetry, commit);
      }
    }
    
    // Extract frames using the optimized mutation-seeded path if JS changes are present.
    if (hasJsMutations) {
      extractFramesForMutatedNodes(telemetry, commit);
    }
    
    // Clear dirty
    host_->clearDirtySurfaces();
  }

  /**
   * @brief Full-tree frame extraction. 
   */
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
          commit.layoutFrames.push_back({nodeId, left, top, width, height});
        }
      }
      YGNodeSetHasNewLayout(node, false);
    }
    
    for (uint32_t i = 0; i < YGNodeGetChildCount(node); ++i) {
      extractFrames(YGNodeGetChild(node, i), telemetry, commit);
    }
  }

private:
  void extractFramesForMutatedNodes(ZynthCommitTelemetry& telemetry, ZynthCommit& commit) {
    // Seed: all nodes that were directly affected by this commit
    std::unordered_set<int32_t> dirtyNodes;
    std::unordered_set<int32_t> subtreeRoots;
    std::unordered_set<int32_t> forcedNodes;

    dirtyNodes.reserve(
        commit.inserts.size() * 2 + commit.removes.size() +
        commit.creates.size() + commit.layoutProps.size());
    subtreeRoots.reserve(
        commit.inserts.size() + commit.removes.size() + commit.creates.size() +
        commit.layoutProps.size() + commit.textProps.size() + commit.textMutations.size());

    for (const auto& op : commit.inserts) {
      dirtyNodes.insert(op.childId);
      dirtyNodes.insert(op.parentId);
      subtreeRoots.insert(op.childId);
      subtreeRoots.insert(op.parentId);
    }
    for (const auto& op : commit.removes) {
      dirtyNodes.insert(op.parentId);
      subtreeRoots.insert(op.parentId);
    }
    for (const auto& op : commit.creates) {
      dirtyNodes.insert(op.nodeId);
      subtreeRoots.insert(op.nodeId);
      // New nodes must always emit frames
      forcedNodes.insert(op.nodeId);
    }
    for (const auto& op : commit.layoutProps) {
      dirtyNodes.insert(op.nodeId);
      subtreeRoots.insert(op.nodeId);
      
      // If display changed, we must force the entire subtree to emit frames.
      if (op.prop == ZynthPropId::Display) {
        forcedNodes.insert(op.nodeId);
      }
    }
    for (const auto& op : commit.textProps) {
      dirtyNodes.insert(op.nodeId);
      subtreeRoots.insert(op.nodeId);
    }
    for (const auto& op : commit.textMutations) {
      dirtyNodes.insert(op.nodeId);
      subtreeRoots.insert(op.nodeId);
    }

    // Expand: walk ancestors so we capture parent reflows
    std::vector<int32_t> seeds(dirtyNodes.begin(), dirtyNodes.end());
    for (int32_t nodeId : seeds) {
      int32_t current = nodeId;
      while (current > 0) {
        auto* record = host_->getNode(current);
        if (!record) break;
        current = record->parentId;
        if (current <= 0) break;
        if (!dirtyNodes.insert(current).second) break; // already visited
      }
    }

    // Expand: Propagate 'forced' state down the tree.
    std::vector<int32_t> forceStack(forcedNodes.begin(), forcedNodes.end());
    while (!forceStack.empty()) {
      int32_t nodeId = forceStack.back();
      forceStack.pop_back();

      auto* record = host_->getNode(nodeId);
      if (!record) continue;

      for (int32_t childId : record->children) {
        if (forcedNodes.insert(childId).second) {
          forceStack.push_back(childId);
        }
      }
    }

    // Expand: walk descendants of directly mutated roots
    std::vector<int32_t> descendantStack(subtreeRoots.begin(), subtreeRoots.end());
    descendantStack.insert(descendantStack.end(), forcedNodes.begin(), forcedNodes.end());

    while (!descendantStack.empty()) {
      const int32_t nodeId = descendantStack.back();
      descendantStack.pop_back();

      auto* record = host_->getNode(nodeId);
      if (!record) continue;

      for (int32_t childId : record->children) {
        if (dirtyNodes.insert(childId).second) {
          descendantStack.push_back(childId);
        }
      }
    }

    // Also include direct children of dirty parents
    std::vector<int32_t> parentSeeds(dirtyNodes.begin(), dirtyNodes.end());
    for (int32_t nodeId : parentSeeds) {
      auto* record = host_->getNode(nodeId);
      if (!record) continue;
      for (int32_t childId : record->children) {
        dirtyNodes.insert(childId);
      }
    }

    // Finally, ensure all forced nodes are considered dirty
    for (int32_t nodeId : forcedNodes) {
      dirtyNodes.insert(nodeId);
    }

    // Extract frames only for nodes in the dirty set
    for (int32_t nodeId : dirtyNodes) {
      auto* record = host_->getNode(nodeId);
      if (!record || !record->yoga) continue;

      float left = YGNodeLayoutGetLeft(record->yoga);
      float top = YGNodeLayoutGetTop(record->yoga);
      float width = YGNodeLayoutGetWidth(record->yoga);
      float height = YGNodeLayoutGetHeight(record->yoga);

      bool force = forcedNodes.find(nodeId) != forcedNodes.end();

      // Diff against last known frame
      if (force ||
          record->lastFrame.left != left ||
          record->lastFrame.top != top ||
          record->lastFrame.width != width ||
          record->lastFrame.height != height) {
        record->lastFrame.left = left;
        record->lastFrame.top = top;
        record->lastFrame.width = width;
        record->lastFrame.height = height;
        record->lastFrame.changed = true;

        telemetry.changedFrameCount++;
        commit.layoutFrames.push_back({nodeId, left, top, width, height});
      }
      if (YGNodeGetHasNewLayout(record->yoga)) {
        YGNodeSetHasNewLayout(record->yoga, false);
      }
    }
  }

  ZynthRendererHost* host_;
  YGConfigRef config_;
};

} // namespace zynth
