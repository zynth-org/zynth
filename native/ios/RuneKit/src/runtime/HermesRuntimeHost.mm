#import "HermesRuntimeHost.h"

#import <hermes/hermes.h>
#import <jsi/jsi.h>
#import <dispatch/dispatch.h>
#import <objc/message.h>

#if __has_include(<RuneKit/RuneKit-Swift.h>)
#import <RuneKit/RuneKit-Swift.h>
#elif __has_include("RuneKit-Swift.h")
#import "RuneKit-Swift.h"
#endif

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

struct TimerEntry {
  dispatch_source_t source;
  std::shared_ptr<Function> callback;
  std::vector<Value> args;
};

inline void SNShowRedBox(NSString *title, NSString *message, NSString *stack) {
  Class redBoxClass = NSClassFromString(@"DevRedBox");
  if (redBoxClass && [redBoxClass respondsToSelector:@selector(showWithTitle:message:stack:)]) {
    auto showSelector = @selector(showWithTitle:message:stack:);
    void (*showFunc)(id, SEL, NSString *, NSString *, NSString *) = (void (*)(id, SEL, NSString *, NSString *, NSString *))objc_msgSend;
    showFunc(redBoxClass, showSelector, title, message, stack);
  }
}

inline void SNCallJSFunction(Function &fn, Runtime &rt, const Value *args, size_t count) {
  const auto callPtr = static_cast<Value (Function::*)(Runtime&, const Value*, size_t) const>(&Function::call);
  (fn.*callPtr)(rt, args, count);
}

Value SNMakePromise(Runtime &rt, std::function<void(Function &&resolve, Function &&reject)> work) {
  auto promiseCtor = rt.global().getPropertyAsFunction(rt, "Promise");
  auto workPtr = std::make_shared<std::function<void(Function &&, Function &&)>>(std::move(work));

  auto executor = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__runePromiseExecutor"), 2,
      [workPtr](Runtime &rt, const Value &, const Value *argv, size_t argc) -> Value {
        if (argc < 2 || !argv[0].isObject() || !argv[1].isObject()) {
          return Value::undefined();
        }
        auto resolve = argv[0].asObject(rt).asFunction(rt);
        auto reject = argv[1].asObject(rt).asFunction(rt);
        (*workPtr)(std::move(resolve), std::move(reject));
        return Value::undefined();
      });

  return promiseCtor.callAsConstructor(rt, executor);
}
}

@interface HermesRuntimeHost ()
@property(nonatomic, strong) SNUIManager *manager;
- (void)reportExceptionWithContext:(NSString *)context message:(const std::string &)message stack:(const std::string &)stack;
- (void)reportJSException:(const facebook::jsi::JSError &)error context:(NSString *)context;
- (void)reportStdException:(const std::exception &)ex context:(NSString *)context;
@end

@implementation HermesRuntimeHost {
  std::unique_ptr<facebook::hermes::HermesRuntime> _rt;
  std::unordered_map<HandlerKey, std::shared_ptr<Function>, HandlerKeyHash> _handlers;
  std::unordered_map<uint64_t, TimerEntry> _timers;
  dispatch_queue_t _jsQueue;
  dispatch_queue_t _moduleQueue;
  uint64_t _nextTimerId;
}

- (instancetype)initWithUIManager:(SNUIManager *)manager {
  if (self = [super init]) {
    _manager = manager;
    _jsQueue = dispatch_queue_create("com.rune.hermes.js", DISPATCH_QUEUE_SERIAL);
    _moduleQueue = dispatch_queue_create("com.rune.hermes.modules", DISPATCH_QUEUE_CONCURRENT);
    _nextTimerId = 1;

    dispatch_sync(_jsQueue, ^{
      _rt = facebook::hermes::makeHermesRuntime();
      _manager.jsInvoker = self;
      [self installConsole];
      [self installUIBridge];
      [self installModulesBridge];
      [self installTimers];
      [self installUnhandledPromiseReporting];
    });
  }
  return self;
}

- (void)reportExceptionMessage:(const std::string &)message {
  [self reportExceptionWithContext:@"Hermes" message:message stack:""];
}

- (void)reportExceptionWithContext:(NSString *)context
                            message:(const std::string &)message
                               stack:(const std::string &)stack {
  NSString *title = context ?: @"Hermes";
  NSString *msg = message.empty() ? @"Unknown Error" : [NSString stringWithUTF8String:message.c_str()];
  NSString *stackString = stack.empty() ? nil : [NSString stringWithUTF8String:stack.c_str()];

  NSLog(@"[Hermes] %@: %@", title, msg);

  if (self.exceptionHandler) {
    self.exceptionHandler(msg, stackString);
  } else {
    dispatch_async(dispatch_get_main_queue(), ^{
      SNShowRedBox(title, msg, stackString);
    });
  }
}

- (void)reportJSException:(const facebook::jsi::JSError &)error context:(NSString *)context {
  std::string message = error.getMessage();
  std::string stack = error.getStack();
  [self reportExceptionWithContext:context message:message stack:stack];
}

- (void)reportStdException:(const std::exception &)ex context:(NSString *)context {
  std::string message = ex.what();
  [self reportExceptionWithContext:context message:message stack:""];
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
        try {
          if (count < 1 || !args[0].isString()) {
            return Value::undefined();
          }
          std::string type = args[0].getString(rt).utf8(rt);
          int nid = [[host manager] createNode:[NSString stringWithUTF8String:type.c_str()]].intValue;
          NSString *typeStr = [NSString stringWithUTF8String:type.c_str()];
          NSLog(@"[RuneTrace] __ui.createNode type=%@ -> id=%d", typeStr, nid);
          return Value((double)nid);
        } catch (const facebook::jsi::JSError &error) {
          [host reportJSException:error context:@"__ui.createNode"];
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"__ui.createNode"];
        }
        return Value::undefined();
      });

  auto hostSetProp = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setProp"), 3,
      [host](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        try {
          if (count < 3) {
            return Value::undefined();
          }
          int id = (int)a[0].asNumber();
          std::string name = a[1].getString(rt).utf8(rt);
          NSString *nameStr = [NSString stringWithUTF8String:name.c_str()];
          NSLog(@"[RuneTrace] __ui.setProp id=%d name=%@", id, nameStr);
          if (name == "style" && a[2].isObject()) {
            Object styleObj = a[2].asObject(rt);
            NSMutableDictionary *styleDict = [NSMutableDictionary dictionary];

            auto copyNumber = [&](const char *prop) {
              if (!styleObj.hasProperty(rt, prop)) {
                return;
              }
              Value v = styleObj.getProperty(rt, prop);
              if (!v.isNumber()) {
                return;
              }
              NSString *key = [NSString stringWithUTF8String:prop];
              styleDict[key] = @(v.asNumber());
            };

            auto copyString = [&](const char *prop) {
              if (!styleObj.hasProperty(rt, prop)) {
                return;
              }
              Value v = styleObj.getProperty(rt, prop);
              if (!v.isString()) {
                return;
              }
              std::string utf8 = v.getString(rt).utf8(rt);
              NSString *key = [NSString stringWithUTF8String:prop];
              styleDict[key] = [NSString stringWithUTF8String:utf8.c_str()];
            };

            const char *numericKeys[] = {"width",          "height",         "flex",           "padding",
                                         "paddingHorizontal", "paddingVertical", "paddingTop",    "paddingRight",
                                         "paddingBottom",  "margin",         "marginHorizontal", "marginVertical",
                                         "marginTop",      "marginRight",    "marginBottom",   "borderRadius",
                                         "fontSize"};
            for (const char *key : numericKeys) {
              copyNumber(key);
            }

            const char *stringKeys[] = {"flexDirection", "justifyContent", "alignItems",
                                         "backgroundColor", "fontWeight",   "color"};
            for (const char *key : stringKeys) {
              copyString(key);
            }

            [[host manager] setStyle:@(id) style:styleDict];
            return Value::undefined();
          }

          auto JSON = rt.global().getPropertyAsObject(rt, "JSON");
          auto stringify = JSON.getPropertyAsFunction(rt, "stringify");
          auto str = stringify.call(rt, Value(rt, a[2])).getString(rt).utf8(rt);
          [[host manager] setProp:@(id)
                                name:[NSString stringWithUTF8String:name.c_str()]
                           valueJSON:[NSString stringWithUTF8String:str.c_str()]];
        } catch (const facebook::jsi::JSError &error) {
          [host reportJSException:error context:@"__ui.setProp"];
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"__ui.setProp"];
        }
        return Value::undefined();
      });

  auto hostSetText = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setText"), 2,
      [host](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        try {
          if (count < 2) {
            return Value::undefined();
          }
          int id = (int)a[0].asNumber();
          auto text = a[1].getString(rt).utf8(rt);
          NSLog(@"[RuneTrace] __ui.setText id=%d", id);
          [[host manager] setText:@(id) text:[NSString stringWithUTF8String:text.c_str()]];
        } catch (const facebook::jsi::JSError &error) {
          [host reportJSException:error context:@"__ui.setText"];
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"__ui.setText"];
        }
        return Value::undefined();
      });

  auto hostInsertChild = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "insertChild"), 3,
      [host](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        try {
          if (count < 3) {
            return Value::undefined();
          }
          int parentId = (int)a[0].asNumber();
          int childId = (int)a[1].asNumber();
          int index = (int)a[2].asNumber();
          NSLog(@"[RuneTrace] __ui.insertChild parent=%d child=%d index=%d", parentId, childId, index);
          [[host manager] insertChild:@(parentId)
                                 child:@(childId)
                                 index:@(index)];
        } catch (const facebook::jsi::JSError &error) {
          [host reportJSException:error context:@"__ui.insertChild"];
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"__ui.insertChild"];
        }
        return Value::undefined();
      });

  auto hostRemoveChild = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "removeChild"), 2,
      [host](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        try {
          if (count < 2) {
            return Value::undefined();
          }
          int parentId = (int)a[0].asNumber();
          int childId = (int)a[1].asNumber();
          NSLog(@"[RuneTrace] __ui.removeChild parent=%d child=%d", parentId, childId);
          [[host manager] removeChild:@(parentId) child:@(childId)];
          [host sn_removeHandlersForNode:childId];
        } catch (const facebook::jsi::JSError &error) {
          [host reportJSException:error context:@"__ui.removeChild"];
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"__ui.removeChild"];
        }
        return Value::undefined();
      });

  auto hostSetHandler = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setHandler"), 3,
      [host](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        try {
          if (count < 3) {
            return Value::undefined();
          }
          int id = (int)a[0].asNumber();
          std::string name = a[1].getString(rt).utf8(rt);
          auto fn = a[2].asObject(rt).asFunction(rt);
          host->_handlers[{id, name}] = std::make_shared<Function>(std::move(fn));
          [[host manager] setHandler:@(id) name:[NSString stringWithUTF8String:name.c_str()]];
        } catch (const facebook::jsi::JSError &error) {
          [host reportJSException:error context:@"__ui.setHandler"];
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"__ui.setHandler"];
        }
        return Value::undefined();
      });

  auto hostFlush = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "flush"), 0,
      [host](Runtime &, const Value &, const Value *, size_t) -> Value {
        @try {
          [[host manager] flush];
        } @catch (NSException *exception) {
          std::string message = exception.reason ? [exception.reason UTF8String] : "flush failed";
          [host reportExceptionWithContext:@"__ui.flush" message:message stack:""];
        }
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

- (void)sn_removeHandlersForNode:(int)nodeId {
  auto it = _handlers.begin();
  while (it != _handlers.end()) {
    if (it->first.id == nodeId) {
      it = _handlers.erase(it);
    } else {
      ++it;
    }
  }
}

- (void)installModulesBridge {
  auto &rt = *_rt;
  HermesRuntimeHost *host = self;

  auto hostCall = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "call"), 3,
      [host](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        try {
          if (count < 3) {
            return Value::undefined();
          }
          std::string module = a[0].getString(rt).utf8(rt);
          std::string method = a[1].getString(rt).utf8(rt);
          auto JSON = rt.global().getPropertyAsObject(rt, "JSON");
          auto stringify = JSON.getPropertyAsFunction(rt, "stringify");
          auto argsJSON = stringify.call(rt, Value(rt, a[2])).getString(rt).utf8(rt);

          return SNMakePromise(rt, [host, module, method, argsJSON](Function &&resolve, Function &&reject) {
            auto resolvePtr = std::make_shared<Function>(std::move(resolve));
            auto rejectPtr = std::make_shared<Function>(std::move(reject));

            dispatch_async(host->_moduleQueue, ^{
              @autoreleasepool {
              NSString *resultString = nil;
              NSString *errorString = nil;
              @try {
                if (host.moduleCallHandler) {
                  NSString *moduleName = [NSString stringWithUTF8String:module.c_str()];
                  NSString *methodName = [NSString stringWithUTF8String:method.c_str()];
                  NSString *argsString = [NSString stringWithUTF8String:argsJSON.c_str()];
                  resultString = host.moduleCallHandler(moduleName, methodName, argsString);
                } else {
                  resultString = @"{}";
                }
              } @catch (NSException *exception) {
                errorString = [NSString stringWithFormat:@"Module call threw: %@", exception.reason ?: @"unknown"];
              }

              if (errorString) {
                std::string message = [errorString UTF8String] ? std::string([errorString UTF8String]) : std::string("Module call error");
                dispatch_async(host->_jsQueue, ^{
                  auto &rtRef = *host->_rt;
                  [host reportExceptionWithContext:@"Native Module" message:message stack:""];
                  Object errorObj(rtRef);
                  errorObj.setProperty(rtRef, "code", String::createFromUtf8(rtRef, "E_NATIVE"));
                  errorObj.setProperty(rtRef, "message", String::createFromUtf8(rtRef, message));
                  Value errorValue = Value(rtRef, errorObj);
                  SNCallJSFunction(*rejectPtr, rtRef, &errorValue, 1);
                });
                return;
              }

              if (!resultString) {
                resultString = @"{}";
              }
              std::string resultStd = [resultString UTF8String] ? std::string([resultString UTF8String]) : std::string("{}");

              dispatch_async(host->_jsQueue, ^{
                auto &rtRef = *host->_rt;
                try {
                  auto JSONObj = rtRef.global().getPropertyAsObject(rtRef, "JSON");
                  auto parse = JSONObj.getPropertyAsFunction(rtRef, "parse");
                  auto jsString = String::createFromUtf8(rtRef, resultStd);
                  Value parsed = parse.call(rtRef, Value(std::move(jsString)));
                  Value resultValue = Value(rtRef, parsed);
                  SNCallJSFunction(*resolvePtr, rtRef, &resultValue, 1);
                } catch (const facebook::jsi::JSError &error) {
                  [host reportJSException:error context:@"Native Module"];
                  Object errorObj(rtRef);
                  errorObj.setProperty(rtRef, "code", String::createFromUtf8(rtRef, "E_JS"));
                  errorObj.setProperty(rtRef, "message", String::createFromUtf8(rtRef, error.getMessage()));
                  Value errorValue = Value(rtRef, errorObj);
                  SNCallJSFunction(*rejectPtr, rtRef, &errorValue, 1);
                } catch (const std::exception &ex) {
                  std::string message(ex.what());
                  [host reportStdException:ex context:@"Native Module"];
                  Object errorObj(rtRef);
                  errorObj.setProperty(rtRef, "code", String::createFromUtf8(rtRef, "E_NATIVE"));
                  errorObj.setProperty(rtRef, "message", String::createFromUtf8(rtRef, message));
                  Value errorValue = Value(rtRef, errorObj);
                  SNCallJSFunction(*rejectPtr, rtRef, &errorValue, 1);
                }
              });
            }
          });
          });
        } catch (const facebook::jsi::JSError &error) {
          [host reportJSException:error context:@"__modules.call"];
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"__modules.call"];
        }
        return Value::undefined();
      });

  Object modules(rt);
  modules.setProperty(rt, "call", hostCall);
  rt.global().setProperty(rt, "__modules", modules);
}

- (uint64_t)sn_scheduleTimerWithDelay:(double)delayMillis
                               callback:(std::shared_ptr<Function>)callback
                                   args:(std::vector<Value>)args {
  double clamped = delayMillis < 0 ? 0 : delayMillis;
  int64_t delayNs = (int64_t)(clamped * NSEC_PER_MSEC);

  uint64_t timerId = _nextTimerId++;
  dispatch_source_t timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, _jsQueue);

  TimerEntry entry{timer, callback, std::move(args)};
  _timers.emplace(timerId, std::move(entry));

  HermesRuntimeHost *host = self;
  dispatch_source_set_timer(timer, dispatch_time(DISPATCH_TIME_NOW, delayNs), DISPATCH_TIME_FOREVER, 0);
  dispatch_source_set_event_handler(timer, ^{
    auto it = host->_timers.find(timerId);
    if (it == host->_timers.end()) {
      return;
    }
    TimerEntry &entryRef = it->second;
    auto &rt = *host->_rt;
    const Value *argsPtr = entryRef.args.empty() ? nullptr : entryRef.args.data();
    try {
      entryRef.callback->call(rt, argsPtr, entryRef.args.size());
    } catch (const facebook::jsi::JSError &error) {
      [host reportJSException:error context:@"Timer"];
    } catch (const std::exception &ex) {
      [host reportStdException:ex context:@"Timer"];
    }
    dispatch_source_cancel(entryRef.source);
    host->_timers.erase(timerId);
  });

  dispatch_resume(timer);
  return timerId;
}

- (void)sn_clearTimer:(uint64_t)timerId {
  auto it = _timers.find(timerId);
  if (it == _timers.end()) {
    return;
  }
  dispatch_source_cancel(it->second.source);
  _timers.erase(it);
}

- (void)installTimers {
  auto &rt = *_rt;
  HermesRuntimeHost *host = self;

  auto hostSetTimeout = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostSetTimeout"), 3,
      [host](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        try {
          if (count < 2 || !a[0].isObject()) {
            return Value::undefined();
          }
          auto fn = a[0].asObject(rt).asFunction(rt);
          double delay = (count > 1 && a[1].isNumber()) ? a[1].asNumber() : 0;
          std::vector<Value> args;
          if (count > 2) {
            args.reserve(count - 2);
            for (size_t i = 2; i < count; ++i) {
              args.emplace_back(Value(rt, a[i]));
            }
          }
          auto callback = std::make_shared<Function>(std::move(fn));
          uint64_t timerId = [host sn_scheduleTimerWithDelay:delay callback:callback args:std::move(args)];
          return Value(static_cast<double>(timerId));
        } catch (const facebook::jsi::JSError &error) {
          [host reportJSException:error context:@"setTimeout"];
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"setTimeout"];
        }
        return Value::undefined();
      });

  auto hostClearTimeout = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostClearTimeout"), 1,
      [host](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        try {
          if (count < 1 || !a[0].isNumber()) {
            return Value::undefined();
          }
          uint64_t timerId = (uint64_t)a[0].asNumber();
          [host sn_clearTimer:timerId];
        } catch (const facebook::jsi::JSError &error) {
          [host reportJSException:error context:@"clearTimeout"];
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"clearTimeout"];
        }
        return Value::undefined();
      });

  rt.global().setProperty(rt, "__hostSetTimeout", hostSetTimeout);
  rt.global().setProperty(rt, "__hostClearTimeout", hostClearTimeout);

  static const char *timerScript =
      "globalThis.setTimeout=(fn,ms,...a)=>__hostSetTimeout(fn,ms|0,...a);"
      "globalThis.clearTimeout=(id)=>__hostClearTimeout(id);";

  auto buffer = std::make_shared<StringBuffer>(timerScript);
  _rt->evaluateJavaScript(buffer, "timers.js");
}

- (void)installUnhandledPromiseReporting {
  auto &rt = *_rt;
  HermesRuntimeHost *host = self;

  auto hostReportUnhandled = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostReportUnhandled"), 2,
      [host](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        std::string message;
        std::string stack;
        if (count > 0 && a[0].isString()) {
          message = a[0].getString(rt).utf8(rt);
        }
        if (count > 1 && a[1].isString()) {
          stack = a[1].getString(rt).utf8(rt);
        }
        if (message.empty()) {
          message = "Unhandled promise rejection";
        }
        [host reportExceptionWithContext:@"Unhandled Promise" message:message stack:stack];
        return Value::undefined();
      });

  rt.global().setProperty(rt, "__hostReportUnhandled", hostReportUnhandled);

  static const char *unhandledScript =
      "(function(){\n"
      "if(globalThis.__runeUnhandledInstalled) return;\n"
      "if(typeof __hostReportUnhandled !== 'function'){ globalThis.__runeUnhandledInstalled = true; return; }\n"
      "const report = (reason) => {\n"
      "  let message = '';\n"
      "  let stack = '';\n"
      "  if (reason && typeof reason.message === 'string') { message = reason.message; } else { message = String(reason); }\n"
      "  if (reason && typeof reason.stack === 'string') { stack = reason.stack; }\n"
      "  __hostReportUnhandled(message, stack);\n"
      "};\n"
      "const originalCatch = Promise.prototype.catch;\n"
      "const originalThen = Promise.prototype.then;\n"
      "Promise.prototype.catch = function(onRejected){\n"
      "  if (typeof onRejected !== 'function') {\n"
      "    return originalCatch.call(this, function(reason){ report(reason); throw reason; });\n"
      "  }\n"
      "  return originalCatch.call(this, function(reason){\n"
      "    try { return onRejected(reason); } catch (err) { report(err); throw err; }\n"
      "  });\n"
      "};\n"
      "Promise.prototype.then = function(onFulfilled, onRejected){\n"
      "  const wrappedRejected = typeof onRejected === 'function' ? function(reason){\n"
      "    try { return onRejected(reason); } catch (err) { report(err); throw err; }\n"
      "  } : function(reason){ report(reason); throw reason; };\n"
      "  return originalThen.call(this, onFulfilled, wrappedRejected);\n"
      "};\n"
      "globalThis.__runeUnhandledInstalled = true;\n"
      "})();";

  auto buffer = std::make_shared<StringBuffer>(unhandledScript);
  _rt->evaluateJavaScript(buffer, "promises.js");
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
  dispatch_sync(_jsQueue, ^{
    try {
      auto buffer = std::make_shared<StringBuffer>(code.UTF8String);
      _rt->evaluateJavaScript(buffer, "main.js");
    } catch (const facebook::jsi::JSError &error) {
      [self reportJSException:error context:@"Evaluate"];
    } catch (const std::exception &ex) {
      [self reportStdException:ex context:@"Evaluate"];
    }
  });
}

- (id)callGlobal:(NSString *)name args:(NSArray *)args {
  dispatch_sync(_jsQueue, ^{
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
      [self reportJSException:error context:@"callGlobal"];
    } catch (const std::exception &ex) {
      [self reportStdException:ex context:@"callGlobal"];
    }
  });
  return nil;
}

@end
