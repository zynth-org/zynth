#import "ZynthJSIPluginRegistry.h"
#import "ZynthWorklets.h"

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

void ZynthInstallJSIPlugins(ZynthHermesRuntimeHost *host, facebook::jsi::Runtime &rt) {
  auto &installers = pluginInstallers();
  NSLog(@"[ZynthKit] Installing %lu JSI plugins", (unsigned long)installers.size());
  for (auto installer : installers) {
    installer(host, rt);
  }
}
#endif
