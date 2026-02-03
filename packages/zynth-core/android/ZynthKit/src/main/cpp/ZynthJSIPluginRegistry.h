#pragma once

#include <jsi/jsi.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void (*ZynthJSIPluginInstaller)(facebook::jsi::Runtime &rt, void *state);

void ZynthRegisterJSIPluginInstaller(ZynthJSIPluginInstaller installer);

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

#ifdef __cplusplus
}
#endif
