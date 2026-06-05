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
bool ZynthCancelSharedSignalAnimation(void *state, int signalId);

struct ZynthAnimatedLayoutProps {
  float width = __builtin_nanf("");
  float height = __builtin_nanf("");
  float minWidth = __builtin_nanf("");
  float minHeight = __builtin_nanf("");
  float maxWidth = __builtin_nanf("");
  float maxHeight = __builtin_nanf("");
  float flex = __builtin_nanf("");
  float flexGrow = __builtin_nanf("");
  float flexShrink = __builtin_nanf("");
  float flexBasis = __builtin_nanf("");
  float top = __builtin_nanf("");
  float right = __builtin_nanf("");
  float bottom = __builtin_nanf("");
  float left = __builtin_nanf("");
  float padding = __builtin_nanf("");
  float paddingHorizontal = __builtin_nanf("");
  float paddingVertical = __builtin_nanf("");
  float paddingTop = __builtin_nanf("");
  float paddingRight = __builtin_nanf("");
  float paddingBottom = __builtin_nanf("");
  float paddingLeft = __builtin_nanf("");
  float margin = __builtin_nanf("");
  float marginHorizontal = __builtin_nanf("");
  float marginVertical = __builtin_nanf("");
  float marginTop = __builtin_nanf("");
  float marginRight = __builtin_nanf("");
  float marginBottom = __builtin_nanf("");
  float marginLeft = __builtin_nanf("");
};

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
    const ZynthAnimatedLayoutProps* props);

void ZynthPerformNativeLayout(void *state);

#ifdef __cplusplus
}
#endif
