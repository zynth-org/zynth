#pragma once

#include <cstddef>
#include <cstdint>

struct EngineBase;
struct AxonLayoutResult {
  float x;
  float y;
  float width;
  float height;
};
struct AxonTextMetrics {
  float width;
  float height;
};
struct AxonLayoutConstraintSample {
  std::uint32_t available_width_bits;
  std::uint32_t available_height_bits;
  std::uint32_t known_width_bits;
  std::uint32_t known_height_bits;
  std::uint32_t flags;
};
struct AxonComputeStats {
  std::uint64_t total_time_ns;
  std::uint64_t node_count;
  std::uint64_t layout_node_calls;
  std::uint64_t layout_cache_hits;
  std::uint64_t layout_cache_misses;
  std::uint64_t min_content_cache_hits;
  std::uint64_t min_content_cache_misses;
  std::uint64_t intrinsic_measure_calls;
  std::uint64_t intrinsic_text_calls;
  std::uint64_t intrinsic_host_calls;
  std::uint64_t prepare_calls;
  std::uint64_t prepare_cache_hits;
  std::uint64_t prepare_cache_misses;
  std::uint64_t prepare_time_ns;
  std::uint64_t layout_calls;
  std::uint64_t layout_time_ns;
  std::uint64_t min_content_calls;
  std::uint64_t min_content_time_ns;
  std::uint64_t setup_cache_hits;
  std::uint64_t setup_cache_misses;
  std::uint64_t segment_cache_hits;
  std::uint64_t segment_cache_misses;
  std::uint64_t host_measure_calls;
  std::uint64_t host_measure_time_ns;
  std::uint64_t prepared_segments;
  std::uint64_t prepared_bytes;
  std::uint32_t top_layout_node_ids[3];
  std::uint64_t top_layout_node_counts[3];
  std::uint64_t top_layout_constraint_unique_counts[3];
  AxonLayoutConstraintSample top_layout_constraint_samples[3][3];
  std::uint32_t top_min_content_node_ids[3];
  std::uint64_t top_min_content_node_counts[3];
};

typedef bool (*AxonHostMeasureTextFn)(
    void *user_data,
    std::uint32_t font_id,
    const std::uint8_t *text,
    std::size_t len,
    bool is_vertical,
    AxonTextMetrics *out_metrics);
typedef bool (*AxonHostMeasureNodeFn)(
    void *user_data,
    std::uint32_t node_id,
    float width,
    std::uint32_t width_mode,
    float height,
    std::uint32_t height_mode,
    AxonTextMetrics *out_metrics);

#ifndef ZYNTH_AXON_LINKED
#define ZYNTH_AXON_LINKED 0
#endif

#if ZYNTH_AXON_LINKED
extern "C" {
EngineBase *axon_engine_new();
void axon_engine_free(EngineBase *engine);
std::size_t axon_node_create(EngineBase *engine, const void *style);
bool axon_node_insert_child(EngineBase *engine, std::size_t parent, std::size_t child, std::size_t index);
bool axon_node_remove_child(EngineBase *engine, std::size_t parent, std::size_t child);
bool axon_node_set_measure_text(EngineBase *engine, std::size_t node, const char *text, std::size_t font_id);
bool axon_font_invalidate_cache(EngineBase *engine, std::uint32_t font_id);
bool axon_node_set_measure_callback(EngineBase *engine, std::size_t node, bool enabled);
bool axon_node_style_set_number(EngineBase *engine, std::size_t node, std::uint32_t prop, float value);
bool axon_node_style_set_string(EngineBase *engine, std::size_t node, std::uint32_t prop, const char *value);
bool axon_compute_layout(EngineBase *engine, std::size_t root, float width, float height);
bool axon_get_last_compute_stats(EngineBase *engine, AxonComputeStats *out_stats);
AxonLayoutResult axon_get_layout(EngineBase *engine, std::size_t node);
std::uint32_t axon_font_register_resolved(
    EngineBase *engine,
    const char *family,
    std::uint16_t weight,
    bool italic,
    float size_px);
std::uint32_t axon_font_prewarm_resolved(
    EngineBase *engine,
    const char *family,
    std::uint16_t weight,
    bool italic,
    float size_px);
bool axon_text_set_measure_callback(
    EngineBase *engine,
    AxonHostMeasureTextFn callback,
    void *user_data);
bool axon_node_set_measurement_callback(
    EngineBase *engine,
    AxonHostMeasureNodeFn callback,
    void *user_data);
}
#else
inline EngineBase *axon_engine_new() { return nullptr; }
inline void axon_engine_free(EngineBase *) {}
inline std::size_t axon_node_create(EngineBase *, const void *) { return std::size_t(-1); }
inline bool axon_node_insert_child(EngineBase *, std::size_t, std::size_t, std::size_t) { return false; }
inline bool axon_node_remove_child(EngineBase *, std::size_t, std::size_t) { return false; }
inline bool axon_node_set_measure_text(EngineBase *, std::size_t, const char *, std::size_t) { return false; }
inline bool axon_font_invalidate_cache(EngineBase *, std::uint32_t) { return false; }
inline bool axon_node_set_measure_callback(EngineBase *, std::size_t, bool) { return false; }
inline bool axon_node_style_set_number(EngineBase *, std::size_t, std::uint32_t, float) { return false; }
inline bool axon_node_style_set_string(EngineBase *, std::size_t, std::uint32_t, const char *) { return false; }
inline bool axon_compute_layout(EngineBase *, std::size_t, float, float) { return false; }
inline bool axon_get_last_compute_stats(EngineBase *, AxonComputeStats *) { return false; }
inline AxonLayoutResult axon_get_layout(EngineBase *, std::size_t) { return AxonLayoutResult{0, 0, 0, 0}; }
inline std::uint32_t axon_font_register_resolved(
    EngineBase *,
    const char *,
    std::uint16_t,
    bool,
    float) {
  return UINT32_MAX;
}
inline std::uint32_t axon_font_prewarm_resolved(
    EngineBase *,
    const char *,
    std::uint16_t,
    bool,
    float) {
  return UINT32_MAX;
}
inline bool axon_text_set_measure_callback(
    EngineBase *,
    AxonHostMeasureTextFn,
    void *) {
  return false;
}
inline bool axon_node_set_measurement_callback(
    EngineBase *,
    AxonHostMeasureNodeFn,
    void *) {
  return false;
}
#endif
