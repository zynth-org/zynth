#import "ZynthJSIPluginRegistry.h"
#import "ZynthWorklets.h"
#include <cmath>
#include <limits>

BOOL ZynthSetSharedSignalForHost(ZynthHermesRuntimeHost *host, int signalId, double value) {
  if (!host) return NO;
  return [[host worklets] setSharedSignalValue:signalId value:value];
}

#ifdef __cplusplus
namespace {
std::vector<ZynthJSIPluginInstaller> &pluginInstallers() {
  static std::vector<ZynthJSIPluginInstaller> installers;
  return installers;
}
} // namespace

void ZynthRegisterJSIPluginInstaller(ZynthJSIPluginInstaller installer) {
  if (!installer) return;
  pluginInstallers().push_back(installer);
}

void ZynthRegisterSharedSignalChangedCallback(ZynthSharedSignalChangedCallback callback) {
  [ZynthWorklets registerSharedSignalChangedCallback:callback];
}

bool ZynthSetSharedSignal(void *state, int signalId, double value) {
  ZynthHermesRuntimeHost *host = (__bridge ZynthHermesRuntimeHost *)state;
  return ZynthSetSharedSignalForHost(host, signalId, value);
}

double ZynthGetSharedSignal(void *state, int signalId, bool *found) {
  ZynthHermesRuntimeHost *host = (__bridge ZynthHermesRuntimeHost *)state;
  if (!host) {
    if (found) *found = false;
    return std::numeric_limits<double>::quiet_NaN();
  }
  double value = [[host worklets] sharedSignalValueForId:signalId];
  if (std::isnan(value)) {
    if (found) *found = false;
    return value;
  }
  if (found) *found = true;
  return value;
}

void ZynthInstallJSIPlugins(ZynthHermesRuntimeHost *host, facebook::jsi::Runtime &rt) {
  auto &installers = pluginInstallers();
  NSLog(@"[ZynthKit] Installing %lu JSI plugins", (unsigned long)installers.size());
  for (auto installer : installers) {
    installer(host, rt);
  }
}
#endif
