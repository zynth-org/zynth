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
bool axon_node_set_measure_callback(EngineBase *engine, std::size_t node, bool enabled);
bool axon_node_style_set_number(EngineBase *engine, std::size_t node, std::uint32_t prop, float value);
bool axon_node_style_set_string(EngineBase *engine, std::size_t node, std::uint32_t prop, const char *value);
bool axon_compute_layout(EngineBase *engine, std::size_t root, float width, float height);
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
inline bool axon_node_set_measure_callback(EngineBase *, std::size_t, bool) { return false; }
inline bool axon_node_style_set_number(EngineBase *, std::size_t, std::uint32_t, float) { return false; }
inline bool axon_node_style_set_string(EngineBase *, std::size_t, std::uint32_t, const char *) { return false; }
inline bool axon_compute_layout(EngineBase *, std::size_t, float, float) { return false; }
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
