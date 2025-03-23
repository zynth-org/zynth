#import "HermesRuntimeHost.h"

#import <hermes/hermes.h>
#import <jsi/jsi.h>
#import <dispatch/dispatch.h>
#import <CoreFoundation/CoreFoundation.h>
#import <objc/message.h>

#if __has_include(<RuneKit/RuneKit-Swift.h>)
#import <RuneKit/RuneKit-Swift.h>
#elif __has_include("RuneKit-Swift.h")
#import "RuneKit-Swift.h"
#endif

extern "C" void RuneDiagnosticsReport(const char *phase, const char *message, const char *stack) noexcept;

#import <atomic>
#import <unordered_map>
#import <memory>
#import <functional>
#import <string>
#import <vector>
#import <utility>
#import <exception>
#include <cstring>

using namespace facebook::jsi;

static inline void SNRunOnMain(void (^block)(void)) {
  if (!block) {
    return;
  }
  if ([NSThread isMainThread]) {
    block();
  } else {
    dispatch_sync(dispatch_get_main_queue(), block);
  }
}

namespace {
struct NSDataBuffer final : public facebook::jsi::Buffer {
  NSData *data_;
  explicit NSDataBuffer(NSData *data) : data_(data) {}
  size_t size() const override { return (size_t)[data_ length]; }
  const uint8_t *data() const override { return (const uint8_t *)[data_ bytes]; }
};
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

struct Timer {
  int id;
  std::shared_ptr<Function> fn;
  std::vector<Value> args;
  dispatch_source_t source;
};

static std::atomic<int> gNextTimer{1};
static std::unordered_map<int, std::unique_ptr<Timer>> gTimers;

inline void SNShowRedBox(NSString *title, NSString *message, NSString *stack) {
  Class redBoxClass = NSClassFromString(@"DevRedBox");
  if (redBoxClass && [redBoxClass respondsToSelector:@selector(showWithTitle:message:stack:)]) {
    auto showSelector = @selector(showWithTitle:message:stack:);
    void (*showFunc)(id, SEL, NSString *, NSString *, NSString *) = (void (*)(id, SEL, NSString *, NSString *, NSString *))objc_msgSend;
    showFunc(redBoxClass, showSelector, title, message, stack);
  }
}

static void RuneReportJSIError(facebook::jsi::Runtime &rt,
                               const facebook::jsi::JSError &error,
                               const char *phase) {
  std::string message;
  std::string stack;

  try {
    message = error.getMessage();
  } catch (...) {
  }

  try {
    stack = error.getStack();
  } catch (...) {
    // It's possible for getStack to throw, so we guard against it.
  }

  // Best-effort: avoid copying JSI values which may be move-only across some Hermes/JSI versions.
  // If message is empty, keep default; stack will remain empty if not retrievable.

  if (message.empty()) {
    message = "Unknown JSI error";
  }

  RuneDiagnosticsReport(phase ? phase : "jsi", message.c_str(), stack.c_str());
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

static bool SNNSNumberIsBool(NSNumber *number) {
  return CFGetTypeID((__bridge CFTypeRef)number) == CFBooleanGetTypeID();
}

static id SNConvertJSIValueToNSObject(Runtime &rt, const Value &value);
static Value SNConvertNSObjectToJSI(Runtime &rt, id object);

static id SNConvertJSIObjectToNSDictionary(Runtime &rt, Object &&object) {
  auto propertyNames = object.getPropertyNames(rt);
  const size_t length = propertyNames.size(rt);
  NSMutableDictionary *dictionary = [NSMutableDictionary dictionaryWithCapacity:length];

  for (size_t i = 0; i < length; ++i) {
    Value nameValue = propertyNames.getValueAtIndex(rt, i);
    if (!nameValue.isString()) {
      continue;
    }
    std::string keyStd = nameValue.getString(rt).utf8(rt);
    NSString *key = [NSString stringWithUTF8String:keyStd.c_str()];
    if (!key) {
      continue;
    }
    Value propertyValue = object.getProperty(rt, keyStd.c_str());
    id converted = SNConvertJSIValueToNSObject(rt, propertyValue);
    if (!converted) {
      converted = [NSNull null];
    }
    dictionary[key] = converted;
  }

  return [dictionary copy];
}

static id SNConvertJSIArrayToNSArray(Runtime &rt, Array &&array) {
  const size_t length = array.size(rt);
  NSMutableArray *result = [NSMutableArray arrayWithCapacity:length];

  for (size_t i = 0; i < length; ++i) {
    Value element = array.getValueAtIndex(rt, i);
    id converted = SNConvertJSIValueToNSObject(rt, element);
    [result addObject:converted ?: [NSNull null]];
  }

  return [result copy];
}

static id SNConvertJSIValueToNSObject(Runtime &rt, const Value &value) {
  if (value.isUndefined()) {
    return nil;
  }
  if (value.isNull()) {
    return [NSNull null];
  }
  if (value.isBool()) {
    return @(value.getBool());
  }
  if (value.isNumber()) {
    return @(value.getNumber());
  }
  if (value.isString()) {
    std::string str = value.getString(rt).utf8(rt);
    return [NSString stringWithUTF8String:str.c_str()];
  }
  if (value.isObject()) {
    auto object = value.asObject(rt);
    if (object.isArrayBuffer(rt)) {
      auto arrayBuffer = object.getArrayBuffer(rt);
      size_t length = arrayBuffer.size(rt);
      const uint8_t *bytes = arrayBuffer.data(rt);
      if (length == 0 || bytes == nullptr) {
        return [NSData data];
      }
      return [NSData dataWithBytes:bytes length:length];
    }
    if (object.isArray(rt)) {
      return SNConvertJSIArrayToNSArray(rt, object.asArray(rt));
    }
    if (object.isFunction(rt)) {
      return [NSNull null];
    }
    return SNConvertJSIObjectToNSDictionary(rt, std::move(object));
  }

  return [NSNull null];
}

static Value SNConvertNSObjectArrayToJSI(Runtime &rt, NSArray *array) {
  Array jsArray(rt, array.count);
  for (NSUInteger i = 0; i < array.count; ++i) {
    Value converted = SNConvertNSObjectToJSI(rt, array[i]);
    jsArray.setValueAtIndex(rt, i, std::move(converted));
  }
  return Value(rt, jsArray);
}

static Value SNConvertNSObjectDictionaryToJSI(Runtime &rt, NSDictionary *dictionary) {
  Object jsObject(rt);
  for (id key in dictionary) {
    if (![key isKindOfClass:[NSString class]]) {
      continue;
    }
    NSString *keyString = (NSString *)key;
    Value converted = SNConvertNSObjectToJSI(rt, dictionary[key]);
    jsObject.setProperty(rt, keyString.UTF8String, std::move(converted));
  }
  return Value(rt, jsObject);
}

static Value SNConvertNSObjectToJSI(Runtime &rt, id object) {
  if (!object) {
    return Value::undefined();
  }
  if (object == [NSNull null]) {
    return Value::null();
  }
  if ([object isKindOfClass:[NSString class]]) {
    NSString *string = (NSString *)object;
    return Value(rt, String::createFromUtf8(rt, string.UTF8String ?: ""));
  }
  if ([object isKindOfClass:[NSNumber class]]) {
    NSNumber *number = (NSNumber *)object;
    if (SNNSNumberIsBool(number)) {
      return Value(number.boolValue);
    }
    return Value(number.doubleValue);
  }
  if ([object isKindOfClass:[NSArray class]]) {
    return SNConvertNSObjectArrayToJSI(rt, (NSArray *)object);
  }
  if ([object isKindOfClass:[NSDictionary class]]) {
    return SNConvertNSObjectDictionaryToJSI(rt, (NSDictionary *)object);
  }
  if ([object isKindOfClass:[NSData class]]) {
    NSData *data = (NSData *)object;
    size_t length = data.length;
    try {
      auto global = rt.global();
      if (!global.hasProperty(rt, "ArrayBuffer")) {
        return Value::undefined();
      }

      auto ctorValue = global.getProperty(rt, "ArrayBuffer");
      if (!ctorValue.isObject() || !ctorValue.asObject(rt).isFunction(rt)) {
        return Value::undefined();
      }

      auto ctor = ctorValue.asObject(rt).asFunction(rt);
  Value bufferValue = ctor.callAsConstructor(rt, (double)length);
      auto bufferObject = bufferValue.asObject(rt);
      auto buffer = bufferObject.getArrayBuffer(rt);
      if (length > 0 && data.bytes != NULL) {
        memcpy(buffer.data(rt), data.bytes, length);
      }
      return bufferValue;
    } catch (const facebook::jsi::JSError &error) {
      RuneReportJSIError(rt, error, "ArrayBufferCtor");
    } catch (const std::exception &ex) {
      RuneDiagnosticsReport("ArrayBufferCtor", ex.what(), "");
    }
    return Value::undefined();
  }

  return Value::undefined();
}
}

@interface HermesRuntimeHost ()
@property(nonatomic, strong) SNUIManager *manager;
- (void)reportExceptionWithContext:(NSString *)context message:(const std::string &)message stack:(const std::string &)stack;
- (void)reportStdException:(const std::exception &)ex context:(NSString *)context;
@end

@implementation HermesRuntimeHost {
  std::unique_ptr<facebook::hermes::HermesRuntime> _rt;
  std::unordered_map<HandlerKey, std::shared_ptr<Function>, HandlerKeyHash> _handlers;
  dispatch_queue_t _jsQueue;
  dispatch_queue_t _moduleQueue;
}

- (instancetype)initWithUIManager:(SNUIManager *)manager {
  if (self = [super init]) {
    _manager = manager;
    _jsQueue = dispatch_queue_create("com.rune.hermes.js", DISPATCH_QUEUE_SERIAL);
    _moduleQueue = dispatch_queue_create("com.rune.hermes.modules", DISPATCH_QUEUE_CONCURRENT);

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

- (void)reportStdException:(const std::exception &)ex context:(NSString *)context {
  std::string message = ex.what();
  [self reportExceptionWithContext:context message:message stack:""];
}

- (void)installConsole {
  auto &rt = *_rt;

  auto makeConsoleFunction = [&](const char *methodName) {
    std::string level = methodName ? methodName : "log";
    return Function::createFromHostFunction(
        rt, PropNameID::forAscii(rt, methodName), 0,
        [level](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
          std::string message;
          for (size_t i = 0; i < count; ++i) {
            std::string part;
            try {
              if (args[i].isString()) {
                part = args[i].getString(rt).utf8(rt);
              } else {
                part = args[i].toString(rt).utf8(rt);
              }
            } catch (...) {
              part = "<unprintable>";
            }
            if (i > 0) {
              message.append(" ");
            }
            message.append(part);
          }

          NSLog(@"JS[%s] %s", level.c_str(), message.c_str());

          if (level == "error") {
            RuneDiagnosticsReport("console.error", message.c_str(), "");
          }

          return Value::undefined();
        });
  };

  Object console(rt);
  auto consoleLog = makeConsoleFunction("log");
  auto consoleInfo = makeConsoleFunction("info");
  auto consoleDebug = makeConsoleFunction("debug");
  auto consoleWarn = makeConsoleFunction("warn");
  auto consoleError = makeConsoleFunction("error");
  auto consoleTrace = makeConsoleFunction("trace");

  console.setProperty(rt, "log", consoleLog);
  console.setProperty(rt, "info", consoleInfo);
  console.setProperty(rt, "debug", consoleDebug);
  console.setProperty(rt, "warn", consoleWarn);
  console.setProperty(rt, "error", consoleError);
  console.setProperty(rt, "trace", consoleTrace);
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
          __block int nid = 0;
          SNRunOnMain(^{
            NSString *typeStr = [NSString stringWithUTF8String:type.c_str()];
            nid = [[host manager] createNode:typeStr].intValue;
            // NSLog(@"[RuneTrace] __ui.createNode type=%@ -> id=%d", typeStr, nid);
          });
          return Value((double)nid);
        } catch (const facebook::jsi::JSError &error) {
          RuneReportJSIError(rt, error, "__ui.createNode");
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"__ui.createNode"];
        }
        return Value::undefined();
      });

  auto hostSetProp = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setProp"), 3,
      [host](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        try {
          if (count < 3 || !a[0].isNumber() || !a[1].isString()) {
            if (count >= 2) {
              NSLog(@"[Hermes] __ui.setProp invalid args count=%zu nameType=%s", count,
                    a[1].isUndefined() ? "undefined" :
                    a[1].isNull() ? "null" :
                    a[1].isBool() ? "bool" :
                    a[1].isNumber() ? "number" :
                    a[1].isString() ? "string" :
                    a[1].isObject() ? "object" : "other");
            } else {
              NSLog(@"[Hermes] __ui.setProp missing arguments");
            }
            return Value::undefined();
          }
          int id = (int)a[0].asNumber();
          std::string name = a[1].getString(rt).utf8(rt);
          NSString *nameStr = [NSString stringWithUTF8String:name.c_str()];
          Value propValue = count > 2 ? Value(rt, a[2]) : Value::undefined();
          
          if (name == "style" && a[2].isObject()) {
            Object styleObj = a[2].asObject(rt);
            NSMutableDictionary *styleDict = [NSMutableDictionary dictionary];

            auto copyNumber = [&](const char *prop) {
              if (!styleObj.hasProperty(rt, prop)) {
                return;
              }
              Value v = styleObj.getProperty(rt, prop);
              NSString *key = [NSString stringWithUTF8String:prop];
              
              // Handle both numbers and strings (for percentages like "50%")
              if (v.isNumber()) {
                styleDict[key] = @(v.asNumber());
              } else if (v.isString()) {
                std::string utf8 = v.getString(rt).utf8(rt);
                styleDict[key] = [NSString stringWithUTF8String:utf8.c_str()];
              }
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
                                         "borderWidth",    "fontSize",       "top",           "right",
                                         "bottom",         "left",          "opacity"};
            for (const char *key : numericKeys) {
              copyNumber(key);
            }

            const char *stringKeys[] = {"flexDirection", "justifyContent", "alignItems",
                                         "flexWrap",      "backgroundColor", "borderColor",
                                         "borderStyle",  "fontWeight",      "color",         "position",
                                         "display"};
            for (const char *key : stringKeys) {
              copyString(key);
            }

            SNRunOnMain(^{
              [[host manager] setStyle:@(id) style:styleDict];
            });
            return Value::undefined();
          }

          if (propValue.isUndefined() || (propValue.isObject() && propValue.asObject(rt).isFunction(rt))) {
            SNRunOnMain(^{
              [[host manager] setProp:@(id)
                                        name:nameStr
                                   valueJSON:@"null"];
            });
            return Value::undefined();
          }

          auto JSON = rt.global().getPropertyAsObject(rt, "JSON");
          auto stringify = JSON.getPropertyAsFunction(rt, "stringify");
          Value stringified = stringify.call(rt, propValue);
          if (!stringified.isString()) {
            std::string fallback = propValue.toString(rt).utf8(rt);
            SNRunOnMain(^{
              [[host manager] setProp:@(id)
                                        name:nameStr
                                   valueJSON:[NSString stringWithUTF8String:fallback.c_str()]];
            });
            return Value::undefined();
          }
          std::string jsonUTF8 = stringified.getString(rt).utf8(rt);
          SNRunOnMain(^{
            [[host manager] setProp:@(id)
                                      name:nameStr
                                 valueJSON:[NSString stringWithUTF8String:jsonUTF8.c_str()]];
          });
        } catch (const facebook::jsi::JSError &error) {
          RuneReportJSIError(rt, error, "__ui.setProp");
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"__ui.setProp"];
        }
        return Value::undefined();
      });

  auto hostSetText = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setText"), 2,
      [host](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        try {
          if (count < 2 || !a[0].isNumber()) {
            return Value::undefined();
          }
          int id = (int)a[0].asNumber();
          std::string text;
          if (count > 1) {
            if (a[1].isString()) {
              text = a[1].getString(rt).utf8(rt);
            } else {
              try {
                text = a[1].toString(rt).utf8(rt);
              } catch (...) {
                text = "";
              }
            }
          }
          // Log text value
          SNRunOnMain(^{
            // NSLog(@"[RuneTrace] __ui.setText id=%d text='%s'", id, text.c_str());
            [[host manager] setText:@(id) text:[NSString stringWithUTF8String:text.c_str()]];
          });
        } catch (const facebook::jsi::JSError &error) {
          RuneReportJSIError(rt, error, "__ui.setText");
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
          SNRunOnMain(^{
            // NSLog(@"[RuneTrace] __ui.insertChild parent=%d child=%d index=%d", parentId, childId, index);
            [[host manager] insertChild:@(parentId)
                                   child:@(childId)
                                   index:@(index)];
          });
        } catch (const facebook::jsi::JSError &error) {
          RuneReportJSIError(rt, error, "__ui.insertChild");
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
          SNRunOnMain(^{
            // NSLog(@"[RuneTrace] __ui.removeChild parent=%d child=%d", parentId, childId);
            [[host manager] removeChild:@(parentId) child:@(childId)];
            [host sn_removeHandlersForNode:childId];
          });
        } catch (const facebook::jsi::JSError &error) {
          RuneReportJSIError(rt, error, "__ui.removeChild");
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
          SNRunOnMain(^{
            [[host manager] setHandler:@(id) name:[NSString stringWithUTF8String:name.c_str()]];
          });
        } catch (const facebook::jsi::JSError &error) {
          RuneReportJSIError(rt, error, "__ui.setHandler");
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"__ui.setHandler"];
        }
        return Value::undefined();
      });

  auto hostFlush = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "flush"), 0,
      [host](Runtime &, const Value &, const Value *, size_t) -> Value {
        SNRunOnMain(^{
          @try {
            [[host manager] flush];
          } @catch (NSException *exception) {
            std::string message = exception.reason ? [exception.reason UTF8String] : "flush failed";
            [host reportExceptionWithContext:@"__ui.flush" message:message stack:""];
          }
        });
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

-(void)installModulesBridge {
  auto &rt = *_rt;
  HermesRuntimeHost *host = self;

  auto hostCall = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "call"), 3,
      [host](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        try {
          if (count < 2 || !a[0].isString() || !a[1].isString()) {
            throw facebook::jsi::JSError(rt, "__modules.call requires module and method strings");
          }

          std::string module = a[0].getString(rt).utf8(rt);
          std::string method = a[1].getString(rt).utf8(rt);
          id argsObject = nil;
          if (count > 2) {
            argsObject = SNConvertJSIValueToNSObject(rt, a[2]);
          }

          NSString *moduleLog = [NSString stringWithUTF8String:module.c_str()];
          if (!moduleLog) {
            moduleLog = [NSString stringWithCString:module.c_str() encoding:NSUTF8StringEncoding];
          }
          NSString *methodLog = [NSString stringWithUTF8String:method.c_str()];
          if (!methodLog) {
            methodLog = [NSString stringWithCString:method.c_str() encoding:NSUTF8StringEncoding];
          }
          NSString *argsLog = argsObject ? NSStringFromClass([argsObject class]) : @"<nil>";
          NSLog(@"[Hermes] __modules.call enqueue %@.%@ argsClass=%@", moduleLog ?: @"<unknown>", methodLog ?: @"<unknown>", argsLog);

          return SNMakePromise(rt, [host, module, method, argsObject](Function &&resolve, Function &&reject) {
            auto resolvePtr = std::make_shared<Function>(std::move(resolve));
            auto rejectPtr = std::make_shared<Function>(std::move(reject));

            dispatch_async(host->_moduleQueue, ^{
              @autoreleasepool {
                NSError *callError = nil;
                id resultObject = nil;
                std::string nativeError;

                try {
                  @try {
                    NSString *moduleName = [NSString stringWithUTF8String:module.c_str()];
                    if (!moduleName) {
                      moduleName = [NSString stringWithCString:module.c_str() encoding:NSUTF8StringEncoding];
                    }
                    NSString *methodName = [NSString stringWithUTF8String:method.c_str()];
                    if (!methodName) {
                      methodName = [NSString stringWithCString:method.c_str() encoding:NSUTF8StringEncoding];
                    }

                    NSString *safeModule = moduleName ?: @"<unknown>";
                    NSString *safeMethod = methodName ?: @"<unknown>";

                    if (!host.moduleCallHandler) {
                      nativeError = "Module call handler not configured";
                      NSLog(@"[Hermes] __modules.call missing handler for %@.%@", safeModule, safeMethod);
                    } else {
                      NSLog(@"[Hermes] __modules.call native invoke %@.%@ on thread %@ args=%@", safeModule, safeMethod, NSThread.currentThread, argsObject ? NSStringFromClass([argsObject class]) : @"<nil>");
                      resultObject = host.moduleCallHandler(safeModule, safeMethod, argsObject, &callError);
                      NSLog(@"[Hermes] __modules.call native completed %@.%@ resultClass=%@ error=%@", safeModule, safeMethod, resultObject ? NSStringFromClass([resultObject class]) : @"<nil>", callError);
                    }
                  } @catch (NSException *exception) {
                    NSString *reason = exception.reason ?: @"unknown";
                    const char *reasonC = [reason UTF8String];
                    nativeError = std::string("Module call threw: ") + (reasonC ? reasonC : "unknown");
                  }
                } catch (const std::exception &ex) {
                  nativeError = std::string("Module call threw: ") + (ex.what() ? ex.what() : "unknown");
                }

                if (!nativeError.empty()) {
                  NSLog(@"[Hermes] __modules.call native error: %s", nativeError.c_str());
                  dispatch_async(host->_jsQueue, ^{
                    auto &rtRef = *host->_rt;
                    RuneDiagnosticsReport("modules", nativeError.c_str(), "");
                    Object errorObj(rtRef);
                    errorObj.setProperty(rtRef, "code", String::createFromUtf8(rtRef, "native_error"));
                    errorObj.setProperty(rtRef, "message", String::createFromUtf8(rtRef, nativeError));
                    Value errorValue = Value(rtRef, errorObj);
                    SNCallJSFunction(*rejectPtr, rtRef, &errorValue, 1);
                  });
                  return;
                }

                if (callError) {
                  NSString *errorMessage = callError.localizedDescription ?: @"Native module call failed";
                  NSLog(@"[Hermes] __modules.call native NSError: %@", errorMessage);
                  const char *errorC = [errorMessage UTF8String];
                  std::string message = errorC ? std::string(errorC) : std::string("Native module call failed");
                  dispatch_async(host->_jsQueue, ^{
                    auto &rtRef = *host->_rt;
                    RuneDiagnosticsReport("modules", message.c_str(), "");
                    Object errorObj(rtRef);
                    errorObj.setProperty(rtRef, "code", String::createFromUtf8(rtRef, "native_error"));
                    errorObj.setProperty(rtRef, "message", String::createFromUtf8(rtRef, message));
                    Value errorValue = Value(rtRef, errorObj);
                    SNCallJSFunction(*rejectPtr, rtRef, &errorValue, 1);
                  });
                  return;
                }

                dispatch_async(host->_jsQueue, ^{
                  auto &rtRef = *host->_rt;
                  try {
                    NSString *safeModule = [NSString stringWithUTF8String:module.c_str()] ?: @"<unknown>";
                    NSString *safeMethod = [NSString stringWithUTF8String:method.c_str()] ?: @"<unknown>";
                    NSString *resultClass = resultObject ? NSStringFromClass([resultObject class]) : @"<nil>";
                    NSLog(@"[Hermes] __modules.call resolving %@.%@ on JS queue resultClass=%@", safeModule, safeMethod, resultClass);
                    Value resultValue = SNConvertNSObjectToJSI(rtRef, resultObject);
                    SNCallJSFunction(*resolvePtr, rtRef, &resultValue, 1);
                    NSLog(@"[Hermes] __modules.call resolved %@.%@", safeModule, safeMethod);
                  } catch (const facebook::jsi::JSError &error) {
                    std::string message = error.getMessage();
                    NSLog(@"[Hermes] __modules.call resolve JSI error: %s", message.c_str());
                    RuneReportJSIError(rtRef, error, "modules");
                    Object errorObj(rtRef);
                    errorObj.setProperty(rtRef, "code", String::createFromUtf8(rtRef, "invalid_json"));
                    errorObj.setProperty(rtRef, "message", String::createFromUtf8(rtRef, message));
                    Value errorValue = Value(rtRef, errorObj);
                    SNCallJSFunction(*rejectPtr, rtRef, &errorValue, 1);
                  } catch (const std::exception &ex) {
                    std::string message(ex.what());
                    NSLog(@"[Hermes] __modules.call resolve std::exception: %s", message.c_str());
                    RuneDiagnosticsReport("modules", message.c_str(), "");
                    Object errorObj(rtRef);
                    errorObj.setProperty(rtRef, "code", String::createFromUtf8(rtRef, "invalid_json"));
                    errorObj.setProperty(rtRef, "message", String::createFromUtf8(rtRef, message));
                    Value errorValue = Value(rtRef, errorObj);
                    SNCallJSFunction(*rejectPtr, rtRef, &errorValue, 1);
                  }
                });
              }
            });
          });
        } catch (const facebook::jsi::JSError &error) {
          RuneReportJSIError(rt, error, "__modules.call");
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"__modules.call"];
        }
        return Value::undefined();
      });

  auto hostCallSync = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "callSync"), 3,
      [host](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        try {
          if (count < 2 || !a[0].isString() || !a[1].isString()) {
            throw facebook::jsi::JSError(rt, "__modules.callSync requires module and method strings");
          }

          std::string module = a[0].getString(rt).utf8(rt);
          std::string method = a[1].getString(rt).utf8(rt);
          id argsObject = nil;

          if (count > 2) {
            argsObject = SNConvertJSIValueToNSObject(rt, a[2]);
          }

          if (!host.moduleCallSyncHandler) {
            throw facebook::jsi::JSError(rt, "No synchronous module handler registered");
          }

          NSString *moduleName = [NSString stringWithUTF8String:module.c_str()];
          if (!moduleName) {
            moduleName = [NSString stringWithCString:module.c_str() encoding:NSUTF8StringEncoding];
          }

          NSString *methodName = [NSString stringWithUTF8String:method.c_str()];
          if (!methodName) {
            methodName = [NSString stringWithCString:method.c_str() encoding:NSUTF8StringEncoding];
          }

          NSError *nativeError = nil;
          id result = host.moduleCallSyncHandler(moduleName ?: @"", methodName ?: @"", argsObject, &nativeError);

          if (nativeError) {
            NSString *errorMessage = nativeError.localizedDescription ?: @"Native sync call failed";
            std::string message = errorMessage ? [errorMessage UTF8String] : "Native sync call failed";
            throw facebook::jsi::JSError(rt, message);
          }

          return SNConvertNSObjectToJSI(rt, result);
        } catch (const facebook::jsi::JSError &error) {
          RuneReportJSIError(rt, error, "__modules.callSync");
          throw;
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"__modules.callSync"];
          throw facebook::jsi::JSError(rt, ex.what());
        }
      });

  Object modules(rt);
  modules.setProperty(rt, "call", hostCall);
  modules.setProperty(rt, "callSync", hostCallSync);
  rt.global().setProperty(rt, "__modules", modules);
  rt.global().setProperty(rt, "__runeCallSync", hostCallSync);
}

- (void)emitEventWithName:(NSString *)name body:(id)body {
  if (name.length == 0) {
    return;
  }

  HermesRuntimeHost *host = self;
  NSString *eventName = [name copy];
  id payload = body;

  dispatch_async(_jsQueue, ^{
    HermesRuntimeHost *strongHost = host;
    if (!strongHost || !strongHost->_rt) {
      return;
    }

    auto &rt = *strongHost->_rt;

    try {
      auto global = rt.global();
      if (!global.hasProperty(rt, "RuneNativeEmitter")) {
        NSLog(@"[Hermes] RuneNativeEmitter missing when emitting %@", eventName);
        return;
      }

      auto emitterValue = global.getProperty(rt, "RuneNativeEmitter");
      if (!emitterValue.isObject()) {
        NSLog(@"[Hermes] RuneNativeEmitter is not an object when emitting %@", eventName);
        return;
      }

      auto emitterObj = emitterValue.asObject(rt);
      if (!emitterObj.hasProperty(rt, "emit")) {
        NSLog(@"[Hermes] RuneNativeEmitter.emit missing for event %@", eventName);
        return;
      }

      auto emitValue = emitterObj.getProperty(rt, "emit");
      if (!emitValue.isObject() || !emitValue.asObject(rt).isFunction(rt)) {
        NSLog(@"[Hermes] RuneNativeEmitter.emit is not a function for event %@", eventName);
        return;
      }

      auto emitFn = emitValue.asObject(rt).asFunction(rt);
      std::string eventNameStd(eventName.UTF8String ?: "");
      Value args[2];
      args[0] = Value(rt, String::createFromUtf8(rt, eventNameStd));
      args[1] = payload ? SNConvertNSObjectToJSI(rt, payload) : Value::undefined();
      SNCallJSFunction(emitFn, rt, args, 2);
    } catch (const facebook::jsi::JSError &error) {
      RuneReportJSIError(rt, error, "RuneNativeEmitter.emit");
    } catch (const std::exception &ex) {
      [strongHost reportStdException:ex context:@"RuneNativeEmitter.emit"];
    }
  });
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

          Object fnObject = a[0].asObject(rt);
          if (!fnObject.isFunction(rt)) {
            return Value::undefined();
          }

          int delayMs = (count > 1 && a[1].isNumber()) ? static_cast<int>(a[1].asNumber()) : 0;
          std::vector<Value> args;
          if (count > 2 && a[2].isObject()) {
            Object maybeArray = a[2].asObject(rt);
            if (maybeArray.isArray(rt)) {
              Array array = maybeArray.asArray(rt);
              size_t length = array.size(rt);
              args.reserve(length);
              for (size_t i = 0; i < length; ++i) {
                args.emplace_back(Value(rt, array.getValueAtIndex(rt, i)));
              }
            }
          }

          int timerId = gNextTimer.fetch_add(1);
          auto timer = std::make_unique<Timer>();
          timer->id = timerId;
          timer->fn = std::make_shared<Function>(fnObject.asFunction(rt));
          timer->args = std::move(args);
          timer->source = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, host->_jsQueue);

          dispatch_source_t source = timer->source;
          gTimers.emplace(timerId, std::move(timer));

          int64_t delayNs = delayMs < 0 ? 0 : (int64_t)delayMs * NSEC_PER_MSEC;
          dispatch_source_set_timer(source, dispatch_time(DISPATCH_TIME_NOW, delayNs), DISPATCH_TIME_FOREVER, 0);

          dispatch_source_set_event_handler(source, ^{
            auto it = gTimers.find(timerId);
            if (it == gTimers.end()) {
              return;
            }
            auto &timerRef = *it->second;
            auto &runtime = *host->_rt;
            const Value *argsPtr = timerRef.args.empty() ? nullptr : timerRef.args.data();
            try {
              timerRef.fn->call(runtime, argsPtr, timerRef.args.size());
            } catch (const facebook::jsi::JSError &error) {
              RuneReportJSIError(runtime, error, "setTimeout");
            } catch (const std::exception &ex) {
              [host reportStdException:ex context:@"setTimeout"];
            }
            dispatch_source_cancel(timerRef.source);
            gTimers.erase(it);
          });

          dispatch_resume(source);
          return Value(static_cast<double>(timerId));
        } catch (const facebook::jsi::JSError &error) {
          RuneReportJSIError(rt, error, "setTimeout");
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
          int timerId = static_cast<int>(a[0].asNumber());
          auto it = gTimers.find(timerId);
          if (it == gTimers.end()) {
            return Value::undefined();
          }
          dispatch_source_cancel(it->second->source);
          gTimers.erase(it);
        } catch (const facebook::jsi::JSError &error) {
          RuneReportJSIError(rt, error, "clearTimeout");
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"clearTimeout"];
        }
        return Value::undefined();
      });

  rt.global().setProperty(rt, "__hostSetTimeout", hostSetTimeout);
  rt.global().setProperty(rt, "__hostClearTimeout", hostClearTimeout);

  static const char *timerScript =
      "globalThis.setTimeout=(fn,ms,...a)=>__hostSetTimeout(fn,ms|0,a);"
    "globalThis.clearTimeout=(id)=>__hostClearTimeout(id);"
    "globalThis.setImmediate=(fn,...a)=>__hostSetTimeout(fn,0,a);"
    "globalThis.clearImmediate=(id)=>__hostClearTimeout(id);";

  auto buffer = std::make_shared<StringBuffer>(timerScript);
  _rt->evaluateJavaScript(buffer, "timers.js");
}

-(void)installUnhandledPromiseReporting {
  auto &rt = *_rt;
  auto reportUnhandled = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostReportUnhandled"), 2,
      [](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        std::string message = (count > 0 && a[0].isString()) ? a[0].getString(rt).utf8(rt) : "";
        std::string stack = (count > 1 && a[1].isString()) ? a[1].getString(rt).utf8(rt) : "";
        if (message.empty()) {
          message = "Unhandled promise rejection";
        }
        RuneDiagnosticsReport("unhandled", message.c_str(), stack.c_str());
        return Value::undefined();
      });

  rt.global().setProperty(rt, "__hostReportUnhandled", reportUnhandled);

  const char *js = R"JS(
    (function(){
      if (globalThis.__rune && __rune._uh_installed) return;
      globalThis.__rune = globalThis.__rune || {};
      __rune._uh_installed = true;
      const _then = Promise.prototype.then;
      Promise.prototype.then = function(onFulfilled, onRejected){
        const p = _then.call(this, onFulfilled, onRejected);
        _then.call(p, undefined, function(e){
          try {
            __hostReportUnhandled(String(e?.message || e), String(e?.stack || ""));
          } catch (_) {}
        });
        return p;
      };
    })();
  )JS";

  auto buffer = std::make_shared<StringBuffer>(js);
  _rt->evaluateJavaScript(buffer, "rune-unhandled.js");
}

- (void)invokeHandlerForNode:(int)nid name:(NSString *)name {
  std::string handlerName = [name UTF8String] ?: "";
  HermesRuntimeHost *host = self;
  dispatch_async(_jsQueue, ^{
    if (!host || !host->_rt) {
      return;
    }
    auto &rt = *host->_rt;
    auto it = host->_handlers.find({nid, handlerName});
    if (it == host->_handlers.end()) {
      return;
    }
    try {
      Object event(rt);
      event.setProperty(rt, "target", (double)nid);
      NSDictionary *payload = [[host manager] dequeueEventPayloadForNode:nid name:name];
      if ([payload isKindOfClass:[NSDictionary class]] && payload.count > 0) {
        for (id key in payload) {
          if (![key isKindOfClass:[NSString class]]) continue;
          id obj = payload[key];
          const char *utf8 = [(NSString *)key UTF8String];
          std::string prop = utf8 ? utf8 : "";
          auto propId = facebook::jsi::PropNameID::forUtf8(rt, prop);
          Value converted = SNConvertNSObjectToJSI(rt, obj);
          event.setProperty(rt, propId, converted);
        }
      }
      Value eventValue(std::move(event));
      it->second->call(rt, std::move(eventValue));
    } catch (const facebook::jsi::JSError &error) {
      RuneReportJSIError(rt, error, "invokeHandler");
    } catch (const std::exception &ex) {
      [host reportStdException:ex context:@"invokeHandler"];
    }
  });
}

- (void)evaluateString:(NSString *)code {
  dispatch_sync(_jsQueue, ^{
    try {
      const char *utf8 = code ? [code UTF8String] : "";
      std::string source = utf8 ? utf8 : "";
      if (source.find("sourceURL=") == std::string::npos) {
        source.append("\n//# sourceURL=main.js");
      }
      auto buffer = std::make_shared<StringBuffer>(source.c_str());
      _rt->evaluateJavaScript(buffer, "main.js");
    } catch (const facebook::jsi::JSError &error) {
      RuneReportJSIError(*_rt, error, "Evaluate");
    } catch (const std::exception &ex) {
      [self reportStdException:ex context:@"Evaluate"];
    }
  });
}

-(id)callGlobal:(NSString *)name args:(NSArray *)args {
  dispatch_sync(_jsQueue, ^{
    auto &rt = *_rt;
    try {
      std::string functionName = [name UTF8String] ? [name UTF8String] : "";
      auto global = rt.global();
      if (!global.hasProperty(rt, functionName.c_str())) {
        NSLog(@"[Hermes] callGlobal missing %@", name);
        return;
      }

      Value fnValue = global.getProperty(rt, functionName.c_str());
      if (!fnValue.isObject()) {
        NSLog(@"[Hermes] callGlobal %@ value is not object", name);
        return;
      }

      auto fnObject = fnValue.asObject(rt);
      if (!fnObject.isFunction(rt)) {
        NSLog(@"[Hermes] callGlobal %@ value is not function", name);
        return;
      }

      auto fn = fnObject.asFunction(rt);
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
      RuneReportJSIError(rt, error, "callGlobal");
    } catch (const std::exception &ex) {
      [self reportStdException:ex context:@"callGlobal"];
    }
  });
  return nil;
}

- (void)evaluateBytecode:(NSData *)data sourceURL:(NSString *)sourceURL {
  if (data == nil || data.length == 0) {
    return;
  }
  dispatch_sync(_jsQueue, ^{
    try {
      const uint8_t *bytes = (const uint8_t *)data.bytes;
      size_t len = (size_t)data.length;
      if (!facebook::hermes::HermesRuntime::isHermesBytecode(bytes, len)) {
        // Fallback: try to decode as UTF-8 source
        NSString *code = [[NSString alloc] initWithData:(NSData *)data encoding:NSUTF8StringEncoding];
        if (code.length > 0) {
          [self evaluateString:code];
          return;
        }
      } else {
        facebook::hermes::HermesRuntime::prefetchHermesBytecode(bytes, len);
      }

      auto buffer = std::make_shared<NSDataBuffer>(data);
      std::string url = sourceURL ? [sourceURL UTF8String] : "main.hbc";
      _rt->evaluateJavaScript(buffer, url);
    } catch (const facebook::jsi::JSError &error) {
      RuneReportJSIError(*_rt, error, "EvaluateBytecode");
    } catch (const std::exception &ex) {
      [self reportStdException:ex context:@"EvaluateBytecode"];
    }
  });
}

@end
