#pragma once

#include "ZynthCommit.h"
#include "ZynthProp.h"
#include "ZynthRendererTelemetry.h"

#include <yoga/Yoga.h>

#include <algorithm>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include <android/log.h>

namespace zynth {

/**
 * @brief Layout frame produced by Yoga for a single node.
 */
struct ZynthLayoutFrame {
  float left   = 0.0f;
  float top    = 0.0f;
  float width  = 0.0f;
  float height = 0.0f;
  bool changed = false;
};

/**
 * @brief Native record for a renderer node.
 *
 * C++ is the authoritative owner of topology. Kotlin's maps become
 * mirrors that are updated only via mount transactions.
 */
struct ZynthNodeRecord {
  int32_t id         = 0;
  int32_t parentId   = -1;  ///< -1 means unparented / root
  int32_t surfaceId  = 0;
  uint16_t typeId    = 0;   ///< Interned type identifier
  std::string typeName;     ///< Human-readable type (e.g., "view", "text", "image")

  bool hasMeasureFunc = false;
  bool emitsLayout    = false;  ///< True if JS listens for onLayout events

  std::vector<int32_t> children;

  ZynthLayoutFrame lastFrame;   ///< Last calculated layout frame
  
  YGNodeRef yoga = nullptr;     ///< Phase 3: Native Yoga node
  uint32_t contentRevision = 0; ///< Phase 5: Increment on text/style prop mutation
};

/**
 * @brief Native record for a renderer surface.
 */
struct ZynthSurfaceRecord {
  int32_t surfaceId   = 0;
  int32_t rootNodeId  = -1;
  float width         = 0.0f;
  float height        = 0.0f;
  uint64_t lastCommitId = 0;
  
  YGNodeRef rootYoga = nullptr; ///< Phase 3: Surface root Yoga node
};

/**
 * @brief A pending mount operation produced by commit application.
 */
struct ZynthMountOp {
  enum class Kind : uint8_t {
    Create,
    Delete,
    Reparent,
  };

  Kind kind = Kind::Create;
  int32_t nodeId    = 0;
  int32_t parentId  = 0;
  int32_t index     = 0;
  int32_t surfaceId = 0;
  std::string typeName;
};

class ZynthMeasureRegistry;

/**
 * @brief Native renderer state that owns node topology and surface assignments.
 *
 * This is the C++ authoritative representation of the view tree. Kotlin's
 * `nodes`, `parents`, `children`, `nodeSurfaces` become mirrors updated
 * only through coarse mount transactions.
 *
 * Thread safety: all methods must be called from the JS thread (Hermes).
 * Layout calculation may happen on the JS thread or a dedicated layout thread.
 */
class ZynthRendererHost {
public:
  friend class ZynthYogaTree;

  YGMeasureFunc measureFunc_ = nullptr;

  ZynthRendererHost() {
    yogaConfig_ = YGConfigNew();
  }

  ~ZynthRendererHost() {
    YGConfigFree(yogaConfig_);
  }

  YGConfigRef yogaConfig() const { return yogaConfig_; }

  /**
   * @brief Set the display density for dp-to-px conversion.
   */
  void setDensity(float density) {
    density_ = density;
  }

  float density() const { return density_; }

  /**
   * @brief Convert dp to px using the current density.
   */
  float dpToPx(float dp) const {
    return dp * density_;
  }

  bool isInlineTextChild(const ZynthNodeRecord &parent, const ZynthNodeRecord &child) const {
    return parent.typeName == "text" && child.typeName == "text";
  }

  void markMeasuredNodeDirty(ZynthNodeRecord &node) {
    node.contentRevision++;
    if (node.yoga && YGNodeHasMeasureFunc(node.yoga)) {
      YGNodeMarkDirty(node.yoga);
    }
    markSurfaceDirty(node.surfaceId);
  }

  // ---- Node lifecycle ----

  /**
   * @brief Register a new node with the given type.
   *
   * @param nodeId     Node ID assigned by Kotlin's createNode().
   * @param typeName   Component type string (e.g., "view", "text").
   * @param surfaceId  The surface this node belongs to.
   * @param hasMeasure True if the node requires a custom measure function.
   * @return true if the node was created (not a duplicate).
   */
  bool createNode(int32_t nodeId, const std::string &typeName, int32_t surfaceId, bool hasMeasure = false) {
    if (nodes_.count(nodeId)) return false;

    ZynthNodeRecord record;
    record.id = nodeId;
    record.surfaceId = surfaceId;
    record.typeName = typeName;
    record.typeId = internType(typeName);
    record.hasMeasureFunc =
        hasMeasure || typeName == "text" || typeName == "textInput" ||
        typeName == "text-input" || typeName == "secure-text-input";
    
    // Phase 3: Allocate native Yoga node
    record.yoga = YGNodeNewWithConfig(yogaConfig_);
    YGNodeSetContext(record.yoga, reinterpret_cast<void*>(static_cast<intptr_t>(nodeId)));
    if (record.hasMeasureFunc && measureFunc_) {
      YGNodeSetMeasureFunc(record.yoga, measureFunc_);
    }
    
    nodes_[nodeId] = std::move(record);
    nodeSurfaces_[nodeId] = surfaceId;
    return true;
  }

  /**
   * @brief Remove a node and clean up all references.
   */
  void dropNode(int32_t nodeId) {
    auto it = nodes_.find(nodeId);
    if (it == nodes_.end()) return;

    auto &record = it->second;

    // Remove from parent's children list
    if (record.parentId >= 0) {
      auto parentIt = nodes_.find(record.parentId);
      if (parentIt != nodes_.end()) {
        auto &siblings = parentIt->second.children;
        siblings.erase(
            std::remove(siblings.begin(), siblings.end(), nodeId),
            siblings.end());
      }
    }

    // Recursively drop children
    auto childrenCopy = record.children;
    for (int32_t childId : childrenCopy) {
      dropNode(childId);
    }

    // Phase 3: Free native Yoga node
    if (record.yoga) {
      if (YGNodeGetParent(record.yoga)) {
        YGNodeRemoveChild(YGNodeGetParent(record.yoga), record.yoga);
      }
      YGNodeFree(record.yoga);
      record.yoga = nullptr;
    }

    nodeSurfaces_.erase(nodeId);
    layoutNodes_.erase(nodeId);
    nodes_.erase(it);
  }

  /**
   * @brief Insert a child node at the given index.
   */
  void insertChild(int32_t parentId, int32_t childId, int32_t index) {
    auto childIt = nodes_.find(childId);
    if (childIt == nodes_.end()) return;

    auto parentIt = nodes_.find(parentId);
    auto surfaceIt = surfaces_.find(parentId);
    const bool parentIsSurfaceRoot = parentIt == nodes_.end() && surfaceIt != surfaces_.end();
    if (parentIt == nodes_.end() && !parentIsSurfaceRoot) return;

    auto &child = childIt->second;
    ZynthNodeRecord *parent = parentIt != nodes_.end() ? &parentIt->second : nullptr;
    const bool inlineTextChild = parent != nullptr && isInlineTextChild(*parent, child);

    // Remove from old parent first
    if (child.parentId >= 0 && child.parentId != parentId) {
      auto oldParentIt = nodes_.find(child.parentId);
      if (oldParentIt != nodes_.end()) {
        auto &siblings = oldParentIt->second.children;
        siblings.erase(
            std::remove(siblings.begin(), siblings.end(), childId),
            siblings.end());
        if (!isInlineTextChild(oldParentIt->second, child) &&
            oldParentIt->second.yoga && child.yoga &&
            YGNodeGetParent(child.yoga) == oldParentIt->second.yoga) {
          YGNodeRemoveChild(oldParentIt->second.yoga, child.yoga);
        }
      } else {
        auto oldSurfaceIt = surfaces_.find(child.parentId);
        if (oldSurfaceIt != surfaces_.end() && child.yoga &&
            YGNodeGetParent(child.yoga) == oldSurfaceIt->second.rootYoga) {
          YGNodeRemoveChild(oldSurfaceIt->second.rootYoga, child.yoga);
        }
      }
    }

    auto &children = parent != nullptr ? parent->children : surfaceChildren_[parentId];

    // Remove from this parent if already present (re-order case)
    children.erase(
        std::remove(children.begin(), children.end(), childId),
        children.end());

    // Insert at index
    const auto idx = static_cast<size_t>(index);
    if (idx >= children.size()) {
      children.push_back(childId);
    } else {
      children.insert(children.begin() + static_cast<ptrdiff_t>(idx), childId);
    }

    child.parentId = parentId;

    // Phase 3: Update Yoga tree topology
    //
    // Yoga requires a child to be detached before insertion, including simple
    // same-parent reorders. Virtualized lists hit that path constantly.
    YGNodeRef targetYogaParent = nullptr;
    if (inlineTextChild) {
      if (child.yoga && YGNodeGetParent(child.yoga)) {
        YGNodeRemoveChild(YGNodeGetParent(child.yoga), child.yoga);
      }
      markMeasuredNodeDirty(*parent);
    } else if (parent != nullptr && parent->yoga && child.yoga) {
      targetYogaParent = parent->yoga;
    } else if (parentIsSurfaceRoot && child.yoga && surfaceIt->second.rootYoga) {
      targetYogaParent = surfaceIt->second.rootYoga;
    } else if (parentId <= 0 && child.yoga) {
      // If parentId <= 0, attach to surface root
      int32_t surfaceId = child.surfaceId;
      auto surfIt = surfaces_.find(surfaceId);
      if (surfIt != surfaces_.end() && surfIt->second.rootYoga) {
        targetYogaParent = surfIt->second.rootYoga;
      }
    }
    if (targetYogaParent && child.yoga) {
      if (YGNodeGetParent(child.yoga)) {
        YGNodeRemoveChild(YGNodeGetParent(child.yoga), child.yoga);
      }
      const uint32_t yogaIndex =
          std::min<uint32_t>(static_cast<uint32_t>(idx), YGNodeGetChildCount(targetYogaParent));
      YGNodeInsertChild(targetYogaParent, child.yoga, yogaIndex);
    }

    // Propagate surface from parent
    const int32_t parentSurface = parent != nullptr ? parent->surfaceId : parentId;
    if (child.surfaceId != parentSurface) {
      propagateSurface(childId, parentSurface);
    }
  }

  /**
   * @brief Remove a child from its parent.
   */
  void removeChild(int32_t parentId, int32_t childId) {
    auto parentIt = nodes_.find(parentId);
    auto surfaceIt = surfaces_.find(parentId);
    const bool parentIsSurfaceRoot = parentIt == nodes_.end() && surfaceIt != surfaces_.end();
    if (parentIt == nodes_.end() && !parentIsSurfaceRoot) return;

    ZynthNodeRecord *parent = parentIt != nodes_.end() ? &parentIt->second : nullptr;
    auto &children = parent != nullptr ? parent->children : surfaceChildren_[parentId];
    children.erase(
        std::remove(children.begin(), children.end(), childId),
        children.end());

    auto childIt = nodes_.find(childId);
    if (childIt != nodes_.end()) {
      const bool inlineTextChild = parent != nullptr && isInlineTextChild(*parent, childIt->second);
      childIt->second.parentId = -1;
      
      // Phase 3: Update Yoga tree topology
      if (inlineTextChild) {
        markMeasuredNodeDirty(*parent);
      } else if (parent != nullptr && parent->yoga && childIt->second.yoga &&
                 YGNodeGetParent(childIt->second.yoga) == parent->yoga) {
        YGNodeRemoveChild(parent->yoga, childIt->second.yoga);
      } else if (parentIsSurfaceRoot && childIt->second.yoga &&
                 YGNodeGetParent(childIt->second.yoga) == surfaceIt->second.rootYoga) {
        YGNodeRemoveChild(surfaceIt->second.rootYoga, childIt->second.yoga);
      } else if (parentId <= 0 && childIt->second.yoga) {
        int32_t surfaceId = childIt->second.surfaceId;
        auto surfIt = surfaces_.find(surfaceId);
        if (surfIt != surfaces_.end() && surfIt->second.rootYoga) {
          YGNodeRemoveChild(surfIt->second.rootYoga, childIt->second.yoga);
        }
      }
    }
  }

  // ---- Surface management ----

  /**
   * @brief Set the active surface for subsequent node operations.
   */
  void setActiveSurface(int32_t surfaceId) {
    activeSurfaceId_ = surfaceId;
  }

  int32_t activeSurfaceId() const { return activeSurfaceId_; }

  /**
   * @brief Register or update a surface.
   */
  void registerSurface(int32_t surfaceId, float width, float height) {
    __android_log_print(ANDROID_LOG_DEBUG, "ZynthHost", "registerSurface %d: %.1fx%.1f", surfaceId, width, height);
    auto &surface = surfaces_[surfaceId];
    surface.surfaceId = surfaceId;
    surface.width = width;
    surface.height = height;
    
    // Phase 3: Allocate root Yoga node for surface
    if (!surface.rootYoga) {
      surface.rootYoga = YGNodeNewWithConfig(yogaConfig_);
      YGNodeStyleSetFlexDirection(surface.rootYoga, YGFlexDirectionColumn);
      YGNodeStyleSetAlignItems(surface.rootYoga, YGAlignStretch);
    }
    
    // Root dimensions are usually points/dp. They come from Kotlin layout constraints.
    YGNodeStyleSetWidth(surface.rootYoga, dpToPx(width));
    YGNodeStyleSetHeight(surface.rootYoga, dpToPx(height));

    markSurfaceDirty(surfaceId);
  }

  /**
   * @brief Remove a surface and all its nodes.
   */
  void unregisterSurface(int32_t surfaceId) {
    // Collect nodes belonging to this surface
    std::vector<int32_t> toRemove;
    for (const auto &pair : nodeSurfaces_) {
      if (pair.second == surfaceId) {
        toRemove.push_back(pair.first);
      }
    }
    for (int32_t nodeId : toRemove) {
      dropNode(nodeId);
    }
    
    auto it = surfaces_.find(surfaceId);
    if (it != surfaces_.end()) {
      if (it->second.rootYoga) {
        YGNodeFree(it->second.rootYoga);
      }
      surfaces_.erase(it);
    }
    
    dirtySurfaces_.erase(surfaceId);
  }

  /**
   * @brief Mark a surface as needing layout recalculation.
   */
  void markSurfaceDirty(int32_t surfaceId) {
    dirtySurfaces_.insert(surfaceId);
  }

  /**
   * @brief Mark the surface containing the given node as dirty.
   */
  void markSurfaceDirtyForNode(int32_t nodeId) {
    auto it = nodeSurfaces_.find(nodeId);
    int32_t surfaceId = (it != nodeSurfaces_.end()) ? it->second : activeSurfaceId_;
    dirtySurfaces_.insert(surfaceId);
  }

  const std::unordered_set<int32_t> &dirtySurfaces() const {
    return dirtySurfaces_;
  }

  void clearDirtySurfaces() {
    dirtySurfaces_.clear();
  }

  // ---- Layout event tracking ----

  /**
   * @brief Register a node as emitting layout events.
   */
  void setEmitsLayout(int32_t nodeId, bool emits) {
    auto it = nodes_.find(nodeId);
    if (it != nodes_.end()) {
      it->second.emitsLayout = emits;
      if (emits) {
        layoutNodes_.insert(nodeId);
      } else {
        layoutNodes_.erase(nodeId);
      }
    }
  }

  const std::unordered_set<int32_t> &layoutNodes() const {
    return layoutNodes_;
  }

  // ---- Commit application ----

  /**
   * @brief Apply a decoded commit to native state.
   *
   * Updates topology (inserts/removes/drops/surfaces), but does NOT
   * apply props or calculate layout. Those are handled by downstream stages.
   *
   * @param commit The decoded commit from ZynthCommitDecoder.
   * @param telemetry Telemetry struct to record timing.
   */
  void applyCommitTopology(const ZynthCommit &commit, ZynthCommitTelemetry &telemetry) {
    ZynthPhaseTimer timer(telemetry.commitApplyUs);

    // Apply surface switches
    for (const auto &op : commit.surfaces) {
      setActiveSurface(op.surfaceId);
    }

    // Apply creates
    for (const auto &op : commit.creates) {
      const std::string &type = (op.typeStringIndex < commit.stringTable.size()) 
          ? commit.stringTable[op.typeStringIndex] : "";
      createNode(op.nodeId, type, activeSurfaceId_, op.hasMeasure);
      markSurfaceDirty(activeSurfaceId_);
      telemetry.mutatedNodeCount++;
    }

    // Apply removes
    for (const auto &op : commit.removes) {
      removeChild(op.parentId, op.childId);
      markSurfaceDirtyForNode(op.parentId);
      telemetry.mutatedNodeCount++;
    }

    // Apply inserts
    for (const auto &op : commit.inserts) {
      insertChild(op.parentId, op.childId, op.index);
      markSurfaceDirtyForNode(op.parentId);
      telemetry.mutatedNodeCount++;
    }

    // Apply drops
    for (const auto &op : commit.drops) {
      int32_t surfaceId = surfaceForNode(op.nodeId);
      dropNode(op.nodeId);
      markSurfaceDirty(surfaceId);
      telemetry.mutatedNodeCount++;
    }

    // Mark dirty surfaces for layout
    // Any node that had a layout prop changed needs its surface marked dirty
    for (const auto &mut : commit.layoutProps) {
      markSurfaceDirtyForNode(mut.nodeId);
    }
    for (const auto &mut : commit.textProps) {
      auto* node = getNode(mut.nodeId);
      if (node) markMeasuredNodeDirty(*node);
    }
    for (const auto &tm : commit.textMutations) {
      auto* node = getNode(tm.nodeId);
      if (node) markMeasuredNodeDirty(*node);
    }

    telemetry.dirtySurfaceCount = static_cast<uint32_t>(dirtySurfaces_.size());
  }

  // ---- Query interface ----

  /**
   * @brief Get a node record by ID.
   * @return Pointer to node record, or nullptr if not found.
   */
  ZynthNodeRecord *getNode(int32_t nodeId) {
    auto it = nodes_.find(nodeId);
    return (it != nodes_.end()) ? &it->second : nullptr;
  }

  const ZynthNodeRecord *getNode(int32_t nodeId) const {
    auto it = nodes_.find(nodeId);
    return (it != nodes_.end()) ? &it->second : nullptr;
  }

  /**
   * @brief Get surface for a node.
   */
  int32_t surfaceForNode(int32_t nodeId) const {
    auto it = nodeSurfaces_.find(nodeId);
    return (it != nodeSurfaces_.end()) ? it->second : activeSurfaceId_;
  }

  /**
   * @brief Get total node count.
   */
  size_t nodeCount() const { return nodes_.size(); }

  /**
   * @brief Get total surface count.
   */
  size_t surfaceCount() const { return surfaces_.size(); }

  /**
   * @brief Check if a node exists.
   */
  bool hasNode(int32_t nodeId) const {
    return nodes_.count(nodeId) > 0;
  }

  /**
   * @brief Get the parent ID for a node (-1 if unparented).
   */
  int32_t parentOf(int32_t nodeId) const {
    auto it = nodes_.find(nodeId);
    return (it != nodes_.end()) ? it->second.parentId : -1;
  }

  /**
   * @brief Get children of a node.
   */
  const std::vector<int32_t> *childrenOf(int32_t nodeId) const {
    auto it = nodes_.find(nodeId);
    return (it != nodes_.end()) ? &it->second.children : nullptr;
  }

  /**
   * @brief Print a debug tree dump via __android_log_print.
   */
  void debugDumpTree() const {
#ifndef NDEBUG
    __android_log_print(ANDROID_LOG_DEBUG, "ZynthTree",
                        "=== Renderer Tree: %zu nodes, %zu surfaces ===",
                        nodes_.size(), surfaces_.size());
    for (const auto &pair : surfaces_) {
      const auto &surface = pair.second;
      __android_log_print(ANDROID_LOG_DEBUG, "ZynthTree",
                          "  Surface %d: %.0fx%.0f root=%d lastCommit=%llu",
                          surface.surfaceId, surface.width, surface.height,
                          surface.rootNodeId,
                          static_cast<unsigned long long>(surface.lastCommitId));
    }
    for (const auto &pair : nodes_) {
      const auto &node = pair.second;
      __android_log_print(ANDROID_LOG_DEBUG, "ZynthTree",
                          "  Node %d: type=%s parent=%d surface=%d children=%zu "
                          "frame=(%.1f,%.1f,%.1f,%.1f) measure=%d layout=%d",
                          node.id, node.typeName.c_str(), node.parentId,
                          node.surfaceId, node.children.size(),
                          node.lastFrame.left, node.lastFrame.top,
                          node.lastFrame.width, node.lastFrame.height,
                          node.hasMeasureFunc ? 1 : 0,
                          node.emitsLayout ? 1 : 0);
    }
#endif
  }

private:
  /**
   * @brief Propagate surface assignment to a subtree.
   */
  void propagateSurface(int32_t nodeId, int32_t surfaceId) {
    auto it = nodes_.find(nodeId);
    if (it == nodes_.end()) return;

    it->second.surfaceId = surfaceId;
    nodeSurfaces_[nodeId] = surfaceId;

    for (int32_t childId : it->second.children) {
      propagateSurface(childId, surfaceId);
    }
  }

  /**
   * @brief Intern a type name to a numeric ID.
   */
  uint16_t internType(const std::string &typeName) {
    auto it = typeTable_.find(typeName);
    if (it != typeTable_.end()) return it->second;
    uint16_t id = static_cast<uint16_t>(typeTable_.size() + 1);
    typeTable_[typeName] = id;
    return id;
  }

  float density_ = 1.0f;
  int32_t activeSurfaceId_ = 0;

  std::unordered_map<int32_t, ZynthNodeRecord> nodes_;
  std::unordered_map<int32_t, ZynthSurfaceRecord> surfaces_;
  std::unordered_map<int32_t, int32_t> nodeSurfaces_;  ///< nodeId -> surfaceId
  std::unordered_map<int32_t, std::vector<int32_t>> surfaceChildren_; ///< surfaceId -> root child ids
  std::unordered_set<int32_t> dirtySurfaces_;
  std::unordered_set<int32_t> layoutNodes_;  ///< Nodes that emit onLayout events
  std::unordered_map<std::string, uint16_t> typeTable_;  ///< type name -> typeId
  YGConfigRef yogaConfig_ = nullptr;
};

} // namespace zynth
