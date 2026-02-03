#import "ZynthJSIPluginRegistry.h"

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

void ZynthInstallJSIPlugins(ZynthHermesRuntimeHost *host, facebook::jsi::Runtime &rt) {
  for (auto installer : pluginInstallers()) {
    installer(host, rt);
  }
}
#endif
