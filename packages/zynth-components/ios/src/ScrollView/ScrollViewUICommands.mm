#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthKit.h"
#import "ZynthUIManager.h"
#import "ZynthUICommandsRegistry.h"
#endif

#import "ZynthScrollView.h"
#import "ZynthNode.h"

#import <jsi/jsi.h>
#import <sstream>
#import <iomanip>

using namespace facebook::jsi;

@interface ZynthHermesRuntimeHost (ZynthUICommands)
@property(nonatomic, strong) ZynthUIManager *manager;
@end

static void ZynthInstallScrollViewUICommands(ZynthHermesRuntimeHost *host, Runtime &rt) {
  auto scrollTo = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "scrollTo"),
      4,
      [host](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (!host || count < 1 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int nodeId = static_cast<int>(args[0].asNumber());
        bool hasX = count > 1 && args[1].isNumber();
        bool hasY = count > 2 && args[2].isNumber();
        double x = hasX ? args[1].asNumber() : 0;
        double y = hasY ? args[2].asNumber() : 0;
        bool animated = true;
        if (count > 3 && args[3].isBool()) {
          animated = args[3].getBool();
        }
        double seq = CFAbsoluteTimeGetCurrent() * 1000.0;
        dispatch_async(dispatch_get_main_queue(), ^{
          ZynthUIManager *manager = [host manager];
          ZynthNode *node = [manager getNodeState:@(nodeId)];
          if (!node || ![node.view isKindOfClass:[ZynthScrollView class]]) {
            return;
          }
          NSMutableDictionary *command = [NSMutableDictionary dictionary];
          command[@"type"] = @"scrollTo";
          if (hasX) {
            command[@"x"] = @(x);
          }
          if (hasY) {
            command[@"y"] = @(y);
          }
          command[@"animated"] = @(animated);
          command[@"seq"] = @(seq);
          [(ZynthScrollView *)node.view zynth_applyCommand:command];
        });
        return Value::undefined();
      });

  auto commands = rt.global().getPropertyAsObject(rt, "__zynth_ui_commands");
  commands.setProperty(rt, "scrollTo", scrollTo);
  rt.global().setProperty(rt, "__zynth_ui_commands", commands);
}

extern "C" void ZynthScrollViewRegisterUICommands(void) {
  ZynthRegisterUICommandsInstaller(ZynthInstallScrollViewUICommands);
}
