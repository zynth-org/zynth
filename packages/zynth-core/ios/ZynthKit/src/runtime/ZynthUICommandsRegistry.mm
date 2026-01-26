#import "ZynthUICommandsRegistry.h"
#import "ZynthRuntimeHostRegistry.h"
#import <jsi/jsi.h>

using namespace facebook::jsi;

static std::vector<ZynthUICommandsInstaller> &ZynthUICommandsInstallers() {
  static std::vector<ZynthUICommandsInstaller> installers;
  return installers;
}

static Runtime *gCurrentRuntime = nullptr;

void ZynthRegisterUICommandsInstaller(ZynthUICommandsInstaller installer) {
  if (!installer) return;
  ZynthUICommandsInstallers().push_back(installer);
  ZynthHermesRuntimeHost *host = ZynthGetCurrentRuntimeHost();
  if (host && gCurrentRuntime) {
    installer(host, *gCurrentRuntime);
  }
}

void ZynthInstallUICommandsRegistry(ZynthHermesRuntimeHost *host, Runtime &rt) {
  gCurrentRuntime = &rt;
  Object commands(rt);
  rt.global().setProperty(rt, "__zynth_ui_commands", commands);

  auto &installers = ZynthUICommandsInstallers();
  for (const auto &installer : installers) {
    if (installer) {
      installer(host, rt);
    }
  }
}
