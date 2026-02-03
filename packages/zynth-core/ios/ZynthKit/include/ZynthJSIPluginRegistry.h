#pragma once

#import <Foundation/Foundation.h>
#import "ZynthHermesRuntimeHost.h"

#ifdef __cplusplus
#include <jsi/jsi.h>
#include <functional>
#include <vector>
#endif

NS_ASSUME_NONNULL_BEGIN

#ifdef __cplusplus
typedef void (*ZynthJSIPluginInstaller)(ZynthHermesRuntimeHost *host, facebook::jsi::Runtime &rt);

void ZynthRegisterJSIPluginInstaller(ZynthJSIPluginInstaller installer);
void ZynthInstallJSIPlugins(ZynthHermesRuntimeHost *host, facebook::jsi::Runtime &rt);
#endif

NS_ASSUME_NONNULL_END
