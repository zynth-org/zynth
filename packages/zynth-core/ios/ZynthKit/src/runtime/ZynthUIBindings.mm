#import "ZynthUIBindings.h"
#import "ZynthUIManager.h"

#import <jsi/jsi.h>

using namespace facebook::jsi;

void ZynthInstallUIBindings(Runtime &rt, ZynthUIManager *manager) {
  if (!manager) return;

  Object ui(rt);

  auto createNode = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "createNode"), 1,
      [manager](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isString()) {
          return Value::undefined();
        }
        std::string type = args[0].asString(rt).utf8(rt);
        NSNumber *nodeId = [manager createNode:[NSString stringWithUTF8String:type.c_str()]];
        return Value((double)nodeId.intValue);
      });

  auto setProp = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setProp"), 3,
      [manager](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 3 || !args[0].isNumber() || !args[1].isString()) {
          return Value::undefined();
        }
        int nodeId = (int)args[0].asNumber();
        std::string name = args[1].asString(rt).utf8(rt);
        std::string json = args[2].isString() ? args[2].asString(rt).utf8(rt) : "";
        [manager setProp:@(nodeId)
                    name:[NSString stringWithUTF8String:name.c_str()]
                valueJSON:[NSString stringWithUTF8String:json.c_str()]];
        return Value::undefined();
      });

  auto setText = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setText"), 2,
      [manager](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int nodeId = (int)args[0].asNumber();
        std::string text = args[1].isString() ? args[1].asString(rt).utf8(rt) : "";
        [manager setText:@(nodeId) text:[NSString stringWithUTF8String:text.c_str()]];
        return Value::undefined();
      });

  auto insertChild = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "insertChild"), 3,
      [manager](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 3 || !args[0].isNumber() || !args[1].isNumber() || !args[2].isNumber()) {
          return Value::undefined();
        }
        [manager insertChild:@((int)args[0].asNumber())
                       child:@((int)args[1].asNumber())
                       index:@((int)args[2].asNumber())];
        return Value::undefined();
      });

  auto removeChild = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "removeChild"), 2,
      [manager](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isNumber()) {
          return Value::undefined();
        }
        [manager removeChild:@((int)args[0].asNumber())
                        child:@((int)args[1].asNumber())];
        return Value::undefined();
      });

  auto setHandler = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setHandler"), 3,
      [manager](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isString()) {
          return Value::undefined();
        }
        int nodeId = (int)args[0].asNumber();
        std::string name = args[1].asString(rt).utf8(rt);
        [manager setHandler:@(nodeId) name:[NSString stringWithUTF8String:name.c_str()]];
        return Value::undefined();
      });

  auto applyBatch = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "applyBatch"), 1,
      [manager](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1) return Value::undefined();
        std::string json = args[0].isString() ? args[0].asString(rt).utf8(rt) : "";
        [manager applyBatch:[NSString stringWithUTF8String:json.c_str()]];
        return Value::undefined();
      });

  auto setSurface = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setSurface"), 1,
      [manager](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) {
          return Value::undefined();
        }
        [manager setSurface:@((int)args[0].asNumber())];
        return Value::undefined();
      });

  auto flush = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "flush"), 0,
      [manager](Runtime &, const Value &, const Value *, size_t) -> Value {
        [manager flush];
        return Value::undefined();
      });

  ui.setProperty(rt, "createNode", createNode);
  ui.setProperty(rt, "setProp", setProp);
  ui.setProperty(rt, "setText", setText);
  ui.setProperty(rt, "insertChild", insertChild);
  ui.setProperty(rt, "removeChild", removeChild);
  ui.setProperty(rt, "setHandler", setHandler);
  ui.setProperty(rt, "applyBatch", applyBatch);
  ui.setProperty(rt, "setSurface", setSurface);
  ui.setProperty(rt, "flush", flush);

  rt.global().setProperty(rt, "__ui", std::move(ui));
}
