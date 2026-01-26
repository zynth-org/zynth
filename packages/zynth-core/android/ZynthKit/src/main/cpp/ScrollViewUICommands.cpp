#include "UICommandsRegistry.h"

#include <chrono>
#include <iomanip>
#include <sstream>
#include <string>

namespace zynth::kit {
namespace {

using namespace facebook::jsi;

std::string formatNumber(double value) {
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

std::string buildScrollToJSON(
    bool hasX,
    double x,
    bool hasY,
    double y,
    bool animated,
    double seq) {
  std::string json = "{\"type\":\"scrollTo\"";
  if (hasX) {
    json += ",\"x\":" + formatNumber(x);
  }
  if (hasY) {
    json += ",\"y\":" + formatNumber(y);
  }
  json += ",\"animated\":";
  json += animated ? "true" : "false";
  json += ",\"seq\":" + formatNumber(seq);
  json += "}";
  return json;
}

void installScrollViewUICommands(const UICommandsState &state, Runtime &rt) {
  auto scrollTo = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "scrollTo"),
      4,
      [state](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (!state || count < 1 || !args[0].isNumber()) {
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
        double seq =
            static_cast<double>(
                std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::system_clock::now().time_since_epoch())
                    .count());
        std::string json = buildScrollToJSON(hasX, x, hasY, y, animated, seq);
        uiCommandSetProp(state, nodeId, "__scrollCommand", json);
        return Value::undefined();
      });

  auto commands = rt.global().getPropertyAsObject(rt, "__zynth_ui_commands");
  commands.setProperty(rt, "scrollTo", scrollTo);
  rt.global().setProperty(rt, "__zynth_ui_commands", commands);
}

struct ScrollViewUICommandsInstaller {
  ScrollViewUICommandsInstaller() {
    registerUICommandsInstaller(installScrollViewUICommands);
  }
};

static ScrollViewUICommandsInstaller installer;

} // namespace
} // namespace zynth::kit
