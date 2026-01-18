#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthKit.h"
#import "SNUIManager.h"
#import "ZynthUICommandsRegistry.h"
#endif

#import <jsi/jsi.h>
#import <sstream>
#import <iomanip>

using namespace facebook::jsi;

@interface HermesRuntimeHost (ZynthUICommands)
@property(nonatomic, strong) SNUIManager *manager;
@end

static std::string ZynthFormatNumber(double value) {
  std::ostringstream stream;
  stream.setf(std::ios::fixed);
  stream << std::setprecision(15) << value;
  std::string out = stream.str();
  if (out.find('.') != std::string::npos) {
    while (!out.empty() && out.back() == '0') {
      out.pop_back();
    }
    if (!out.empty() && out.back() == '.') {
      out.pop_back();
    }
  }
  if (out.empty()) {
    return "0";
  }
  return out;
}

static std::string ZynthBuildScrollToJSON(bool hasX,
                                          double x,
                                          bool hasY,
                                          double y,
                                          bool animated,
                                          double seq) {
  std::string json = "{\"type\":\"scrollTo\"";
  if (hasX) {
    json += ",\"x\":" + ZynthFormatNumber(x);
  }
  if (hasY) {
    json += ",\"y\":" + ZynthFormatNumber(y);
  }
  json += ",\"animated\":";
  json += animated ? "true" : "false";
  json += ",\"seq\":" + ZynthFormatNumber(seq);
  json += "}";
  return json;
}

static void ZynthInstallScrollViewUICommands(HermesRuntimeHost *host, Runtime &rt) {
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
        std::string json = ZynthBuildScrollToJSON(hasX, x, hasY, y, animated, seq);
        NSString *payload = [NSString stringWithUTF8String:json.c_str()];
        dispatch_async(dispatch_get_main_queue(), ^{
          [[host manager] setProp:@(nodeId) name:@"__scrollCommand" valueJSON:payload];
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
