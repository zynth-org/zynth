#pragma once

#include "ZynthProp.h"
#include "ZynthRendererTelemetry.h"

#include <cstdint>
#include <string>
#include <vector>

namespace zynth {

/**
 * @brief A decoded setProp mutation from the typed payload.
 */
struct ZynthPropMutation {
  int32_t nodeId = 0;
  ZynthPropId prop = ZynthPropId::Unknown;
  ZynthPropClass propClass = ZynthPropClass::Descriptor;
  ZynthPropValue value;
  int32_t keyToken = 0;
};

/**
 * @brief A decoded setText operation.
 */
struct ZynthTextMutation {
  int32_t nodeId = 0;
  uint32_t textStringIndex = 0; ///< Index into string table
};

/**
 * @brief A decoded insertChild operation.
 */
struct ZynthInsertOp {
  int32_t parentId = 0;
  int32_t childId = 0;
  int32_t index = 0;
};

/**
 * @brief A decoded removeChild operation.
 */
struct ZynthRemoveOp {
  int32_t parentId = 0;
  int32_t childId = 0;
};

/**
 * @brief A decoded dropNode operation.
 */
struct ZynthDropOp {
  int32_t nodeId = 0;
};

/**
 * @brief A decoded createNode operation.
 */
struct ZynthCreateOp {
  int32_t nodeId = 0;
  uint32_t typeStringIndex = 0; ///< Index into string table
  bool hasMeasure = false;
};

/**
 * @brief A decoded setSurface operation.
 */
struct ZynthSurfaceOp {
  int32_t surfaceId = 0;
};

/**
 * @brief A layout frame calculated by Yoga.
 */
struct ZynthMountFrame {
  int32_t nodeId = 0;
  float left = 0.0f;
  float top = 0.0f;
  float width = 0.0f;
  float height = 0.0f;
};

/**
 * @brief Immutable native commit artifact produced by ZynthCommitDecoder.
 *
 * Contains all decoded renderer operations from a single JS batch,
 * organized by operation type and prop classification for efficient
 * downstream processing.
 *
 * The string table is stored by reference (indices) — the actual strings
 * remain in the original payload or are copied once at decode time.
 */
struct ZynthCommit {
  uint64_t commitId = 0;

  // Decoded operation records
  std::vector<ZynthPropMutation> layoutProps;      ///< Props classified as layout
  std::vector<ZynthPropMutation> viewProps;         ///< Props classified as view
  std::vector<ZynthPropMutation> textProps;         ///< Props classified as text/intrinsic
  std::vector<ZynthPropMutation> descriptorProps;   ///< Props classified as component-specific
  std::vector<ZynthTextMutation> textMutations;     ///< setText ops
  std::vector<ZynthCreateOp> creates;               ///< createNode ops
  std::vector<ZynthInsertOp> inserts;               ///< insertChild ops
  std::vector<ZynthRemoveOp> removes;               ///< removeChild ops
  std::vector<ZynthDropOp> drops;                   ///< dropNode ops
  std::vector<ZynthSurfaceOp> surfaces;             ///< setSurface ops
  std::vector<ZynthMountFrame> layoutFrames;        ///< layout frames

  // String table (copied from JS payload during decode)
  std::vector<std::string> stringTable;

  // Telemetry for this commit
  ZynthCommitTelemetry telemetry;

  /**
   * @brief Total number of decoded operations across all categories.
   */
  uint32_t totalOpCount() const {
    return static_cast<uint32_t>(
        layoutProps.size() + viewProps.size() + textProps.size() +
        descriptorProps.size() + textMutations.size() + creates.size() +
        inserts.size() + removes.size() + drops.size() + surfaces.size());
  }

  /**
   * @brief Reserve capacity based on expected op count.
   */
  void reserveForOpCount(size_t estimatedOps) {
    // Heuristic: most ops are setProp; split across categories
    const size_t propEstimate = estimatedOps * 3 / 4;
    layoutProps.reserve(propEstimate / 2);
    viewProps.reserve(propEstimate / 4);
    textProps.reserve(propEstimate / 8);
    descriptorProps.reserve(propEstimate / 8);
    textMutations.reserve(estimatedOps / 8);
    creates.reserve(estimatedOps / 8);
    inserts.reserve(estimatedOps / 8);
    removes.reserve(estimatedOps / 16);
    drops.reserve(estimatedOps / 16);
  }

  /**
   * @brief Clear all records. Preserves capacity.
   */
  void clear() {
    commitId = 0;
    layoutProps.clear();
    viewProps.clear();
    textProps.clear();
    descriptorProps.clear();
    textMutations.clear();
    creates.clear();
    inserts.clear();
    removes.clear();
    drops.clear();
    surfaces.clear();
    layoutFrames.clear();
    stringTable.clear();
    telemetry = {};
  }
};

} // namespace zynth
