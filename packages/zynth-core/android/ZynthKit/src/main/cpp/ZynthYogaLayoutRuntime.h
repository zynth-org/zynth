#pragma once

#include <cstdint>
#include <cstddef>

struct ZynthYogaLayoutRuntime;

using ZynthYogaMeasureFn = bool (*)(
    void *userData,
    int nodeId,
    float width,
    int widthMode,
    float height,
    int heightMode,
    float *outWidth,
    float *outHeight);

ZynthYogaLayoutRuntime *zynth_yoga_runtime_create(
    void *userData,
    ZynthYogaMeasureFn textMeasure,
    ZynthYogaMeasureFn nodeMeasure);
void zynth_yoga_runtime_destroy(ZynthYogaLayoutRuntime *runtime);

void zynth_yoga_runtime_set_surface_root(ZynthYogaLayoutRuntime *runtime, int surfaceId);
void zynth_yoga_runtime_set_node_type(
    ZynthYogaLayoutRuntime *runtime,
    int nodeId,
    const char *type);
void zynth_yoga_runtime_set_text(
    ZynthYogaLayoutRuntime *runtime,
    int nodeId,
    const char *text);
void zynth_yoga_runtime_set_measure_handler(
    ZynthYogaLayoutRuntime *runtime,
    int nodeId,
    bool enabled);
void zynth_yoga_runtime_insert_child(
    ZynthYogaLayoutRuntime *runtime,
    int parentId,
    int childId,
    int index);
void zynth_yoga_runtime_remove_child(
    ZynthYogaLayoutRuntime *runtime,
    int parentId,
    int childId);
void zynth_yoga_runtime_drop_node(ZynthYogaLayoutRuntime *runtime, int nodeId);

bool zynth_yoga_runtime_set_style_number(
    ZynthYogaLayoutRuntime *runtime,
    int nodeId,
    std::uint32_t propId,
    float value);
bool zynth_yoga_runtime_set_style_string(
    ZynthYogaLayoutRuntime *runtime,
    int nodeId,
    std::uint32_t propId,
    const char *value);

bool zynth_yoga_runtime_compute_layout(
    ZynthYogaLayoutRuntime *runtime,
    int rootId,
    float width,
    float height);
bool zynth_yoga_runtime_collect_frames(
    ZynthYogaLayoutRuntime *runtime,
    const int *nodeIds,
    std::size_t count,
    float *outFrames);
