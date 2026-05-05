#pragma once

#include "ZynthCommit.h"
#include "ZynthProp.h"
#include "ZynthRendererTelemetry.h"

#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

namespace zynth {

/**
 * @brief Decodes a typed op buffer (DoubleArray or ArrayBuffer) into a
 *        native ZynthCommit.
 *
 * The payload layout matches the JS renderer's typed batch encoding:
 *   setProp:     [1, nodeId, keyToken, valueType, payload]  (5 doubles)
 *   setText:     [2, nodeId, stringIndex]                   (3 doubles)
 *   insertChild: [3, parentId, childId, index]              (4 doubles)
 *   removeChild: [4, parentId, childId]                     (3 doubles)
 *   dropNode:    [5, nodeId]                                (2 doubles)
 *   createNode:  [6, nodeId, typeStringIndex, hasMeasure]   (4 doubles)
 *   setSurface:  [7, surfaceId]                             (2 doubles)
 *
 * Key tokens: negative values map to well-known ZynthPropId via -keyToken.
 * Positive values index into the string table.
 */
class ZynthCommitDecoder {
public:
  /**
   * @brief Decode a double-array payload into a ZynthCommit.
   *
   * @param ops      Pointer to the ops array (doubles).
   * @param opCount  Number of doubles in the ops array.
   * @param strings  String table decoded from the JS payload.
   * @param commitId Monotonic commit identifier.
   * @param commit   Output commit structure (will be cleared first).
   * @return true if decoding completed without fatal errors.
   */
  static bool decode(
      const double *ops,
      size_t opCount,
      const std::vector<std::string> &strings,
      uint64_t commitId,
      ZynthCommit &commit) {

    commit.clear();
    commit.commitId = commitId;
    commit.stringTable = strings;
    commit.telemetry.commitId = commitId;

    // Reserve based on estimated op count (each op is 2-5 doubles)
    const size_t estimatedOps = opCount / 3;
    commit.reserveForOpCount(estimatedOps);

    size_t i = 0;
    while (i < opCount) {
      const auto opcode = static_cast<int32_t>(ops[i++]);

      switch (opcode) {
        case 1: { // setProp: [nodeId, keyToken, valueType, payload]
          if (i + 4 > opCount) goto done;
          const auto nodeId    = static_cast<int32_t>(ops[i++]);
          const auto keyToken  = static_cast<int32_t>(ops[i++]);
          const auto valueType = static_cast<int32_t>(ops[i++]);
          const double payload = ops[i++];

          ZynthPropMutation mut;
          mut.nodeId = nodeId;
          mut.keyToken = keyToken;

          // Resolve prop ID
          if (keyToken < 0) {
            const auto propId = static_cast<uint16_t>(-keyToken);
            mut.prop = static_cast<ZynthPropId>(propId);
          } else {
            // Positive token: string-table prop name (component-specific)
            mut.prop = ZynthPropId::Unknown;
          }

          // Decode value
          mut.value.kind = static_cast<ZynthValueKind>(valueType);
          if (mut.value.kind == ZynthValueKind::Number) {
            mut.value.number = payload;
          } else if (mut.value.kind == ZynthValueKind::String) {
            mut.value.stringIndex = static_cast<uint32_t>(payload);

            if (mut.value.stringIndex < strings.size()) {
              const std::string& str = strings[mut.value.stringIndex];

              // Safety net for callers still transporting typed layout values as strings.
              if (str == "auto") {
                mut.value.kind = ZynthValueKind::Auto;
                mut.value.number = 0.0;
              } else if (!str.empty() && str.back() == '%') {
                const std::string numeric = str.substr(0, str.size() - 1);
                char* endPtr = nullptr;
                const double percent = std::strtod(numeric.c_str(), &endPtr);
                if (endPtr != numeric.c_str() && endPtr && *endPtr == '\0') {
                  mut.value.kind = ZynthValueKind::Percent;
                  mut.value.number = percent;
                }
              }

              // Map known Yoga enums if they are strings
              if (mut.value.kind == ZynthValueKind::String &&
                  (mut.prop == ZynthPropId::JustifyContent || 
                   mut.prop == ZynthPropId::AlignItems || 
                   mut.prop == ZynthPropId::AlignSelf || 
                   mut.prop == ZynthPropId::AlignContent ||
                   mut.prop == ZynthPropId::FlexDirection ||
                   mut.prop == ZynthPropId::FlexWrap ||
                   mut.prop == ZynthPropId::Position ||
                   mut.prop == ZynthPropId::Display ||
                   mut.prop == ZynthPropId::Overflow)) {
                double enumVal = -1.0;
                
                if (mut.prop == ZynthPropId::JustifyContent) {
                    if (str == "flex-start") enumVal = 0.0;
                    else if (str == "center") enumVal = 1.0;
                    else if (str == "flex-end") enumVal = 2.0;
                    else if (str == "space-between") enumVal = 3.0;
                    else if (str == "space-around") enumVal = 4.0;
                    else if (str == "space-evenly") enumVal = 5.0;
                } else if (mut.prop == ZynthPropId::AlignItems || mut.prop == ZynthPropId::AlignSelf || mut.prop == ZynthPropId::AlignContent) {
                    if (str == "auto") enumVal = 0.0;
                    else if (str == "flex-start") enumVal = 1.0;
                    else if (str == "center") enumVal = 2.0;
                    else if (str == "flex-end") enumVal = 3.0;
                    else if (str == "stretch") enumVal = 4.0;
                    else if (str == "baseline") enumVal = 5.0;
                    else if (str == "space-between") enumVal = 6.0;
                    else if (str == "space-around") enumVal = 7.0;
                } else if (mut.prop == ZynthPropId::FlexDirection) {
                    if (str == "column") enumVal = 0.0;
                    else if (str == "column-reverse") enumVal = 1.0;
                    else if (str == "row") enumVal = 2.0;
                    else if (str == "row-reverse") enumVal = 3.0;
                } else if (mut.prop == ZynthPropId::FlexWrap) {
                    if (str == "nowrap") enumVal = 0.0;
                    else if (str == "wrap") enumVal = 1.0;
                    else if (str == "wrap-reverse") enumVal = 2.0;
                } else if (mut.prop == ZynthPropId::Position) {
                    if (str == "static") enumVal = 0.0;
                    else if (str == "relative") enumVal = 1.0;
                    else if (str == "absolute") enumVal = 2.0;
                } else if (mut.prop == ZynthPropId::Display) {
                    if (str == "flex") enumVal = 0.0;
                    else if (str == "none") enumVal = 1.0;
                } else if (mut.prop == ZynthPropId::Overflow) {
                    if (str == "visible") enumVal = 0.0;
                    else if (str == "hidden") enumVal = 1.0;
                    else if (str == "scroll") enumVal = 2.0;
                }
                
                if (enumVal != -1.0) {
                    mut.value.kind = ZynthValueKind::Number;
                    mut.value.number = enumVal;
                }
              }
            }
          } else if (mut.value.kind == ZynthValueKind::Bool) {
            mut.value.number = payload;
          } else if (mut.value.kind == ZynthValueKind::Percent) {
            mut.value.number = payload;
          } else if (mut.value.kind == ZynthValueKind::Auto) {
            mut.value.number = 0.0;
          }

          // Classify and route
          if (mut.prop == ZynthPropId::Unknown) {
            mut.propClass = ZynthPropClass::Descriptor;
            commit.descriptorProps.push_back(mut);
            commit.telemetry.descriptorPropCount++;
          } else {
            mut.propClass = classifyProp(mut.prop);
            switch (mut.propClass) {
              case ZynthPropClass::Layout:
                commit.layoutProps.push_back(mut);
                commit.telemetry.layoutPropCount++;
                break;
              case ZynthPropClass::View:
                commit.viewProps.push_back(mut);
                commit.telemetry.viewPropCount++;
                break;
              case ZynthPropClass::Text:
                commit.textProps.push_back(mut);
                commit.telemetry.textPropCount++;
                break;
              case ZynthPropClass::Descriptor:
                commit.descriptorProps.push_back(mut);
                commit.telemetry.descriptorPropCount++;
                break;
            }
          }
          commit.telemetry.setPropCount++;
          break;
        }

        case 2: { // setText: [nodeId, stringIndex]
          if (i + 2 > opCount) goto done;
          ZynthTextMutation mut;
          mut.nodeId = static_cast<int32_t>(ops[i++]);
          mut.textStringIndex = static_cast<uint32_t>(ops[i++]);
          commit.textMutations.push_back(mut);
          commit.telemetry.setTextCount++;
          break;
        }

        case 3: { // insertChild: [parentId, childId, index]
          if (i + 3 > opCount) goto done;
          ZynthInsertOp op;
          op.parentId = static_cast<int32_t>(ops[i++]);
          op.childId  = static_cast<int32_t>(ops[i++]);
          op.index    = static_cast<int32_t>(ops[i++]);
          commit.inserts.push_back(op);
          commit.telemetry.insertCount++;
          break;
        }

        case 4: { // removeChild: [parentId, childId]
          if (i + 2 > opCount) goto done;
          ZynthRemoveOp op;
          op.parentId = static_cast<int32_t>(ops[i++]);
          op.childId  = static_cast<int32_t>(ops[i++]);
          commit.removes.push_back(op);
          commit.telemetry.removeCount++;
          break;
        }

        case 5: { // dropNode: [nodeId]
          if (i + 1 > opCount) goto done;
          ZynthDropOp op;
          op.nodeId = static_cast<int32_t>(ops[i++]);
          commit.drops.push_back(op);
          commit.telemetry.dropCount++;
          break;
        }

        case 6: { // createNode: [nodeId, typeStringIndex, hasMeasure]
          if (i + 3 > opCount) goto done;
          ZynthCreateOp op;
          op.nodeId = static_cast<int32_t>(ops[i++]);
          op.typeStringIndex = static_cast<uint32_t>(ops[i++]);
          op.hasMeasure = ops[i++] != 0.0;
          commit.creates.push_back(op);
          commit.telemetry.createCount++;
          break;
        }

        case 7: { // setSurface: [surfaceId]
          if (i + 1 > opCount) goto done;
          ZynthSurfaceOp op;
          op.surfaceId = static_cast<int32_t>(ops[i++]);
          commit.surfaces.push_back(op);
          commit.telemetry.surfaceCount++;
          break;
        }

        default:
          // Unknown opcode — stop processing to avoid misalignment
          goto done;
      }
    }

done:
    commit.telemetry.opCount = commit.totalOpCount();
    return true;
  }

  /**
   * @brief Decode from a byte buffer (direct ArrayBuffer data).
   *
   * The buffer contains doubles in native byte order, same layout as
   * the DoubleArray variant.
   */
  static bool decodeFromBuffer(
      const uint8_t *data,
      size_t byteLength,
      const std::vector<std::string> &strings,
      uint64_t commitId,
      ZynthCommit &commit) {

    if (byteLength == 0 || (byteLength % sizeof(double) != 0)) {
      commit.clear();
      commit.commitId = commitId;
      commit.telemetry.commitId = commitId;
      return true;
    }

    const size_t opCount = byteLength / sizeof(double);
    // The buffer may not be aligned for double access, so copy to aligned storage
    std::vector<double> ops(opCount);
    std::memcpy(ops.data(), data, opCount * sizeof(double));

    return decode(ops.data(), opCount, strings, commitId, commit);
  }
};

} // namespace zynth
