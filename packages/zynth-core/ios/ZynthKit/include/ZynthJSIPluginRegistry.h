#pragma once

#import <Foundation/Foundation.h>
#import "ZynthHermesRuntimeHost.h"

#ifdef __cplusplus
#include <jsi/jsi.h>
#include <functional>
#include <vector>
#endif

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT BOOL ZynthSetSharedSignalForHost(ZynthHermesRuntimeHost *_Nullable host,
                                                   int signalId,
                                                   double value);

#ifdef __cplusplus
typedef void (*ZynthJSIPluginInstaller)(ZynthHermesRuntimeHost *host, facebook::jsi::Runtime &rt);

void ZynthRegisterJSIPluginInstaller(ZynthJSIPluginInstaller installer);
void ZynthInstallJSIPlugins(ZynthHermesRuntimeHost *host, facebook::jsi::Runtime &rt);

typedef void (*ZynthSharedSignalChangedCallback)(void *state, int signalId);
void ZynthRegisterSharedSignalChangedCallback(ZynthSharedSignalChangedCallback callback);

bool ZynthSetSharedSignal(void *state, int signalId, double value);
#endif

NS_ASSUME_NONNULL_END
