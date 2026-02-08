#pragma once

#include <jsi/jsi.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void (*ZynthJSIPluginInstaller)(facebook::jsi::Runtime &rt, void *state);

void ZynthRegisterJSIPluginInstaller(ZynthJSIPluginInstaller installer);

typedef void (*ZynthSharedSignalChangedCallback)(void *state, int signalId);
void ZynthRegisterSharedSignalChangedCallback(ZynthSharedSignalChangedCallback callback);

int ZynthCreateSharedSignal(void *state, double initialValue);
double ZynthGetSharedSignal(void *state, int signalId, bool *found);
bool ZynthSetSharedSignal(void *state, int signalId, double value);

void ZynthApplyAnimatedStyle(
    void *state,
    int nodeId,
    float opacity,
    float translateX,
    float translateY,
    float scaleX,
    float scaleY,
    float rotate,
    float rotateX,
    float rotateY,
    float skewX,
    float skewY,
    float perspective);

void ZynthApplyAnimatedLayoutStyle(
    void *state,
    int nodeId,
    float width,
    float height,
    float minWidth,
    float minHeight,
    float maxWidth,
    float maxHeight,
    float flexBasis);

#ifdef __cplusplus
}
#endif
