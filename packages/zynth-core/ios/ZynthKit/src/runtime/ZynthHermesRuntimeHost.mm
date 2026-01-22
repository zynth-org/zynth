#import "ZynthHermesRuntimeHost.h"
#import "ZynthRuntime.h"
#import "ZynthUIBindings.h"
#import "ZynthUIManager.h"
#import "ZynthUICommandsRegistry.h"

#import <hermes/hermes.h>
#import <jsi/jsi.h>

#import <atomic>
#import <unordered_map>

using namespace facebook::jsi;

namespace {
static bool DEBUG_RUNTIME = false;
struct NSDataBuffer final : public Buffer {
  NSData *data_;
  explicit NSDataBuffer(NSData *data) : data_(data) {}
  size_t size() const override { return (size_t)[data_ length]; }
  const uint8_t *data() const override { return (const uint8_t *)[data_ bytes]; }
};

static std::string valueToString(Runtime &rt, const Value &value) {
  if (value.isString()) return value.asString(rt).utf8(rt);
  if (value.isNumber()) return std::to_string(value.asNumber());
  if (value.isBool()) return value.getBool() ? "true" : "false";
  if (value.isNull()) return "null";
  if (value.isUndefined()) return "undefined";
  return "[object]";
}

static id jsValueToObjC(Runtime &rt, const Value &value) {
  if (value.isBool()) return @(value.getBool());
  if (value.isNumber()) return @(value.asNumber());
  if (value.isString()) return [NSString stringWithUTF8String:value.asString(rt).utf8(rt).c_str()];
  if (value.isNull() || value.isUndefined()) return [NSNull null];
  if (value.isObject()) {
    Object obj = value.asObject(rt);
    if (obj.isArray(rt)) {
      Array arr = obj.asArray(rt);
      size_t len = arr.size(rt);
      NSMutableArray *res = [NSMutableArray arrayWithCapacity:len];
      for (size_t i = 0; i < len; i++) {
        [res addObject:jsValueToObjC(rt, arr.getValueAtIndex(rt, i))];
      }
      return res;
    }
    try {
      Object json = rt.global().getPropertyAsObject(rt, "JSON");
      Function stringify = json.getPropertyAsFunction(rt, "stringify");
      Value jsonStr = stringify.call(rt, value);
      if (jsonStr.isString()) {
        std::string s = jsonStr.asString(rt).utf8(rt);
        NSData *d = [NSData dataWithBytes:s.c_str() length:s.length()];
        return [NSJSONSerialization JSONObjectWithData:d options:0 error:nil];
      }
    } catch (...) {}
  }
  return nil;
}

static Value objCToJSValue(Runtime &rt, id obj) {
  if (obj == nil || [obj isKindOfClass:[NSNull class]]) return Value::null();
  if ([obj isKindOfClass:[NSString class]]) return String::createFromUtf8(rt, [obj UTF8String]);
  if ([obj isKindOfClass:[NSNumber class]]) return Value([obj doubleValue]);
  if ([obj isKindOfClass:[NSArray class]] || [obj isKindOfClass:[NSDictionary class]]) {
     NSError *error = nil;
     NSData *data = [NSJSONSerialization dataWithJSONObject:obj options:0 error:&error];
     if (data) {
       std::string s((const char*)[data bytes], [data length]);
       try {
         Object json = rt.global().getPropertyAsObject(rt, "JSON");
         Function parse = json.getPropertyAsFunction(rt, "parse");
         return parse.call(rt, String::createFromUtf8(rt, s));
       } catch (...) {}
     }
  }
  return Value::undefined();
}

static void installConsole(Runtime &rt) {
  auto logFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "log"), 1,
      [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        NSMutableArray<NSString *> *parts = [NSMutableArray arrayWithCapacity:count];
        for (size_t i = 0; i < count; i++) {
          std::string str = valueToString(rt, args[i]);
          [parts addObject:[NSString stringWithUTF8String:str.c_str()]];
        }
        NSLog(@"[ZynthJS] %@", [parts componentsJoinedByString:@" "]);
        return Value::undefined();
      });

  Object console(rt);
  console.setProperty(rt, "log", logFn);
  console.setProperty(rt, "warn", logFn);
  console.setProperty(rt, "error", logFn);
  rt.global().setProperty(rt, "console", console);
}

static void installModuleBridge(Runtime &rt) {
  // Stub implementation; replaced when registerModuleBridge is called
  auto noop = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "call"), 0,
      [](Runtime &, const Value &, const Value *, size_t) -> Value {
        return Value::undefined();
      });
  Object modules(rt);
  modules.setProperty(rt, "call", noop);
  modules.setProperty(rt, "callSync", noop);
  rt.global().setProperty(rt, "__modules", modules);
  rt.global().setProperty(rt, "__zynthCallSync", noop);
}

static void installGlobals(Runtime &rt) {
  Object globalThis = rt.global();
  globalThis.setProperty(rt, "global", globalThis);
  globalThis.setProperty(rt, "self", globalThis);
  globalThis.setProperty(rt, "window", globalThis);

  auto queueMicrotaskFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "queueMicrotask"), 1,
      [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isObject() || !args[0].asObject(rt).isFunction(rt)) {
          return Value::undefined();
        }
        Function fn = args[0].asObject(rt).asFunction(rt);
        try {
          rt.queueMicrotask(std::move(fn));
        } catch (...) {
          fn.call(rt);
        }
        return Value::undefined();
      });

  auto setImmediateFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setImmediate"), 1,
      [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isObject() || !args[0].asObject(rt).isFunction(rt)) {
          return Value::undefined();
        }
        Function fn = args[0].asObject(rt).asFunction(rt);
        try {
          rt.queueMicrotask(std::move(fn));
        } catch (...) {
          fn.call(rt);
        }
        return Value::undefined();
      });

  globalThis.setProperty(rt, "queueMicrotask", queueMicrotaskFn);
  globalThis.setProperty(rt, "setImmediate", setImmediateFn);
}
} // namespace

@interface ZynthHermesRuntimeHost ()
@property(nonatomic, strong) ZynthUIManager *manager;
- (void)installTimers;
@end

@implementation ZynthHermesRuntimeHost {
  std::unique_ptr<facebook::hermes::HermesRuntime> _runtime;
  struct Timer {
    int id;
    dispatch_source_t source;
    std::shared_ptr<Function> fn;
    std::vector<Value> args;
    bool isInterval;
  };
  std::unordered_map<int, std::unique_ptr<Timer>> _timers;
  std::atomic<int> _nextTimer;
}

- (instancetype)initWithUIManager:(ZynthUIManager *)manager {
  self = [super init];
  if (self) {
    _manager = manager;
    _nextTimer = 1;
    _runtime = facebook::hermes::makeHermesRuntime();
    installConsole(*_runtime);
    installGlobals(*_runtime);
    installModuleBridge(*_runtime);
    [self installTimers];
    ZynthInstallUIBindings(*_runtime, manager);
    ZynthInstallUICommandsRegistry(self, *_runtime);
    _runtime->global().setProperty(
        *_runtime, "__ZYNTH_PLATFORM", String::createFromUtf8(*_runtime, "ios"));
  }
  return self;
}

- (void)installModuleBridge:(id<ZynthModuleBridge>)bridge constants:(NSDictionary<NSString *,id> *)constants {
  Runtime &rt = *_runtime;
  
  __weak id<ZynthModuleBridge> weakBridge = bridge;
  
  auto callFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "call"), 3,
      [weakBridge](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2) return Value::undefined();
        std::string moduleName = args[0].asString(rt).utf8(rt);
        std::string methodName = args[1].asString(rt).utf8(rt);
        id argObj = (count > 2) ? jsValueToObjC(rt, args[2]) : nil;
        
        id result = [weakBridge callModule:[NSString stringWithUTF8String:moduleName.c_str()]
                                    method:[NSString stringWithUTF8String:methodName.c_str()]
                                      args:argObj];
        return objCToJSValue(rt, result);
      });

  auto callSyncFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "callSync"), 3,
      [weakBridge](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2) return Value::undefined();
        std::string moduleName = args[0].asString(rt).utf8(rt);
        std::string methodName = args[1].asString(rt).utf8(rt);
        id argObj = (count > 2) ? jsValueToObjC(rt, args[2]) : nil;
        
        id result = [weakBridge callModuleSync:[NSString stringWithUTF8String:moduleName.c_str()]
                                        method:[NSString stringWithUTF8String:methodName.c_str()]
                                          args:argObj];
        return objCToJSValue(rt, result);
      });

  Object modules(rt);
  modules.setProperty(rt, "call", callFn);
  modules.setProperty(rt, "callSync", callSyncFn);
  rt.global().setProperty(rt, "__modules", modules);

  if (constants) {
    Value constantsVal = objCToJSValue(rt, constants);
    rt.global().setProperty(rt, "NativeConstants", constantsVal);
  }
}

- (BOOL)evaluateString:(NSString *)code
             sourceURL:(NSString *)sourceURL
                error:(NSError *_Nullable *_Nullable)error {
  if (!code) return NO;
  NSData *data = [code dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) return NO;
  try {
    auto buffer = std::make_shared<NSDataBuffer>(data);
    const char *source = sourceURL ? sourceURL.UTF8String : "<inline>";
    _runtime->evaluateJavaScript(buffer, source);
    return YES;
  } catch (const JSError &ex) {
    if (error) {
      NSString *message = [NSString stringWithUTF8String:ex.getMessage().c_str()];
      NSDictionary *info = @{ NSLocalizedDescriptionKey : message ?: @"JS error" };
      *error = [NSError errorWithDomain:@"ZynthHermes" code:1 userInfo:info];
    }
    return NO;
  } catch (const std::exception &ex) {
    if (error) {
      NSString *message = [NSString stringWithUTF8String:ex.what()];
      NSDictionary *info = @{ NSLocalizedDescriptionKey : message ?: @"Runtime error" };
      *error = [NSError errorWithDomain:@"ZynthHermes" code:2 userInfo:info];
    }
    return NO;
  }
}

- (BOOL)evaluateBytecode:(NSData *)data
               sourceURL:(NSString *)sourceURL
                  error:(NSError *_Nullable *_Nullable)error {
  if (!data) return NO;
  NSString *string = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  if (!string) {
    if (error) {
      NSDictionary *info = @{ NSLocalizedDescriptionKey : @"Invalid UTF-8 bytecode payload" };
      *error = [NSError errorWithDomain:@"ZynthHermes" code:3 userInfo:info];
    }
    return NO;
  }
  return [self evaluateString:string sourceURL:sourceURL error:error];
}

- (id _Nullable)callGlobal:(NSString *)name args:(NSArray *)args {
  if (!name) return nil;
  Runtime &rt = *_runtime;
  auto propId = PropNameID::forAscii(rt, name.UTF8String);
  if (!rt.global().hasProperty(rt, propId)) return nil;
  Value value = rt.global().getProperty(rt, propId);
  if (!value.isObject()) return nil;
  Object obj = value.asObject(rt);
  if (!obj.isFunction(rt)) return nil;
  Function fn = obj.asFunction(rt);
  std::vector<Value> callArgs;
  for (id arg in args) {
    if ([arg isKindOfClass:[NSNumber class]]) {
      callArgs.push_back(Value([(NSNumber *)arg doubleValue]));
    } else if ([arg isKindOfClass:[NSString class]]) {
      std::string str = [(NSString *)arg UTF8String];
      callArgs.push_back(String::createFromUtf8(rt, str));
    } else {
      callArgs.push_back(Value::undefined());
    }
  }
  const Value *argsPtr = callArgs.empty() ? nullptr : callArgs.data();
  try {
    fn.call(rt, argsPtr, callArgs.size());
  } catch (const JSError &error) {
    if (DEBUG_RUNTIME) {
      NSString *message = [NSString stringWithUTF8String:error.getMessage().c_str()];
      NSString *stack = [NSString stringWithUTF8String:error.getStack().c_str()];
      NSLog(@"[ZynthJS] callGlobal error for %@: %@", name, message);
      if (stack.length > 0) {
        NSLog(@"[ZynthJS] stack: %@", stack);
      }
    }
    return nil;
  } catch (const std::exception &ex) {
    if (DEBUG_RUNTIME) {
      NSString *message = [NSString stringWithUTF8String:ex.what()];
      NSLog(@"[ZynthJS] callGlobal exception for %@: %@", name, message);
    }
    return nil;
  }
  return nil;
}

- (void)installTimers {
  Runtime &rt = *_runtime;
  __weak ZynthHermesRuntimeHost *weakHost = self;

  auto hostSetTimeout = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostSetTimeout"), 3,
      [weakHost](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        ZynthHermesRuntimeHost *host = weakHost;
        if (!host) return Value::undefined();
        if (count < 2 || !args[0].isObject()) return Value::undefined();
        Object fnObject = args[0].asObject(rt);
        if (!fnObject.isFunction(rt)) return Value::undefined();

        int delayMs = (count > 1 && args[1].isNumber())
                          ? static_cast<int>(args[1].asNumber())
                          : 0;
        std::vector<Value> callArgs;
        if (count > 2 && args[2].isObject()) {
          Object maybeArray = args[2].asObject(rt);
          if (maybeArray.isArray(rt)) {
            Array array = maybeArray.asArray(rt);
            size_t length = array.size(rt);
            callArgs.reserve(length);
            for (size_t i = 0; i < length; i++) {
              callArgs.emplace_back(Value(rt, array.getValueAtIndex(rt, i)));
            }
          }
        }

        int timerId = host->_nextTimer.fetch_add(1);
        auto timer = std::make_unique<Timer>();
        timer->id = timerId;
        timer->fn = std::make_shared<Function>(fnObject.asFunction(rt));
        timer->args = std::move(callArgs);
        timer->isInterval = false;
        timer->source =
            dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());

        dispatch_source_t source = timer->source;
        host->_timers.emplace(timerId, std::move(timer));

        int64_t delayNs = delayMs < 0 ? 0 : (int64_t)delayMs * NSEC_PER_MSEC;
        dispatch_source_set_timer(
            source, dispatch_time(DISPATCH_TIME_NOW, delayNs), DISPATCH_TIME_FOREVER, 0);

        dispatch_source_set_event_handler(source, ^{
          auto it = host->_timers.find(timerId);
          if (it == host->_timers.end()) return;
          auto &timerRef = *it->second;
          const Value *argsPtr =
              timerRef.args.empty() ? nullptr : timerRef.args.data();
          try {
            timerRef.fn->call(rt, argsPtr, timerRef.args.size());
          } catch (const JSError &error) {
            if (DEBUG_RUNTIME) {
              NSString *message = [NSString stringWithUTF8String:error.getMessage().c_str()];
              NSString *stack = [NSString stringWithUTF8String:error.getStack().c_str()];
              NSLog(@"[ZynthJS] setTimeout error: %@", message);
              if (stack.length > 0) {
                NSLog(@"[ZynthJS] stack: %@", stack);
              }
            }
          } catch (const std::exception &ex) {
            if (DEBUG_RUNTIME) {
              NSString *message = [NSString stringWithUTF8String:ex.what()];
              NSLog(@"[ZynthJS] setTimeout exception: %@", message);
            }
          }
          dispatch_source_cancel(timerRef.source);
          host->_timers.erase(it);
        });

        dispatch_resume(source);
        return Value(static_cast<double>(timerId));
      });

  auto hostSetInterval = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostSetInterval"), 3,
      [weakHost](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        ZynthHermesRuntimeHost *host = weakHost;
        if (!host) return Value::undefined();
        if (count < 2 || !args[0].isObject()) return Value::undefined();
        Object fnObject = args[0].asObject(rt);
        if (!fnObject.isFunction(rt)) return Value::undefined();

        int delayMs = (count > 1 && args[1].isNumber())
                          ? static_cast<int>(args[1].asNumber())
                          : 0;
        if (delayMs < 1) delayMs = 1;

        std::vector<Value> callArgs;
        if (count > 2 && args[2].isObject()) {
          Object maybeArray = args[2].asObject(rt);
          if (maybeArray.isArray(rt)) {
            Array array = maybeArray.asArray(rt);
            size_t length = array.size(rt);
            callArgs.reserve(length);
            for (size_t i = 0; i < length; i++) {
              callArgs.emplace_back(Value(rt, array.getValueAtIndex(rt, i)));
            }
          }
        }

        int timerId = host->_nextTimer.fetch_add(1);
        int64_t intervalNs = (int64_t)delayMs * NSEC_PER_MSEC;
        auto timer = std::make_unique<Timer>();
        timer->id = timerId;
        timer->fn = std::make_shared<Function>(fnObject.asFunction(rt));
        timer->args = std::move(callArgs);
        timer->isInterval = true;
        timer->source =
            dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());

        dispatch_source_t source = timer->source;
        host->_timers.emplace(timerId, std::move(timer));

        dispatch_source_set_timer(
            source, dispatch_time(DISPATCH_TIME_NOW, intervalNs), intervalNs, 0);

        dispatch_source_set_event_handler(source, ^{
          auto it = host->_timers.find(timerId);
          if (it == host->_timers.end()) return;
          auto &timerRef = *it->second;
          const Value *argsPtr =
              timerRef.args.empty() ? nullptr : timerRef.args.data();
          try {
            timerRef.fn->call(rt, argsPtr, timerRef.args.size());
          } catch (const JSError &error) {
            if (DEBUG_RUNTIME) {
              NSString *message = [NSString stringWithUTF8String:error.getMessage().c_str()];
              NSString *stack = [NSString stringWithUTF8String:error.getStack().c_str()];
              NSLog(@"[ZynthJS] setInterval error: %@", message);
              if (stack.length > 0) {
                NSLog(@"[ZynthJS] stack: %@", stack);
              }
            }
          } catch (const std::exception &ex) {
            if (DEBUG_RUNTIME) {
              NSString *message = [NSString stringWithUTF8String:ex.what()];
              NSLog(@"[ZynthJS] setInterval exception: %@", message);
            }
          }
        });

        dispatch_resume(source);
        return Value(static_cast<double>(timerId));
      });

  auto hostClearTimeout = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostClearTimeout"), 1,
      [weakHost](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        ZynthHermesRuntimeHost *host = weakHost;
        if (!host) return Value::undefined();
        if (count < 1 || !args[0].isNumber()) return Value::undefined();
        int timerId = static_cast<int>(args[0].asNumber());
        auto it = host->_timers.find(timerId);
        if (it == host->_timers.end()) return Value::undefined();
        dispatch_source_cancel(it->second->source);
        host->_timers.erase(it);
        return Value::undefined();
      });

  auto hostClearInterval = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostClearInterval"), 1,
      [weakHost](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        ZynthHermesRuntimeHost *host = weakHost;
        if (!host) return Value::undefined();
        if (count < 1 || !args[0].isNumber()) return Value::undefined();
        int timerId = static_cast<int>(args[0].asNumber());
        auto it = host->_timers.find(timerId);
        if (it == host->_timers.end()) return Value::undefined();
        dispatch_source_cancel(it->second->source);
        host->_timers.erase(it);
        return Value::undefined();
      });

  rt.global().setProperty(rt, "__hostSetTimeout", hostSetTimeout);
  rt.global().setProperty(rt, "__hostSetInterval", hostSetInterval);
  rt.global().setProperty(rt, "__hostClearTimeout", hostClearTimeout);
  rt.global().setProperty(rt, "__hostClearInterval", hostClearInterval);

  static const char *timerScript =
      "globalThis.setTimeout=(fn,ms,...a)=>__hostSetTimeout(fn,ms|0,a);"
      "globalThis.clearTimeout=(id)=>__hostClearTimeout(id);"
      "globalThis.setInterval=(fn,ms,...a)=>__hostSetInterval(fn,ms|0,a);"
      "globalThis.clearInterval=(id)=>__hostClearInterval(id);"
      "globalThis.setImmediate=(fn,...a)=>__hostSetTimeout(fn,0,a);"
      "globalThis.clearImmediate=(id)=>__hostClearTimeout(id);";

  auto buffer = std::make_shared<StringBuffer>(timerScript);
  _runtime->evaluateJavaScript(buffer, "timers.js");
}

@end