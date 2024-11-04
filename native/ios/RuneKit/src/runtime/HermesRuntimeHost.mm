#import "HermesRuntimeHost.h"

#import <hermes/hermes.h>
#import <jsi/jsi.h>

#import <unordered_map>
#import <memory>
#import <functional>
#import <string>
#import <vector>
#import <utility>
#import <exception>

using namespace facebook::jsi;

namespace {
struct HandlerKey {
  int id;
  std::string name;
  bool operator==(const HandlerKey &o) const { return id == o.id && name == o.name; }
};

struct HandlerKeyHash {
  size_t operator()(HandlerKey const &k) const noexcept {
    return std::hash<int>{}(k.id) ^ std::hash<std::string>{}(k.name);
  }
};
}

@interface HermesRuntimeHost ()
@property(nonatomic, strong) SNUIManager *manager;
@end

@implementation HermesRuntimeHost {
  std::unique_ptr<facebook::hermes::HermesRuntime> _rt;
  std::unordered_map<HandlerKey, std::shared_ptr<Function>, HandlerKeyHash> _handlers;
}

- (instancetype)initWithUIManager:(SNUIManager *)manager {
  if (self = [super init]) {
    _manager = manager;
    _rt = facebook::hermes::makeHermesRuntime();

    _manager.jsInvoker = self;

    [self installConsole];
    [self installUIBridge];
    [self installModulesBridge];
  }
  return self;
}

- (void)reportExceptionMessage:(const std::string &)message {
  if (self.exceptionHandler) {
    self.exceptionHandler([NSString stringWithUTF8String:message.c_str()]);
  } else {
    NSLog(@"Hermes exception: %s", message.c_str());
  }
}

- (void)installConsole {
  auto &rt = *_rt;
  auto consoleLog = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "log"), 1,
      [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        std::string s = (count > 0 && args[0].isString()) ? args[0].getString(rt).utf8(rt) : "";
        NSLog(@"JS: %s", s.c_str());
        return Value::undefined();
      });
  Object console(rt);
  console.setProperty(rt, "log", consoleLog);
  rt.global().setProperty(rt, "console", console);
}

- (void)installUIBridge {
  auto &rt = *_rt;
  HermesRuntimeHost *host = self;

  auto hostCreateNode = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "createNode"), 1,
      [host](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isString()) {
          return Value::undefined();
        }
        std::string type = args[0].getString(rt).utf8(rt);
        int nid = [[host manager] createNode:[NSString stringWithUTF8String:type.c_str()]].intValue;
        return Value((double)nid);
      });

  auto hostSetProp = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setProp"), 3,
      [host](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        if (count < 3) {
          return Value::undefined();
        }
        int id = (int)a[0].asNumber();
        std::string name = a[1].getString(rt).utf8(rt);
        auto JSON = rt.global().getPropertyAsObject(rt, "JSON");
        auto stringify = JSON.getPropertyAsFunction(rt, "stringify");
        auto str = stringify.call(rt, Value(rt, a[2])).getString(rt).utf8(rt);
        [[host manager] setProp:@(id)
                              name:[NSString stringWithUTF8String:name.c_str()]
                         valueJSON:[NSString stringWithUTF8String:str.c_str()]];
        return Value::undefined();
      });

  auto hostSetText = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setText"), 2,
      [host](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        if (count < 2) {
          return Value::undefined();
        }
        int id = (int)a[0].asNumber();
        auto text = a[1].getString(rt).utf8(rt);
        [[host manager] setText:@(id) text:[NSString stringWithUTF8String:text.c_str()]];
        return Value::undefined();
      });

  auto hostInsertChild = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "insertChild"), 3,
      [host](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        if (count < 3) {
          return Value::undefined();
        }
        [[host manager] insertChild:@((int)a[0].asNumber())
                               child:@((int)a[1].asNumber())
                               index:@((int)a[2].asNumber())];
        return Value::undefined();
      });

  auto hostRemoveChild = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "removeChild"), 2,
      [host](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        if (count < 2) {
          return Value::undefined();
        }
        [[host manager] removeChild:@((int)a[0].asNumber()) child:@((int)a[1].asNumber())];
        return Value::undefined();
      });

  auto hostSetHandler = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setHandler"), 3,
      [host](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        if (count < 3) {
          return Value::undefined();
        }
        int id = (int)a[0].asNumber();
        std::string name = a[1].getString(rt).utf8(rt);
        auto fn = a[2].asObject(rt).asFunction(rt);
        host->_handlers[{id, name}] = std::make_shared<Function>(std::move(fn));
        [[host manager] setHandler:@(id) name:[NSString stringWithUTF8String:name.c_str()]];
        return Value::undefined();
      });

  auto hostFlush = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "flush"), 0,
      [host](Runtime &, const Value &, const Value *, size_t) -> Value {
        [[host manager] flush];
        return Value::undefined();
      });

  Object ui(rt);
  ui.setProperty(rt, "createNode", hostCreateNode);
  ui.setProperty(rt, "setProp", hostSetProp);
  ui.setProperty(rt, "setText", hostSetText);
  ui.setProperty(rt, "insertChild", hostInsertChild);
  ui.setProperty(rt, "removeChild", hostRemoveChild);
  ui.setProperty(rt, "setHandler", hostSetHandler);
  ui.setProperty(rt, "flush", hostFlush);
  rt.global().setProperty(rt, "__ui", ui);
}

- (void)installModulesBridge {
  auto &rt = *_rt;
  HermesRuntimeHost *host = self;

  auto hostCall = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "call"), 3,
      [host](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        if (count < 3) {
          return Value::undefined();
        }
        std::string module = a[0].getString(rt).utf8(rt);
        std::string method = a[1].getString(rt).utf8(rt);
        auto JSON = rt.global().getPropertyAsObject(rt, "JSON");
        auto stringify = JSON.getPropertyAsFunction(rt, "stringify");
        auto str = stringify.call(rt, Value(rt, a[2])).getString(rt).utf8(rt);

        NSString *(^handler)(NSString *, NSString *, NSString *) = host.moduleCallHandler;
        NSString *resultJSON = handler ? handler([NSString stringWithUTF8String:module.c_str()],
                                                [NSString stringWithUTF8String:method.c_str()],
                                                [NSString stringWithUTF8String:str.c_str()])
                                      : @"{}";
        if (!resultJSON) {
          resultJSON = @"{}";
        }
        auto outString = String::createFromUtf8(rt, resultJSON.UTF8String);
        auto parse = JSON.getPropertyAsFunction(rt, "parse");
        return parse.call(rt, Value(std::move(outString)));
      });

  Object modules(rt);
  modules.setProperty(rt, "call", hostCall);
  rt.global().setProperty(rt, "__modules", modules);
}

- (void)invokeHandlerForNode:(int)nid name:(NSString *)name {
  auto &rt = *_rt;
  std::string handlerName = [name UTF8String] ?: "";
  auto it = _handlers.find({nid, handlerName});
  if (it == _handlers.end()) {
    return;
  }
  Object event(rt);
  event.setProperty(rt, "target", (double)nid);
  Value eventValue(std::move(event));
  it->second->call(rt, std::move(eventValue));
}

- (void)evaluateString:(NSString *)code {
  try {
    auto buffer = std::make_shared<StringBuffer>(code.UTF8String);
    _rt->evaluateJavaScript(buffer, "main.js");
  } catch (const facebook::jsi::JSError &error) {
    std::string message(error.what());
    [self reportExceptionMessage:message];
  } catch (const std::exception &ex) {
    std::string message(ex.what());
    [self reportExceptionMessage:message];
  }
}

- (id)callGlobal:(NSString *)name args:(NSArray *)args {
  auto &rt = *_rt;
  try {
    auto fn = rt.global().getPropertyAsFunction(rt, [name UTF8String]);
    std::vector<Value> va;
    va.reserve(args.count);
    for (id arg in args) {
      if ([arg isKindOfClass:[NSNumber class]]) {
        va.emplace_back([(NSNumber *)arg doubleValue]);
      } else if ([arg isKindOfClass:[NSString class]]) {
        va.emplace_back(String::createFromUtf8(rt, [(NSString *)arg UTF8String]));
      } else if ([arg isKindOfClass:[NSNull class]]) {
        va.emplace_back(Value::null());
      } else {
        va.emplace_back(Value::undefined());
      }
    }
    const Value *argsPtr = va.data();
    fn.call(rt, argsPtr, va.size());
  } catch (const facebook::jsi::JSError &error) {
    std::string message(error.what());
    [self reportExceptionMessage:message];
  } catch (const std::exception &ex) {
    std::string message(ex.what());
    [self reportExceptionMessage:message];
  }
  return nil;
}

@end
