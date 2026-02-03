#import "ZynthHermesRuntimeHost.h"
#import "ZynthRuntimeHostRegistry.h"
#import "ZynthRuntime.h"
#import "ZynthUIBindings.h"
#import "ZynthUIManager.h"
#import "ZynthUICommandsRegistry.h"
#import "ZynthJSIPluginRegistry.h"
#import "ZynthWorklets.h"

#import <hermes/hermes.h>
#import <jsi/jsi.h>

#import <atomic>
#import <unordered_map>

using namespace facebook::jsi;

namespace {
static bool DEBUG_RUNTIME = false;
static void *kZynthJSQueueKey = &kZynthJSQueueKey;
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

static void installConsole(Runtime &rt, ZynthHermesRuntimeHost *host, NSString *runtimeLabel) {
  auto makeConsoleFn = [&](const char *name, NSString *levelLabel) {
    return Function::createFromHostFunction(
        rt, PropNameID::forAscii(rt, name), 1,
        [host, runtimeLabel, levelLabel](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
          NSMutableArray<NSString *> *parts = [NSMutableArray arrayWithCapacity:count];
          for (size_t i = 0; i < count; i++) {
            std::string str = valueToString(rt, args[i]);
            [parts addObject:[NSString stringWithUTF8String:str.c_str()]];
          }
          NSString *message = [parts componentsJoinedByString:@" "];
          std::string messageUtf8 = message ? [message UTF8String] : "";
          std::string stackUtf8;
          if (levelLabel && [levelLabel isEqualToString:@"warn"]) {
            const char *needle =
                "computations created outside a `createRoot` or `render` will never be disposed";
            if (messageUtf8.find(needle) != std::string::npos) {
              try {
                Function errorCtor = rt.global().getPropertyAsFunction(rt, "Error");
                Object errObj = errorCtor.callAsConstructor(
                                      rt, String::createFromUtf8(rt, "Solid warning stack"))
                                      .asObject(rt);
                Value stackValue = errObj.getProperty(rt, "stack");
                if (stackValue.isString()) {
                  stackUtf8 = stackValue.asString(rt).utf8(rt);
                }
              } catch (...) {
                // Ignore stack capture failures.
              }
            }
          }
          if (!stackUtf8.empty()) {
            NSLog(@"[ZynthJS] %@\n%@", message, [NSString stringWithUTF8String:stackUtf8.c_str()]);
          } else {
            NSLog(@"[ZynthJS] %@", message);
          }
          if (host) {
            NSMutableDictionary *data = [NSMutableDictionary dictionary];
            data[@"message"] = message ?: @"";
            if (!stackUtf8.empty()) {
              data[@"stack"] = [NSString stringWithUTF8String:stackUtf8.c_str()] ?: @"";
            }
            if (runtimeLabel) {
              data[@"runtime"] = runtimeLabel;
            }
            [host emitDevtoolsEventWithTopic:@"log/console"
                                       level:levelLabel ?: @"log"
                                         tag:@"console"
                                        data:data];
          }
          return Value::undefined();
        });
  };

  auto logFn = makeConsoleFn("log", @"log");
  auto warnFn = makeConsoleFn("warn", @"warn");
  auto errorFn = makeConsoleFn("error", @"error");

  Object console(rt);
  console.setProperty(rt, "log", logFn);
  console.setProperty(rt, "warn", warnFn);
  console.setProperty(rt, "error", errorFn);
  rt.global().setProperty(rt, "console", console);
  // Mark that console already emits to devtools natively to avoid double-emission in JS.
  rt.global().setProperty(rt, "__ZYNTH_NATIVE_CONSOLE_DEVTOOLS__", Value(true));
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
  ZynthWorklets *_worklets;
  dispatch_queue_t _jsQueue;
  __weak id<ZynthModuleBridge> _moduleBridge;
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
    _jsQueue = dispatch_queue_create("zynth.js", DISPATCH_QUEUE_SERIAL);
    dispatch_queue_set_specific(_jsQueue, kZynthJSQueueKey, kZynthJSQueueKey, NULL);
    ZynthUISetJSQueue(_jsQueue);
    dispatch_sync(_jsQueue, ^{
      _runtime = facebook::hermes::makeHermesRuntime();
      ZynthSetCurrentRuntimeHost(self);
      installConsole(*_runtime, self, @"js");
      installGlobals(*_runtime);
      installModuleBridge(*_runtime);
      [self installTimers];
      ZynthInstallUIBindings(*_runtime, manager);
      ZynthInstallUICommandsRegistry(self, *_runtime);
      _worklets = [[ZynthWorklets alloc] initWithHost:self];
      [_worklets installSharedSignalsOnRuntime:*_runtime];
      [_worklets installWorkletsBridgeOnRuntime:*_runtime];
      _runtime->global().setProperty(
          *_runtime, "__ZYNTH_PLATFORM", String::createFromUtf8(*_runtime, "ios"));
      ZynthInstallJSIPlugins(self, *_runtime);
    });
  }
  return self;
}

- (ZynthUIManager *)uiManager {
  return _manager;
}

- (ZynthWorklets *)worklets {
  return _worklets;
}

- (void)dealloc {
  ZynthSetCurrentRuntimeHost(nil);
  if (_runtime) {
    facebook::hermes::HermesRuntime *rt = _runtime.release();
    dispatch_queue_t queue = _jsQueue;
    if (queue) {
      dispatch_async(queue, ^{
        delete rt;
      });
    } else {
      delete rt;
    }
  }
}

- (void)installModuleBridge:(id<ZynthModuleBridge>)bridge constants:(NSDictionary<NSString *,id> *)constants {
  if (dispatch_get_specific(kZynthJSQueueKey) != kZynthJSQueueKey) {
    dispatch_sync(_jsQueue, ^{
      [self installModuleBridge:bridge constants:constants];
    });
    return;
  }
  _moduleBridge = bridge;
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

- (void)emitDevtoolsEventWithTopic:(NSString *)topic
                             level:(NSString *)level
                               tag:(NSString *)tag
                              data:(NSDictionary *)data {
  id<ZynthModuleBridge> bridge = _moduleBridge;
  if (!bridge || topic.length == 0) {
    return;
  }
  NSMutableDictionary *event = [NSMutableDictionary dictionary];
  event[@"topic"] = topic;
  if (level.length > 0) {
    event[@"level"] = level;
  }
  if (tag.length > 0) {
    event[@"tag"] = tag;
  }
  if (data) {
    event[@"data"] = data;
  }

  // Forward devtools events into JS so in-app overlays can react without
  // relying on networked devtools.
  @try {
    NSError *jsonError = nil;
    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:event options:0 error:&jsonError];
    if (jsonData != nil && jsonError == nil) {
      NSString *jsonString = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
      if (jsonString.length > 0 && _runtime != nullptr) {
        Runtime &rt = *_runtime;
        auto handlerId = PropNameID::forAscii(rt, "__zynth_onDevtoolsEventRaw");
        if (rt.global().hasProperty(rt, handlerId)) {
          Value handlerVal = rt.global().getProperty(rt, handlerId);
          if (handlerVal.isObject()) {
            Object handlerObj = handlerVal.asObject(rt);
            if (handlerObj.isFunction(rt)) {
              Function handlerFn = handlerObj.asFunction(rt);
              const char *utf8 = jsonString.UTF8String;
              if (utf8 != nullptr) {
                handlerFn.call(rt, String::createFromUtf8(rt, utf8));
              }
            }
          }
        }
      }
    }
  } @catch (NSException *) {
    // Never allow diagnostics forwarding to crash the runtime.
  }
  [bridge callModule:@"Devtools" method:@"emit" args:event];
}

- (BOOL)evaluateString:(NSString *)code
             sourceURL:(NSString *)sourceURL
                error:(NSError *_Nullable *_Nullable)error {
  if (!code) return NO;
  __block BOOL ok = NO;
  __block NSError *localError = nil;
  __weak ZynthHermesRuntimeHost *weakSelf = self;
  auto evalBlock = ^{
    ZynthHermesRuntimeHost *strongSelf = weakSelf;
    if (!strongSelf) {
      ok = NO;
      return;
    }
    NSData *data = [code dataUsingEncoding:NSUTF8StringEncoding];
    if (!data) {
      ok = NO;
      return;
    }
    try {
      auto buffer = std::make_shared<NSDataBuffer>(data);
      const char *source = sourceURL ? sourceURL.UTF8String : "<inline>";
      strongSelf->_runtime->evaluateJavaScript(buffer, source);
      ok = YES;
    } catch (const JSError &ex) {
      NSString *message = [NSString stringWithUTF8String:ex.getMessage().c_str()];
      NSString *stack = [NSString stringWithUTF8String:ex.getStack().c_str()];
      [strongSelf emitDevtoolsEventWithTopic:@"error/js"
                                       level:@"error"
                                         tag:@"js"
                                        data:@{
                                          @"context": sourceURL ?: @"<inline>",
                                          @"message": message ?: @"JS error",
                                          @"stack": stack ?: @"",
                                        }];
      NSDictionary *info = @{ NSLocalizedDescriptionKey : message ?: @"JS error" };
      localError = [NSError errorWithDomain:@"ZynthHermes" code:1 userInfo:info];
      ok = NO;
    } catch (const std::exception &ex) {
      NSString *message = [NSString stringWithUTF8String:ex.what()];
      NSDictionary *info = @{ NSLocalizedDescriptionKey : message ?: @"Runtime error" };
      localError = [NSError errorWithDomain:@"ZynthHermes" code:2 userInfo:info];
      ok = NO;
    }
  };
  if (dispatch_get_specific(kZynthJSQueueKey) == kZynthJSQueueKey) {
    evalBlock();
  } else {
    dispatch_sync(_jsQueue, evalBlock);
  }
  if (error) {
    *error = localError;
  }
  return ok;
}

- (BOOL)evaluateBytecode:(NSData *)data
               sourceURL:(NSString *)sourceURL
                  error:(NSError *_Nullable *_Nullable)error {
  if (!data) return NO;
  __block BOOL ok = NO;
  __block NSError *localError = nil;
  __weak ZynthHermesRuntimeHost *weakSelf = self;
  auto evalBlock = ^{
    ZynthHermesRuntimeHost *strongSelf = weakSelf;
    if (!strongSelf) {
      ok = NO;
      return;
    }
    NSString *string = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    if (!string) {
      NSDictionary *info = @{ NSLocalizedDescriptionKey : @"Invalid UTF-8 bytecode payload" };
      localError = [NSError errorWithDomain:@"ZynthHermes" code:3 userInfo:info];
      ok = NO;
      return;
    }
    ok = [strongSelf evaluateString:string sourceURL:sourceURL error:&localError];
  };
  if (dispatch_get_specific(kZynthJSQueueKey) == kZynthJSQueueKey) {
    evalBlock();
  } else {
    dispatch_sync(_jsQueue, evalBlock);
  }
  if (error) {
    *error = localError;
  }
  return ok;
}

- (id _Nullable)callGlobal:(NSString *)name args:(NSArray *)args {
  if (!name) return nil;
  if (dispatch_get_specific(kZynthJSQueueKey) != kZynthJSQueueKey) {
    __weak ZynthHermesRuntimeHost *weakSelf = self;
    dispatch_async(_jsQueue, ^{
      ZynthHermesRuntimeHost *strongSelf = weakSelf;
      if (!strongSelf) return;
      [strongSelf callGlobal:name args:args];
    });
    return nil;
  }
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
    NSString *message = [NSString stringWithUTF8String:error.getMessage().c_str()];
    NSString *stack = [NSString stringWithUTF8String:error.getStack().c_str()];
    [self emitDevtoolsEventWithTopic:@"error/js"
                               level:@"error"
                                 tag:@"js"
                                data:@{
                                  @"context": name ?: @"callGlobal",
                                  @"message": message ?: @"JS error",
                                  @"stack": stack ?: @"",
                                }];
    if (DEBUG_RUNTIME) {
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

- (id _Nullable)callGlobalObjectMethod:(NSString *)objectName
                                method:(NSString *)methodName
                                  args:(NSArray *)args {
  if (!objectName || !methodName) return nil;
  if (dispatch_get_specific(kZynthJSQueueKey) != kZynthJSQueueKey) {
    __weak ZynthHermesRuntimeHost *weakSelf = self;
    dispatch_async(_jsQueue, ^{
      ZynthHermesRuntimeHost *strongSelf = weakSelf;
      if (!strongSelf) return;
      [strongSelf callGlobalObjectMethod:objectName method:methodName args:args];
    });
    return nil;
  }
  Runtime &rt = *_runtime;
  auto objPropId = PropNameID::forAscii(rt, objectName.UTF8String);
  if (!rt.global().hasProperty(rt, objPropId)) return nil;
  
  Value objVal = rt.global().getProperty(rt, objPropId);
  if (!objVal.isObject()) return nil;
  Object obj = objVal.asObject(rt);

  auto methodPropId = PropNameID::forAscii(rt, methodName.UTF8String);
  if (!obj.hasProperty(rt, methodPropId)) return nil;

  Value methodVal = obj.getProperty(rt, methodPropId);
  if (!methodVal.isObject()) return nil;
  Object methodObj = methodVal.asObject(rt);
  if (!methodObj.isFunction(rt)) return nil;
  
  Function fn = methodObj.asFunction(rt);
  std::vector<Value> callArgs;
  for (id arg in args) {
    callArgs.push_back(objCToJSValue(rt, arg));
  }
  
  const Value *argsPtr = callArgs.empty() ? nullptr : callArgs.data();
  try {
    fn.callWithThis(rt, obj, argsPtr, callArgs.size());
  } catch (const JSError &error) {
    if (DEBUG_RUNTIME) {
       NSLog(@"[ZynthJS] callGlobalObjectMethod error: %s", error.getMessage().c_str());
    }
  } catch (...) {}
  
  return nil;
}

- (void)installTimers {
  Runtime &rt = *_runtime;
  __weak ZynthHermesRuntimeHost *weakHost = self;
  dispatch_queue_t jsQueue = _jsQueue;

  auto hostSetTimeout = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostSetTimeout"), 3,
      [weakHost, jsQueue](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
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
            dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, jsQueue);

        dispatch_source_t source = timer->source;
        host->_timers.emplace(timerId, std::move(timer));

        int64_t delayNs = delayMs < 0 ? 0 : (int64_t)delayMs * NSEC_PER_MSEC;
        dispatch_source_set_timer(
            source, dispatch_time(DISPATCH_TIME_NOW, delayNs), DISPATCH_TIME_FOREVER, 0);

        dispatch_source_set_event_handler(source, ^{
          ZynthHermesRuntimeHost *strongHost = weakHost;
          if (!strongHost) return;
          auto it = strongHost->_timers.find(timerId);
          if (it == strongHost->_timers.end()) return;
          auto &timerRef = *it->second;
          const Value *argsPtr =
              timerRef.args.empty() ? nullptr : timerRef.args.data();
          try {
            timerRef.fn->call(rt, argsPtr, timerRef.args.size());
          } catch (const JSError &error) {
            NSString *message = [NSString stringWithUTF8String:error.getMessage().c_str()];
            NSString *stack = [NSString stringWithUTF8String:error.getStack().c_str()];
            [strongHost emitDevtoolsEventWithTopic:@"error/js"
                                       level:@"error"
                                         tag:@"js"
                                        data:@{
                                          @"context": @"setTimeout",
                                          @"message": message ?: @"JS error",
                                          @"stack": stack ?: @"",
                                        }];
            if (DEBUG_RUNTIME) {
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
          strongHost->_timers.erase(it);
        });

        dispatch_resume(source);
        return Value(static_cast<double>(timerId));
      });

  auto hostSetInterval = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostSetInterval"), 3,
      [weakHost, jsQueue](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
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
            dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, jsQueue);

        dispatch_source_t source = timer->source;
        host->_timers.emplace(timerId, std::move(timer));

        dispatch_source_set_timer(
            source, dispatch_time(DISPATCH_TIME_NOW, intervalNs), intervalNs, 0);

        dispatch_source_set_event_handler(source, ^{
          ZynthHermesRuntimeHost *strongHost = weakHost;
          if (!strongHost) return;
          auto it = strongHost->_timers.find(timerId);
          if (it == strongHost->_timers.end()) return;
          auto &timerRef = *it->second;
          const Value *argsPtr =
              timerRef.args.empty() ? nullptr : timerRef.args.data();
          try {
            timerRef.fn->call(rt, argsPtr, timerRef.args.size());
          } catch (const JSError &error) {
            NSString *message = [NSString stringWithUTF8String:error.getMessage().c_str()];
            NSString *stack = [NSString stringWithUTF8String:error.getStack().c_str()];
            [strongHost emitDevtoolsEventWithTopic:@"error/js"
                                       level:@"error"
                                         tag:@"js"
                                        data:@{
                                          @"context": @"setInterval",
                                          @"message": message ?: @"JS error",
                                          @"stack": stack ?: @"",
                                        }];
            if (DEBUG_RUNTIME) {
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
      "globalThis.clearImmediate=(id)=>__hostClearTimeout(id);"
      "globalThis.requestAnimationFrame=(fn)=>__hostSetTimeout(fn,16,[]);"
      "globalThis.cancelAnimationFrame=(id)=>__hostClearTimeout(id);";

  auto buffer = std::make_shared<StringBuffer>(timerScript);
  _runtime->evaluateJavaScript(buffer, "timers.js");
}

@end
