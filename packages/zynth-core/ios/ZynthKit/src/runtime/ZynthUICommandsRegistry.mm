#import "ZynthUICommandsRegistry.h"
#import "ZynthRuntimeHostRegistry.h"
#import "ZynthJSIPluginRegistry.h"
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
  auto setSharedSignal = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "setSharedSignal"),
      2,
      [host](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        (void)rt;
        if (!host || count < 2 || !args[0].isNumber() || !args[1].isNumber()) {
          return Value::undefined();
        }
        int signalId = static_cast<int>(args[0].asNumber());
        double value = args[1].asNumber();
        (void)ZynthSetSharedSignalForHost(host, signalId, value);
        return Value::undefined();
      });
  commands.setProperty(rt, "setSharedSignal", setSharedSignal);
  rt.global().setProperty(rt, "__zynth_ui_commands", commands);

  auto &installers = ZynthUICommandsInstallers();
  for (const auto &installer : installers) {
    if (installer) {
      installer(host, rt);
    }
  }
}
