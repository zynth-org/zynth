#import "ZynthWorklets.h"
#import "ZynthHermesRuntimeHost.h"
#import "ZynthUICommandsRegistry.h"
#import "ZynthUIManager+Private.h"

#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>

#import <hermes/hermes.h>
#import <jsi/jsi.h>

#import <atomic>
#import <algorithm>
#import <cmath>
#import <memory>
#import <mutex>
#import <limits>
#import <string>
#import <unordered_map>
#import <vector>

using namespace facebook::jsi;

namespace {
static const char *kZynthSharedValueKey = "__zynth_shared_value";

static std::mutex gSharedSignalCallbacksMutex;
static std::vector<ZynthSharedSignalChangedCallback> gSharedSignalCallbacks;

static bool ZynthWorkletsVerboseLogsEnabled() {
#if DEBUG
  static bool enabled = []() {
    NSString *rawValue = NSProcessInfo.processInfo.environment[@"ZYNTH_WORKLETS_VERBOSE_LOGS"];
    if (rawValue == nil) {
      return false;
    }
    NSString *normalized = [[rawValue stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]] lowercaseString];
    return [normalized isEqualToString:@"1"] || [normalized isEqualToString:@"true"] || [normalized isEqualToString:@"yes"];
  }();
  return enabled;
#else
  return false;
#endif
}

#define ZYNTH_WORKLETS_LOG(...)                     \
  do {                                              \
    if (ZynthWorkletsVerboseLogsEnabled()) {        \
      NSLog(__VA_ARGS__);                           \
    }                                               \
  } while (0)

static std::string valueToString(Runtime &rt, const Value &value) {
  if (value.isString()) return value.asString(rt).utf8(rt);
  if (value.isNumber()) return std::to_string(value.asNumber());
  if (value.isBool()) return value.getBool() ? "true" : "false";
  if (value.isNull()) return "null";
  if (value.isUndefined()) return "undefined";
  return "[object]";
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
        ZYNTH_WORKLETS_LOG(@"[ZynthWorklet] %@", [parts componentsJoinedByString:@" "]);
        return Value::undefined();
      });

  Object console(rt);
  console.setProperty(rt, "log", logFn);
  console.setProperty(rt, "warn", logFn);
  console.setProperty(rt, "error", logFn);
  rt.global().setProperty(rt, "console", console);
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

namespace {
} // namespace

struct ZynthWorkletClosureValue {
  enum class Kind {
    Shared,
    Number,
    Bool,
    String,
  };
  std::string name;
  Kind kind = Kind::Number;
  int sharedId = 0;
  double numberValue = 0.0;
  bool boolValue = false;
  std::string stringValue;
};

@interface ZynthWorklets ()
- (void)ensureUIRuntime;
- (void)registerWorkletOnUIRuntime:(int)workletId
                              code:(const std::string &)code
                          location:(const std::string &)location
                           closure:(const std::vector<ZynthWorkletClosureValue> &)closure;
- (void)runWorkletOnUIRuntime:(int)workletId;
@end

@implementation ZynthWorklets {
  __weak ZynthHermesRuntimeHost *_host;
  std::unique_ptr<facebook::hermes::HermesRuntime> _uiRuntime;
  std::atomic<int> _nextWorkletId;
  std::unordered_map<int, std::shared_ptr<Function>> _uiWorklets;
  std::unordered_map<int, std::vector<ZynthWorkletClosureValue>> _uiWorkletClosures;
  std::mutex _workletMutex;
  std::atomic<int> _nextSharedSignalId;
  std::unordered_map<int, double> _sharedSignals;
  std::mutex _sharedSignalsMutex;
}

- (instancetype)initWithHost:(ZynthHermesRuntimeHost *)host {
  self = [super init];
  if (self) {
    _host = host;
    _nextWorkletId = 1;
    _nextSharedSignalId = 1;
  }
  return self;
}

+ (void)registerSharedSignalChangedCallback:(ZynthSharedSignalChangedCallback)callback {
  if (!callback) return;
  ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] Registering shared signal callback: %p", callback);
  std::lock_guard<std::mutex> lock(gSharedSignalCallbacksMutex);
  gSharedSignalCallbacks.push_back(callback);
}

- (int)createSharedSignalWithValue:(double)initialValue {
  int signalId = _nextSharedSignalId.fetch_add(1);
  {
    std::lock_guard<std::mutex> lock(_sharedSignalsMutex);
    _sharedSignals[signalId] = initialValue;
  }
  return signalId;
}

- (double)sharedSignalValueForId:(int)signalId {
  std::lock_guard<std::mutex> lock(_sharedSignalsMutex);
  auto it = _sharedSignals.find(signalId);
  if (it == _sharedSignals.end()) {
    return std::numeric_limits<double>::quiet_NaN();
  }
  return it->second;
}

- (BOOL)setSharedSignalValue:(int)signalId value:(double)value {
  {
    std::lock_guard<std::mutex> lock(_sharedSignalsMutex);
    auto it = _sharedSignals.find(signalId);
    if (it == _sharedSignals.end()) {
      return NO;
    }
    it->second = value;
  }

  std::vector<ZynthSharedSignalChangedCallback> callbacks;
  {
    std::lock_guard<std::mutex> lock(gSharedSignalCallbacksMutex);
    callbacks = gSharedSignalCallbacks;
  }
  
  if (!callbacks.empty()) {
    // Throttled log
    static NSInteger triggerCount = 0;
    if (triggerCount++ % 30 == 0) {
      ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] Triggering %lu callbacks for signal %d value=%.2f", (unsigned long)callbacks.size(), signalId, value);
    }
  }

  for (auto callback : callbacks) {
    callback((__bridge void *)_host, signalId);
  }

  return YES;
}


- (void)installSharedSignalsOnRuntime:(facebook::jsi::Runtime &)rt {
  auto createSharedSignal = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "createSharedSignal"), 1,
      [self](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) {
          ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] createSharedSignal: invalid args");
          return Value::undefined();
        }
        double initialValue = args[0].asNumber();
        int signalId = [self createSharedSignalWithValue:initialValue];
        ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] createSharedSignal id=%d value=%.3f", signalId, initialValue);
        return Value(static_cast<double>(signalId));
      });

  auto getSharedSignal = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "getSharedSignal"), 1,
      [self](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) {
          ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] getSharedSignal: invalid args");
          return Value::undefined();
        }
        int signalId = static_cast<int>(args[0].asNumber());
        double value = [self sharedSignalValueForId:signalId];
        if (std::isnan(value)) {
          ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] getSharedSignal missing id=%d", signalId);
          return Value::undefined();
        }
        return Value(value);
      });

  auto setSharedSignal = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setSharedSignal"), 2,
      [self](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isNumber()) {
          ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] setSharedSignal: invalid args");
          return Value::undefined();
        }
        int signalId = static_cast<int>(args[0].asNumber());
        double value = args[1].asNumber();
        if (![self setSharedSignalValue:signalId value:value]) {
          ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] setSharedSignal missing id=%d", signalId);
          return Value::undefined();
        }
        ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] setSharedSignal id=%d value=%.3f", signalId, value);
        return Value::undefined();
      });

  auto removeSharedSignal = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "removeSharedSignal"), 1,
      [self](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) {
          ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] removeSharedSignal: invalid args");
          return Value::undefined();
        }
        int signalId = static_cast<int>(args[0].asNumber());
        {
          std::lock_guard<std::mutex> lock(_sharedSignalsMutex);
          _sharedSignals.erase(signalId);
        }
        ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] removeSharedSignal id=%d", signalId);
        return Value::undefined();
      });

  Object shared(rt);
  shared.setProperty(rt, "createSharedSignal", createSharedSignal);
  shared.setProperty(rt, "getSharedSignal", getSharedSignal);
  shared.setProperty(rt, "setSharedSignal", setSharedSignal);
  shared.setProperty(rt, "removeSharedSignal", removeSharedSignal);
  rt.global().setProperty(rt, "__zynth_shared_signals", shared);
  ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] shared signals bridge installed");
}

- (void)installWorkletsBridgeOnRuntime:(facebook::jsi::Runtime &)rt {
  __weak ZynthWorklets *weakSelf = self;

  auto registerWorklet = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "register"), 1,
      [weakSelf](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        ZynthWorklets *strongSelf = weakSelf;
        if (!strongSelf || count < 1 || !args[0].isObject()) {
          ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] register: invalid payload");
          return Value::undefined();
        }
        Object payload = args[0].asObject(rt);
        if (!payload.hasProperty(rt, "code")) {
          ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] register: missing code");
          return Value::undefined();
        }
        Value codeValue = payload.getProperty(rt, "code");
        if (!codeValue.isString()) {
          ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] register: code not string");
          return Value::undefined();
        }
        std::string code = codeValue.asString(rt).utf8(rt);
        std::string location;
        if (payload.hasProperty(rt, "location")) {
          Value locValue = payload.getProperty(rt, "location");
          if (locValue.isString()) {
            location = locValue.asString(rt).utf8(rt);
          }
        }

        std::vector<ZynthWorkletClosureValue> closure;
        if (payload.hasProperty(rt, "closure")) {
          Value closureValue = payload.getProperty(rt, "closure");
          if (closureValue.isObject()) {
            Object closureObj = closureValue.asObject(rt);
            Array keys = closureObj.getPropertyNames(rt);
            size_t keyCount = keys.size(rt);
            for (size_t i = 0; i < keyCount; i += 1) {
              Value keyValue = keys.getValueAtIndex(rt, i);
              if (!keyValue.isString()) continue;
              std::string name = keyValue.asString(rt).utf8(rt);
              Value entryValue = closureObj.getProperty(rt, name.c_str());
              if (entryValue.isObject()) {
                Object entryObj = entryValue.asObject(rt);
                if (entryObj.hasProperty(rt, kZynthSharedValueKey)) {
                  Value idValue = entryObj.getProperty(rt, kZynthSharedValueKey);
                  if (idValue.isNumber()) {
                    ZynthWorkletClosureValue entry;
                    entry.name = name;
                    entry.kind = ZynthWorkletClosureValue::Kind::Shared;
                    entry.sharedId = static_cast<int>(idValue.asNumber());
                    closure.push_back(entry);
                  }
                }
                continue;
              }
              if (entryValue.isNumber()) {
                ZynthWorkletClosureValue entry;
                entry.name = name;
                entry.kind = ZynthWorkletClosureValue::Kind::Number;
                entry.numberValue = entryValue.asNumber();
                closure.push_back(entry);
              } else if (entryValue.isBool()) {
                ZynthWorkletClosureValue entry;
                entry.name = name;
                entry.kind = ZynthWorkletClosureValue::Kind::Bool;
                entry.boolValue = entryValue.getBool();
                closure.push_back(entry);
              } else if (entryValue.isString()) {
                ZynthWorkletClosureValue entry;
                entry.name = name;
                entry.kind = ZynthWorkletClosureValue::Kind::String;
                entry.stringValue = entryValue.asString(rt).utf8(rt);
                closure.push_back(entry);
              }
            }
          }
        }

        int workletId = strongSelf->_nextWorkletId.fetch_add(1);
        auto codeCopy = std::make_shared<std::string>(code);
        auto locationCopy = std::make_shared<std::string>(location);
        auto closureCopy = std::make_shared<std::vector<ZynthWorkletClosureValue>>(closure);

        dispatch_async(dispatch_get_main_queue(), ^{
          ZynthWorklets *innerSelf = weakSelf;
          if (!innerSelf) return;
          [innerSelf registerWorkletOnUIRuntime:workletId
                                           code:*codeCopy
                                       location:*locationCopy
                                        closure:*closureCopy];
        });

        ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] register id=%d location=%s", workletId, location.c_str());
        return Value(static_cast<double>(workletId));
      });

  auto runWorklet = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "run"), 1,
      [weakSelf](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) {
          ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] run: invalid args");
          return Value::undefined();
        }
        int workletId = static_cast<int>(args[0].asNumber());
        dispatch_async(dispatch_get_main_queue(), ^{
          ZynthWorklets *strongSelf = weakSelf;
          if (!strongSelf) return;
          [strongSelf runWorkletOnUIRuntime:workletId];
        });
        ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] run id=%d", workletId);
        return Value::undefined();
      });

  auto runAfter = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "runAfter"), 2,
      [weakSelf](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isNumber()) {
          ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] runAfter: invalid args");
          return Value::undefined();
        }
        int workletId = static_cast<int>(args[0].asNumber());
        double delayMs = args[1].asNumber();
        int64_t delayNs = (int64_t)(delayMs * NSEC_PER_MSEC);
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, delayNs), dispatch_get_main_queue(), ^{
          ZynthWorklets *strongSelf = weakSelf;
          if (!strongSelf) return;
          [strongSelf runWorkletOnUIRuntime:workletId];
        });
        ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] runAfter id=%d delayMs=%.0f", workletId, delayMs);
        return Value::undefined();
      });

  Object worklets(rt);
  worklets.setProperty(rt, "register", registerWorklet);
  worklets.setProperty(rt, "run", runWorklet);
  worklets.setProperty(rt, "runAfter", runAfter);
  rt.global().setProperty(rt, "__zynth_worklets", worklets);
  ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] worklets bridge installed");
}


- (void)ensureUIRuntime {
  if (_uiRuntime) return;
  _uiRuntime = facebook::hermes::makeHermesRuntime();
  installConsole(*_uiRuntime);
  installGlobals(*_uiRuntime);
  [self installSharedSignalsOnRuntime:*_uiRuntime];
  ZynthHermesRuntimeHost *host = _host;
  if (host) {
    ZynthInstallUICommandsRegistry(host, *_uiRuntime);
  }
  ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] UI runtime created");
}

- (void)registerWorkletOnUIRuntime:(int)workletId
                              code:(const std::string &)code
                          location:(const std::string &)location
                           closure:(const std::vector<ZynthWorkletClosureValue> &)closure {
  [self ensureUIRuntime];
  if (!_uiRuntime) return;
  auto &rt = *_uiRuntime;
  try {
    std::string source = "(" + code + ")";
    source.append("\n//# sourceURL=zynth-worklet.js");
    auto buffer = std::make_shared<StringBuffer>(source.c_str());
    Value result = rt.evaluateJavaScript(buffer, "zynth-worklet.js");
    if (!result.isObject() || !result.getObject(rt).isFunction(rt)) {
      ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] register id=%d failed (not function)", workletId);
      return;
    }
    auto fn = std::make_shared<Function>(result.getObject(rt).getFunction(rt));
    {
      std::lock_guard<std::mutex> lock(_workletMutex);
      _uiWorklets[workletId] = fn;
      _uiWorkletClosures[workletId] = closure;
    }
    ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] registered id=%d location=%s", workletId, location.c_str());
  } catch (const JSError &error) {
    NSString *message = [NSString stringWithUTF8String:error.getMessage().c_str()];
    ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] register error id=%d %@", workletId, message);
  } catch (const std::exception &ex) {
    NSString *message = [NSString stringWithUTF8String:ex.what()];
    ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] register exception id=%d %@", workletId, message);
  }
}

- (void)runWorkletOnUIRuntime:(int)workletId {
  [self ensureUIRuntime];
  if (!_uiRuntime) return;
  auto &rt = *_uiRuntime;
  std::shared_ptr<Function> fn;
  std::vector<ZynthWorkletClosureValue> closure;
  {
    std::lock_guard<std::mutex> lock(_workletMutex);
    auto it = _uiWorklets.find(workletId);
    if (it == _uiWorklets.end()) {
      ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] run missing id=%d", workletId);
      return;
    }
    fn = it->second;
    auto closureIt = _uiWorkletClosures.find(workletId);
    if (closureIt != _uiWorkletClosures.end()) {
      closure = closureIt->second;
    }
  }

  Object global = rt.global();
  __weak ZynthWorklets *weakSelf = self;
  for (const auto &entry : closure) {
    auto propId = PropNameID::forUtf8(rt, entry.name);
    switch (entry.kind) {
      case ZynthWorkletClosureValue::Kind::Shared: {
        int sharedId = entry.sharedId;
        auto getter = Function::createFromHostFunction(
            rt, propId, 0,
            [weakSelf, sharedId](Runtime &, const Value &, const Value *, size_t) -> Value {
              ZynthWorklets *strongSelf = weakSelf;
              if (!strongSelf) return Value::undefined();
              std::lock_guard<std::mutex> lock(strongSelf->_sharedSignalsMutex);
              auto it = strongSelf->_sharedSignals.find(sharedId);
              if (it == strongSelf->_sharedSignals.end()) {
                return Value::undefined();
              }
              return Value(it->second);
            });
        global.setProperty(rt, propId, std::move(getter));
        break;
      }
      case ZynthWorkletClosureValue::Kind::Number:
        global.setProperty(rt, propId, Value(entry.numberValue));
        break;
      case ZynthWorkletClosureValue::Kind::Bool:
        global.setProperty(rt, propId, Value(entry.boolValue));
        break;
      case ZynthWorkletClosureValue::Kind::String:
        global.setProperty(rt, propId, String::createFromUtf8(rt, entry.stringValue));
        break;
    }
  }

  try {
    ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] run execute id=%d", workletId);
    fn->call(rt);
  } catch (const JSError &error) {
    NSString *message = [NSString stringWithUTF8String:error.getMessage().c_str()];
    ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] run error id=%d %@", workletId, message);
  } catch (const std::exception &ex) {
    NSString *message = [NSString stringWithUTF8String:ex.what()];
    ZYNTH_WORKLETS_LOG(@"[ZynthWorklets] run exception id=%d %@", workletId, message);
  }
}

@end
