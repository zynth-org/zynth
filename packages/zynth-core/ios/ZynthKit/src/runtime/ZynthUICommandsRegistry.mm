#import "ZynthUICommandsRegistry.h"
#import <jsi/jsi.h>

using namespace facebook::jsi;

static std::vector<ZynthUICommandsInstaller> &ZynthUICommandsInstallers() {
  static std::vector<ZynthUICommandsInstaller> installers;
  return installers;
}

static ZynthHermesRuntimeHost *gCurrentHost = nullptr;
static Runtime *gCurrentRuntime = nullptr;

void ZynthRegisterUICommandsInstaller(ZynthUICommandsInstaller installer) {
  if (!installer) return;
  ZynthUICommandsInstallers().push_back(installer);
  if (gCurrentHost && gCurrentRuntime) {
    installer(gCurrentHost, *gCurrentRuntime);
  }
}

void ZynthInstallUICommandsRegistry(ZynthHermesRuntimeHost *host, Runtime &rt) {
  gCurrentHost = host;
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
