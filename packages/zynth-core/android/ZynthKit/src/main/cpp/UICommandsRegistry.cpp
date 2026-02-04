#include "UICommandsRegistry.h"

#include <vector>

namespace zynth::kit {

using namespace facebook::jsi;

static std::vector<UICommandsInstaller> &UICommandsInstallers() {
  static std::vector<UICommandsInstaller> installers;
  return installers;
}

static std::weak_ptr<void> gCurrentStateWeak;
static Runtime *gCurrentRuntime = nullptr;

void registerUICommandsInstaller(UICommandsInstaller installer) {
  if (!installer) return;
  UICommandsInstallers().push_back(installer);
  if (gCurrentRuntime) {
    auto state = gCurrentStateWeak.lock();
    if (state) {
      installer(state, *gCurrentRuntime);
    }
  }
}

void installUICommandsRegistry(const UICommandsState &state, Runtime &rt) {
  gCurrentStateWeak = state;
  gCurrentRuntime = &rt;
  Object commands(rt);
  rt.global().setProperty(rt, "__zynth_ui_commands", commands);
  for (const auto &installer : UICommandsInstallers()) {
    if (installer) {
      installer(state, rt);
    }
  }
}

} // namespace zynth::kit
