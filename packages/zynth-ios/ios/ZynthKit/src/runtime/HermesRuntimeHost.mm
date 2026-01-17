#import "HermesRuntimeHost.h"

#import <hermes/hermes.h>
#import <jsi/jsi.h>
#import <dispatch/dispatch.h>
#import <CoreFoundation/CoreFoundation.h>
#import <UIKit/UIKit.h>
#import <objc/message.h>
#import <ZynthKit/ZynthComponentAPI.h>
#import <math.h>
#import <os/lock.h>

#if __has_include(<ZynthKit/ZynthKit-Swift.h>)
#import <ZynthKit/ZynthKit-Swift.h>
#elif __has_include("ZynthKit-Swift.h")
#import "ZynthKit-Swift.h"
#endif

extern "C" void ZynthDiagnosticsReport(const char *phase, const char *message, const char *stack) noexcept;

#import <atomic>
#import <unordered_map>
#import <memory>
#import <functional>
#import <string>
#import <vector>
#import <cmath>
#import <mutex>
#import <algorithm>
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

static os_unfair_lock sUIQueueLock = OS_UNFAIR_LOCK_INIT;
static NSMutableArray<dispatch_block_t> *sUIQueue = nil;
static BOOL sUIQueueScheduled = NO;

static void SNEnqueueOnMain(dispatch_block_t block) {
  if (!block) {
    return;
  }
  if ([NSThread isMainThread]) {
    block();
    return;
  }

  dispatch_block_t copied = [block copy];
  BOOL shouldSchedule = NO;
  os_unfair_lock_lock(&sUIQueueLock);
  if (!sUIQueue) {
    sUIQueue = [[NSMutableArray alloc] init];
  }
  [sUIQueue addObject:copied];
  if (!sUIQueueScheduled) {
    sUIQueueScheduled = YES;
    shouldSchedule = YES;
  }
  os_unfair_lock_unlock(&sUIQueueLock);

  if (!shouldSchedule) {
    return;
  }

  dispatch_async(dispatch_get_main_queue(), ^{
    NSArray<dispatch_block_t> *pending = nil;
    os_unfair_lock_lock(&sUIQueueLock);
    pending = [sUIQueue copy];
    [sUIQueue removeAllObjects];
    sUIQueueScheduled = NO;
    os_unfair_lock_unlock(&sUIQueueLock);

    for (dispatch_block_t queued in pending) {
      queued();
    }
  });
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
  bool isInterval;
  int64_t intervalNs;
};

static const char *kZynthSharedValueKey = "__zynth_shared_value";

enum class ZynthSharedAnimationKind {
  Timing,
  Spring,
};

enum class ZynthSharedEasing {
  Linear,
  Ease,
  EaseIn,
  EaseOut,
  EaseInOut,
  EaseOutCubic,
};

static ZynthSharedEasing ZynthParseEasing(const std::string &name) {
  if (name == "linear") return ZynthSharedEasing::Linear;
  if (name == "ease") return ZynthSharedEasing::Ease;
  if (name == "easeIn") return ZynthSharedEasing::EaseIn;
  if (name == "easeOut") return ZynthSharedEasing::EaseOut;
  if (name == "easeInOut") return ZynthSharedEasing::EaseInOut;
  if (name == "easeOutCubic") return ZynthSharedEasing::EaseOutCubic;
  return ZynthSharedEasing::EaseOutCubic;
}

static double ZynthApplyEasing(ZynthSharedEasing easing, double t) {
  double clamped = std::max(0.0, std::min(1.0, t));
  switch (easing) {
    case ZynthSharedEasing::Linear:
      return clamped;
    case ZynthSharedEasing::Ease:
      return clamped * clamped * (3.0 - 2.0 * clamped);
    case ZynthSharedEasing::EaseIn:
      return clamped * clamped;
    case ZynthSharedEasing::EaseOut: {
      double inv = 1.0 - clamped;
      return 1.0 - inv * inv;
    }
    case ZynthSharedEasing::EaseInOut:
      if (clamped < 0.5) {
        return 2.0 * clamped * clamped;
      } else {
        double inv = 1.0 - clamped;
        return 1.0 - 2.0 * inv * inv;
      }
    case ZynthSharedEasing::EaseOutCubic: {
      double inv = 1.0 - clamped;
      return 1.0 - inv * inv * inv;
    }
  }
}

struct ZynthSharedValueAnimation {
  ZynthSharedAnimationKind kind;
  double fromValue = 0.0;
  double toValue = 0.0;
  double startTime = 0.0;
  double duration = 0.0;
  double delay = 0.0;
  ZynthSharedEasing easing = ZynthSharedEasing::EaseOutCubic;
  double velocity = 0.0;
  double damping = 20.0;
  double stiffness = 150.0;
  double mass = 1.0;
  double restSpeed = 0.001;
  double restDisplacement = 0.001;
  bool overshootClamping = false;
  double lastTime = 0.0;
};

struct ZynthSharedValue {
  double value = 0.0;
  bool animating = false;
  ZynthSharedValueAnimation animation;
};

struct ZynthMappedValue {
  bool hasValue = false;
  bool isShared = false;
  bool isAngle = false;
  int sharedId = 0;
  double numberValue = 0.0;
};

struct ZynthStyleMapper {
  int id = 0;
  int nodeId = 0;
  ZynthMappedValue opacity;
  ZynthMappedValue translateX;
  ZynthMappedValue translateY;
  ZynthMappedValue scale;
  ZynthMappedValue scaleX;
  ZynthMappedValue scaleY;
  ZynthMappedValue rotate;
  ZynthMappedValue rotateX;
  ZynthMappedValue rotateY;
  ZynthMappedValue skewX;
  ZynthMappedValue skewY;
  ZynthMappedValue perspective;
  double baseOpacity = 1.0;
  double baseTranslateX = 0.0;
  double baseTranslateY = 0.0;
  double baseScaleX = 1.0;
  double baseScaleY = 1.0;
  double baseRotate = 0.0;
  double baseRotateX = 0.0;
  double baseRotateY = 0.0;
  double baseSkewX = 0.0;
  double baseSkewY = 0.0;
  double basePerspective = 0.0;
};

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

// GLOBAL STATICS REMOVED - Moved to instance variables
// static std::atomic<int> gNextTimer{1};
// static std::unordered_map<int, std::unique_ptr<Timer>> gTimers;
// static std::atomic<int> gNextAnimationFrame{1};
// static std::unordered_map<int, std::shared_ptr<Function>> gAnimationFrames;
// static CADisplayLink *gAnimationDisplayLink = nil;

inline void SNShowRedBox(NSString *title, NSString *message, NSString *stack) {
  Class redBoxClass = NSClassFromString(@"DevRedBox");
  if (redBoxClass && [redBoxClass respondsToSelector:@selector(showWithTitle:message:stack:)]) {
    auto showSelector = @selector(showWithTitle:message:stack:);
    void (*showFunc)(id, SEL, NSString *, NSString *, NSString *) = (void (*)(id, SEL, NSString *, NSString *, NSString *))objc_msgSend;
    showFunc(redBoxClass, showSelector, title, message, stack);
  }
}

static void ZynthReportJSIError(facebook::jsi::Runtime &rt,
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

  ZynthDiagnosticsReport(phase ? phase : "jsi", message.c_str(), stack.c_str());
}

inline void SNCallJSFunction(Function &fn, Runtime &rt, const Value *args, size_t count) {
  const auto callPtr = static_cast<Value (Function::*)(Runtime&, const Value*, size_t) const>(&Function::call);
  (fn.*callPtr)(rt, args, count);
}

Value SNMakePromise(Runtime &rt, std::function<void(Function &&resolve, Function &&reject)> work) {
  auto promiseCtor = rt.global().getPropertyAsFunction(rt, "Promise");
  auto workPtr = std::make_shared<std::function<void(Function &&, Function &&)>>(std::move(work));

  auto executor = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__zynthPromiseExecutor"), 2,
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

static double ZynthDegreesToRadians(double degrees) {
  return degrees * M_PI / 180.0;
}

static CATransform3D ZynthRotateXMatrix(double radians) {
  CATransform3D transform = CATransform3DIdentity;
  double cosValue = cos(radians);
  double sinValue = sin(radians);
  transform.m22 = cosValue;
  transform.m23 = sinValue;
  transform.m32 = -sinValue;
  transform.m33 = cosValue;
  return transform;
}

static CATransform3D ZynthRotateYMatrix(double radians) {
  CATransform3D transform = CATransform3DIdentity;
  double cosValue = cos(radians);
  double sinValue = sin(radians);
  transform.m11 = cosValue;
  transform.m13 = -sinValue;
  transform.m31 = sinValue;
  transform.m33 = cosValue;
  return transform;
}

static CATransform3D ZynthRotateXYMatrix(double rotateX, double rotateY) {
  CATransform3D rotateXMatrix = ZynthRotateXMatrix(rotateX);
  CATransform3D rotateYMatrix = ZynthRotateYMatrix(rotateY);
  return CATransform3DConcat(rotateYMatrix, rotateXMatrix);
}

static bool ZynthParseAngleString(const std::string &input, double &outRadians) {
  if (input.size() >= 3 && input.compare(input.size() - 3, 3, "deg") == 0) {
    std::string raw = input.substr(0, input.size() - 3);
    try {
      outRadians = ZynthDegreesToRadians(std::stod(raw));
      return true;
    } catch (...) {
      return false;
    }
  }
  if (input.size() >= 3 && input.compare(input.size() - 3, 3, "rad") == 0) {
    std::string raw = input.substr(0, input.size() - 3);
    try {
      outRadians = std::stod(raw);
      return true;
    } catch (...) {
      return false;
    }
  }
  try {
    outRadians = ZynthDegreesToRadians(std::stod(input));
    return true;
  } catch (...) {
    return false;
  }
}

static bool ZynthExtractSharedValueId(Runtime &rt, const Value &value, int &outId) {
  if (!value.isObject()) return false;
  auto obj = value.getObject(rt);
  if (!obj.hasProperty(rt, kZynthSharedValueKey)) return false;
  auto idValue = obj.getProperty(rt, kZynthSharedValueKey);
  if (!idValue.isNumber()) return false;
  outId = static_cast<int>(idValue.asNumber());
  return true;
}

static bool ZynthParseMappedValue(Runtime &rt, const Value &value, ZynthMappedValue &out, bool isAngle = false) {
  int sharedId = 0;
  if (ZynthExtractSharedValueId(rt, value, sharedId)) {
    out.hasValue = true;
    out.isShared = true;
    out.isAngle = isAngle;
    out.sharedId = sharedId;
    return true;
  }
  if (value.isNumber()) {
    out.hasValue = true;
    out.isShared = false;
    out.isAngle = isAngle;
    out.numberValue = isAngle ? ZynthDegreesToRadians(value.asNumber()) : value.asNumber();
    return true;
  }
  if (isAngle && value.isString()) {
    auto text = value.getString(rt).utf8(rt);
    double radians = 0.0;
    if (ZynthParseAngleString(text, radians)) {
      out.hasValue = true;
      out.isShared = false;
      out.isAngle = isAngle;
      out.numberValue = radians;
      return true;
    }
  }
  return false;
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
      ZynthReportJSIError(rt, error, "ArrayBufferCtor");
    } catch (const std::exception &ex) {
      ZynthDiagnosticsReport("ArrayBufferCtor", ex.what(), "");
    }
    return Value::undefined();
  }

  return Value::undefined();
}
}

@interface HermesRuntimeHost () {
@public
  std::unique_ptr<facebook::hermes::HermesRuntime> _rt;
  std::unordered_map<HandlerKey, std::shared_ptr<Function>, HandlerKeyHash> _handlers;
  dispatch_queue_t _jsQueue;
  dispatch_queue_t _moduleQueue;
  
  // Instance variables replacing globals
  std::atomic<int> _nextTimer;
  std::unordered_map<int, std::unique_ptr<Timer>> _timers;
  std::atomic<int> _nextAnimationFrame;
  std::unordered_map<int, std::shared_ptr<Function>> _animationFrames;
  CADisplayLink *_animationDisplayLink;
  std::atomic<int> _nextSharedValueId;
  std::atomic<int> _nextStyleMapperId;
  std::unordered_map<int, ZynthSharedValue> _sharedValues;
  std::unordered_map<int, ZynthStyleMapper> _styleMappers;
  std::mutex _animateMutex;
  std::unique_ptr<facebook::hermes::HermesRuntime> _uiRt;
  std::atomic<int> _nextWorkletId;
  std::unordered_map<int, std::shared_ptr<Function>> _uiWorklets;
  std::unordered_map<int, std::vector<ZynthWorkletClosureValue>> _uiWorkletClosures;
  std::mutex _uiWorkletMutex;
}
@property(nonatomic, strong) SNUIManager *manager;
- (void)reportExceptionWithContext:(NSString *)context message:(const std::string &)message stack:(const std::string &)stack;
- (void)reportStdException:(const std::exception &)ex context:(NSString *)context;
- (void)ensureAnimationDisplayLink;
- (void)stopAnimationDisplayLink;
- (void)onAnimationFrame:(CADisplayLink *)link;
- (void)flushAnimationFrames:(CFTimeInterval)timestamp;
- (void)installAnimateBridge;
- (void)installWorkletsBridge;
- (BOOL)hasActiveNativeAnimations;
- (void)stepNativeAnimations:(CFTimeInterval)timestamp;
- (double)resolveMappedValue:(const ZynthMappedValue &)value fallback:(double)fallback;
- (void)applyStyleMapperLocked:(const ZynthStyleMapper &)mapper;
- (void)ensureUIRuntime;
- (void)installConsoleOnRuntime:(facebook::jsi::Runtime &)rt;
- (void)installSharedSignalsOnRuntime:(facebook::jsi::Runtime &)rt;
- (void)emitDevtoolsEventWithTopic:(NSString *)topic
                             level:(NSString *)level
                               tag:(NSString *)tag
                              data:(NSDictionary *)data;
- (void)registerWorkletOnUIRuntime:(int)workletId
                               code:(const std::string &)code
                           location:(const std::string &)location
                            closure:(const std::vector<ZynthWorkletClosureValue> &)closure;
- (void)runWorkletOnUIRuntime:(int)workletId;
@end

@implementation HermesRuntimeHost

- (instancetype)initWithUIManager:(SNUIManager *)manager {
  if (self = [super init]) {
    _manager = manager;
    _jsQueue = dispatch_queue_create("com.zynth.hermes.js", DISPATCH_QUEUE_SERIAL);
    _moduleQueue = dispatch_queue_create("com.zynth.hermes.modules", DISPATCH_QUEUE_CONCURRENT);
    
    // Initialize atomics
    _nextTimer = 1;
    _nextAnimationFrame = 1;
    _animationDisplayLink = nil;
    _nextSharedValueId = 1;
    _nextStyleMapperId = 1;
    _nextWorkletId = 1;

    dispatch_sync(_jsQueue, ^{
      _rt = facebook::hermes::makeHermesRuntime();
      _manager.jsInvoker = self;
      [self installConsole];
      [self installUIBridge];
      [self installModulesBridge];
      [self installAnimateBridge];
      [self installWorkletsBridge];
      [self installTimers];
      [self installUnhandledPromiseReporting];
    });
  }
  return self;
}

- (void)dealloc {
    [self stopAnimationDisplayLink];
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
  if (_rt) {
    [self installConsoleOnRuntime:*_rt];
  }
}

- (void)installConsoleOnRuntime:(facebook::jsi::Runtime &)rt {

  HermesRuntimeHost *host = self;
  bool isUIRuntime = false;
  if (_uiRt) {
    isUIRuntime = (&rt == static_cast<facebook::jsi::Runtime *>(_uiRt.get()));
  }
  NSString *runtimeLabel = isUIRuntime ? @"ui" : @"js";

  auto makeConsoleFunction = [&](const char *methodName) {
    std::string level = methodName ? methodName : "log";
    return Function::createFromHostFunction(
        rt, PropNameID::forAscii(rt, methodName), 0,
        [host, level, runtimeLabel](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
          std::string message;
          for (size_t i = 0; i < count; ++i) {
            std::string part;
            try {
              if (args[i].isString()) {
                part = args[i].getString(rt).utf8(rt);
              } else if (args[i].isObject()) {
                auto global = rt.global();
                if (global.hasProperty(rt, "JSON")) {
                  auto jsonObj = global.getPropertyAsObject(rt, "JSON");
                  if (jsonObj.hasProperty(rt, "stringify")) {
                    auto stringify = jsonObj.getPropertyAsFunction(rt, "stringify");
                    auto result = stringify.call(rt, args[i]);
                    if (result.isString()) {
                      part = result.getString(rt).utf8(rt);
                    } else {
                      part = args[i].toString(rt).utf8(rt);
                    }
                  } else {
                    part = args[i].toString(rt).utf8(rt);
                  }
                } else {
                  part = args[i].toString(rt).utf8(rt);
                }
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
          if (host) {
            NSString *levelString = [NSString stringWithUTF8String:level.c_str()];
            NSString *messageString = [NSString stringWithUTF8String:message.c_str()];
            [host emitDevtoolsEventWithTopic:@"log/console"
                                       level:levelString
                                         tag:@"console"
                                        data:@{@"message": messageString ?: @"",
                                               @"runtime": runtimeLabel ?: @""}];
          }

          if (level == "error") {
            ZynthDiagnosticsReport("console.error", message.c_str(), "");
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

- (void)emitDevtoolsEventWithTopic:(NSString *)topic
                             level:(NSString *)level
                               tag:(NSString *)tag
                              data:(NSDictionary *)data {
  if (!self.moduleCallHandler || topic.length == 0) {
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
  NSError *error = nil;
  self.moduleCallHandler(@"Devtools", @"emit", event, &error);
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
            // NSLog(@"[ZynthTrace] __ui.createNode type=%@ -> id=%d", typeStr, nid);
          });
          return Value((double)nid);
        } catch (const facebook::jsi::JSError &error) {
          ZynthReportJSIError(rt, error, "__ui.createNode");
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

            auto copyObject = [&](const char *prop) {
              if (!styleObj.hasProperty(rt, prop)) {
                return;
              }
              Value v = styleObj.getProperty(rt, prop);
              NSString *key = [NSString stringWithUTF8String:prop];
              
              if (v.isString()) {
                 std::string utf8 = v.getString(rt).utf8(rt);
                 styleDict[key] = [NSString stringWithUTF8String:utf8.c_str()];
                 return;
              }
              
              if (v.isObject()) {
                auto JSON = rt.global().getPropertyAsObject(rt, "JSON");
                auto stringify = JSON.getPropertyAsFunction(rt, "stringify");
                Value stringified = stringify.call(rt, v);
                if (stringified.isString()) {
                    std::string utf8 = stringified.getString(rt).utf8(rt);
                    styleDict[key] = [NSString stringWithUTF8String:utf8.c_str()];
                }
              }
            };

            const char *numericKeys[] = {"width",            "height",           "flex",           "flexGrow",
                                         "flexShrink",       "flexBasis",        "padding",        "paddingHorizontal",
                                         "paddingVertical",  "paddingTop",       "paddingRight",   "paddingBottom",
                                         "paddingLeft",      "margin",           "marginHorizontal", "marginVertical",
                                         "marginTop",        "marginRight",      "marginBottom",   "marginLeft",
                                         "borderRadius",     "borderWidth",      "fontSize",       "top",
                                         "right",            "bottom",           "left",           "opacity",
                                         "shadowOpacity",    "shadowRadius",     "elevation",
                                         "zIndex",           "gap",              "rowGap",         "columnGap",
                                         "minWidth",         "minHeight",        "maxWidth",       "maxHeight",      "aspectRatio",
                                         "borderTopWidth",   "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
                                         "borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius",
                                         "lineHeight",       "lineSpacing",      "paragraphSpacing", "letterSpacing",
                                         "baselineShift",    "minimumFontScale"};
            for (const char *key : numericKeys) {
              copyNumber(key);
            }

            const char *stringKeys[] = {"flexDirection",    "justifyContent",   "alignItems",      "alignSelf",
                                         "alignContent",    "flexWrap",         "background",      "backgroundImage",
                                         "backgroundColor", "borderColor",
                                         "borderStyle",     "fontWeight",       "color",           "position",
                                         "display",         "overflow",         "pointerEvents",
                                         "borderTopColor",  "borderRightColor", "borderBottomColor", "borderLeftColor",
                                         "shadowColor",     "boxShadow",
                                         "fontFamily",      "fontStyle",        "textAlign",
                                         "textDecorationLine", "textTransform", "hyphenation"};
            for (const char *key : stringKeys) {
              copyString(key);
            }
            
            const char *objectKeys[] = {"transform", "transformOrigin", "shadowOffset", "boxShadow", "background", "backgroundImage"};
            for (const char *key : objectKeys) {
              copyObject(key);
            }

            SNEnqueueOnMain(^{ 
              [[host manager] setStyle:@(id) style:styleDict];
            });
            return Value::undefined();
          }

          if (propValue.isUndefined() || (propValue.isObject() && propValue.asObject(rt).isFunction(rt))) {
            SNEnqueueOnMain(^{ 
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
            SNEnqueueOnMain(^{ 
              [[host manager] setProp:@(id)
                                        name:nameStr
                                   valueJSON:[NSString stringWithUTF8String:fallback.c_str()]] ;
            });
            return Value::undefined();
          }
          std::string jsonUTF8 = stringified.getString(rt).utf8(rt);
          SNEnqueueOnMain(^{ 
            [[host manager] setProp:@(id)
                                      name:nameStr
                                 valueJSON:[NSString stringWithUTF8String:jsonUTF8.c_str()]] ;
          });
        } catch (const facebook::jsi::JSError &error) {
          ZynthReportJSIError(rt, error, "__ui.setProp");
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
          SNEnqueueOnMain(^{ 
            // NSLog(@"[ZynthTrace] __ui.setText id=%d text='%s'", id, text.c_str());
            [[host manager] setText:@(id) text:[NSString stringWithUTF8String:text.c_str()]];
          });
        } catch (const facebook::jsi::JSError &error) {
          ZynthReportJSIError(rt, error, "__ui.setText");
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
          SNEnqueueOnMain(^{ 
            // NSLog(@"[ZynthTrace] __ui.insertChild parent=%d child=%d index=%d", parentId, childId, index);
            [[host manager] insertChild:@(parentId)
                                   child:@(childId)
                                   index:@(index)];
          });
        } catch (const facebook::jsi::JSError &error) {
          ZynthReportJSIError(rt, error, "__ui.insertChild");
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
          [host sn_removeHandlersForNode:childId];
          SNEnqueueOnMain(^{ 
            // NSLog(@"[ZynthTrace] __ui.removeChild parent=%d child=%d", parentId, childId);
            [[host manager] removeChild:@(parentId) child:@(childId)];
          });
        } catch (const facebook::jsi::JSError &error) {
          ZynthReportJSIError(rt, error, "__ui.removeChild");
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"__ui.removeChild"];
        }
        return Value::undefined();
      });

  auto hostSetSurface = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setSurface"), 1,
      [host](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        try {
          if (count < 1 || !args[0].isNumber()) {
            return Value::undefined();
          }
          int surfaceId = (int)args[0].asNumber();
          SNRunOnMain(^{ 
            [[host manager] setActiveSurface:surfaceId];
          });
        } catch (const facebook::jsi::JSError &error) {
          ZynthReportJSIError(rt, error, "__ui.setSurface");
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"__ui.setSurface"];
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
          SNEnqueueOnMain(^{ 
            [[host manager] setHandler:@(id) name:[NSString stringWithUTF8String:name.c_str()]];
          });
        } catch (const facebook::jsi::JSError &error) {
          ZynthReportJSIError(rt, error, "__ui.setHandler");
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"__ui.setHandler"];
        }
        return Value::undefined();
      });

  auto hostFlush = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "flush"), 0,
      [host](Runtime &, const Value &, const Value *, size_t) -> Value {
        SNEnqueueOnMain(^{ 
          @try {
            [[host manager] flush];
          } @catch (NSException *exception) {
            std::string message = exception.reason ? [exception.reason UTF8String] : "flush failed";
            [host reportExceptionWithContext:@"__ui.flush" message:message stack:""];
          }
        });
        return Value::undefined();
      });

  auto hostApplyBatch = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "applyBatch"), 1,
      [host](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        try {
          if (count < 1) {
            return Value::undefined();
          }

          std::string payload;
          if (a[0].isString()) {
            payload = a[0].getString(rt).utf8(rt);
          } else {
            auto JSON = rt.global().getPropertyAsObject(rt, "JSON");
            auto stringify = JSON.getPropertyAsFunction(rt, "stringify");
            Value stringified = stringify.call(rt, a[0]);
            if (stringified.isString()) {
              payload = stringified.getString(rt).utf8(rt);
            } else {
              payload = a[0].toString(rt).utf8(rt);
            }
          }

          if (payload.empty()) {
            return Value::undefined();
          }

          NSString *json = [NSString stringWithUTF8String:payload.c_str()];
          SNEnqueueOnMain(^{ 
            [[host manager] applyBatch:json];
          });
        } catch (const facebook::jsi::JSError &error) {
          ZynthReportJSIError(rt, error, "__ui.applyBatch");
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"__ui.applyBatch"];
        }
        return Value::undefined();
      });

  Object ui(rt);
  ui.setProperty(rt, "createNode", hostCreateNode);
  ui.setProperty(rt, "setProp", hostSetProp);
  ui.setProperty(rt, "setText", hostSetText);
  ui.setProperty(rt, "insertChild", hostInsertChild);
  ui.setProperty(rt, "removeChild", hostRemoveChild);
  ui.setProperty(rt, "setSurface", hostSetSurface);
  ui.setProperty(rt, "setHandler", hostSetHandler);
  ui.setProperty(rt, "flush", hostFlush);
  ui.setProperty(rt, "applyBatch", hostApplyBatch);
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
                    ZynthDiagnosticsReport("modules", nativeError.c_str(), "");
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
                    ZynthDiagnosticsReport("modules", message.c_str(), "");
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
                    ZynthReportJSIError(rtRef, error, "modules");
                    Object errorObj(rtRef);
                    errorObj.setProperty(rtRef, "code", String::createFromUtf8(rtRef, "invalid_json"));
                    errorObj.setProperty(rtRef, "message", String::createFromUtf8(rtRef, message));
                    Value errorValue = Value(rtRef, errorObj);
                    SNCallJSFunction(*rejectPtr, rtRef, &errorValue, 1);
                  } catch (const std::exception &ex) {
                    std::string message(ex.what());
                    NSLog(@"[Hermes] __modules.call resolve std::exception: %s", message.c_str());
                    ZynthDiagnosticsReport("modules", message.c_str(), "");
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
          ZynthReportJSIError(rt, error, "__modules.call");
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
            NSMutableArray *argsArray = [NSMutableArray arrayWithCapacity:count - 2];
            for (size_t i = 2; i < count; i++) {
              id value = SNConvertJSIValueToNSObject(rt, a[i]);
              [argsArray addObject:value ?: [NSNull null]];
            }
            argsObject = argsArray;
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
          ZynthReportJSIError(rt, error, "__modules.callSync");
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
  rt.global().setProperty(rt, "__zynthCallSync", hostCallSync);
}

- (BOOL)hasActiveNativeAnimations {
  std::lock_guard<std::mutex> lock(_animateMutex);
  for (const auto &entry : _sharedValues) {
    if (entry.second.animating) {
      return YES;
    }
  }
  return NO;
}

- (double)resolveMappedValue:(const ZynthMappedValue &)value fallback:(double)fallback {
  if (!value.hasValue) {
    return fallback;
  }
  if (value.isShared) {
    auto it = _sharedValues.find(value.sharedId);
    if (it != _sharedValues.end()) {
      return value.isAngle ? ZynthDegreesToRadians(it->second.value) : it->second.value;
    }
    return fallback;
  }
  return value.numberValue;
}

- (void)applyStyleMapperLocked:(const ZynthStyleMapper &)mapper {
  SNNode *node = [_manager zynth_nodeForId:@(mapper.nodeId)];
  if (!node || !node.view) return;

  double opacity = [self resolveMappedValue:mapper.opacity fallback:mapper.baseOpacity];
  double translateX = [self resolveMappedValue:mapper.translateX fallback:mapper.baseTranslateX];
  double translateY = [self resolveMappedValue:mapper.translateY fallback:mapper.baseTranslateY];
  double baseScaleX = mapper.baseScaleX;
  double baseScaleY = mapper.baseScaleY;
  double scale = mapper.scale.hasValue ? [self resolveMappedValue:mapper.scale fallback:1.0] : 0.0;
  double scaleX = mapper.scaleX.hasValue
      ? [self resolveMappedValue:mapper.scaleX fallback:baseScaleX]
      : (mapper.scale.hasValue ? scale : baseScaleX);
  double scaleY = mapper.scaleY.hasValue
      ? [self resolveMappedValue:mapper.scaleY fallback:baseScaleY]
      : (mapper.scale.hasValue ? scale : baseScaleY);
  double rotate = [self resolveMappedValue:mapper.rotate fallback:mapper.baseRotate];
  double rotateX = [self resolveMappedValue:mapper.rotateX fallback:mapper.baseRotateX];
  double rotateY = [self resolveMappedValue:mapper.rotateY fallback:mapper.baseRotateY];
  double skewX = [self resolveMappedValue:mapper.skewX fallback:mapper.baseSkewX];
  double skewY = [self resolveMappedValue:mapper.skewY fallback:mapper.baseSkewY];
  double perspective = [self resolveMappedValue:mapper.perspective fallback:mapper.basePerspective];

  UIView *view = node.view;
  view.alpha = (CGFloat)opacity;
  CATransform3D transform = CATransform3DIdentity;
  if (perspective != 0.0) {
    transform.m34 = -1.0 / perspective;
  } else if (rotateX != 0.0 || rotateY != 0.0) {
    // Apply default perspective to match Android's default camera distance
    // if 3D rotation is used without explicit perspective.
    transform.m34 = -1.0 / 500.0;
  }
  transform = CATransform3DTranslate(transform, (CGFloat)translateX, (CGFloat)translateY, 0.0);
  if (rotate != 0.0) {
    transform = CATransform3DRotate(transform, (CGFloat)rotate, 0.0, 0.0, 1.0);
  }
  if (rotateX != 0.0 || rotateY != 0.0) {
    CATransform3D rotateXY = ZynthRotateXYMatrix(-rotateX, -rotateY);
    transform = CATransform3DConcat(transform, rotateXY);
  }
  if (skewX != 0.0 || skewY != 0.0) {
    CATransform3D skew = CATransform3DIdentity;
    skew.m21 = tan(skewX);
    skew.m12 = tan(skewY);
    transform = CATransform3DConcat(transform, skew);
  }
  transform = CATransform3DScale(transform, (CGFloat)scaleX, (CGFloat)scaleY, 1.0);
  view.layer.transform = transform;
}

- (void)stepNativeAnimations:(CFTimeInterval)timestamp {
  std::lock_guard<std::mutex> lock(_animateMutex);
  if (_sharedValues.empty()) return;

  bool hasActive = false;
  for (auto &entry : _sharedValues) {
    auto &shared = entry.second;
    if (!shared.animating) continue;
    auto &anim = shared.animation;
    double now = timestamp;
    if (now < anim.startTime) {
      hasActive = true;
      continue;
    }

    if (anim.kind == ZynthSharedAnimationKind::Timing) {
      double duration = std::max(anim.duration, 0.0001);
      double elapsed = now - anim.startTime;
      double progress = std::min(elapsed / duration, 1.0);
      double eased = ZynthApplyEasing(anim.easing, progress);
      shared.value = anim.fromValue + (anim.toValue - anim.fromValue) * eased;
      if (progress >= 1.0) {
        shared.value = anim.toValue;
        shared.animating = false;
      } else {
        hasActive = true;
      }
    } else {
      if (anim.lastTime == 0.0) {
        anim.lastTime = now;
        hasActive = true;
        continue;
      }
      double delta = std::min(now - anim.lastTime, 0.064);
      anim.lastTime = now;
      double displacement = shared.value - anim.toValue;
      double springForce = -anim.stiffness * displacement;
      double dampingForce = -anim.damping * anim.velocity;
      double acceleration = (springForce + dampingForce) / anim.mass;
      anim.velocity += acceleration * delta;
      shared.value += anim.velocity * delta;

      if (anim.overshootClamping) {
        if ((anim.toValue - anim.fromValue) > 0.0 && shared.value > anim.toValue) {
          shared.value = anim.toValue;
          anim.velocity = 0.0;
        } else if ((anim.toValue - anim.fromValue) < 0.0 && shared.value < anim.toValue) {
          shared.value = anim.toValue;
          anim.velocity = 0.0;
        }
      }

      if (std::abs(anim.velocity) <= anim.restSpeed &&
          std::abs(displacement) <= anim.restDisplacement) {
        shared.value = anim.toValue;
        shared.animating = false;
      } else {
        hasActive = true;
      }
    }
  }

  for (const auto &entry : _styleMappers) {
    [self applyStyleMapperLocked:entry.second];
  }

  if (hasActive) {
    [self ensureAnimationDisplayLink];
  }
}

- (void)installAnimateBridge {
  auto &rt = *_rt;
  HermesRuntimeHost *host = self;

  auto createSharedValue = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "createSharedValue"), 1,
      [host](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        double initial = (count > 0 && args[0].isNumber()) ? args[0].asNumber() : 0.0;
        int id = host->_nextSharedValueId++;
        {
          std::lock_guard<std::mutex> lock(host->_animateMutex);
          ZynthSharedValue shared;
          shared.value = initial;
          host->_sharedValues[id] = shared;
        }
        return Value((double)id);
      });

  auto getSharedValue = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "getSharedValue"), 1,
      [host](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int id = static_cast<int>(args[0].asNumber());
        std::lock_guard<std::mutex> lock(host->_animateMutex);
        auto it = host->_sharedValues.find(id);
        if (it == host->_sharedValues.end()) {
          return Value::undefined();
        }
        return Value(it->second.value);
      });

  auto setSharedValue = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setSharedValue"), 2,
      [host](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isNumber()) {
          return Value::undefined();
        }
        int id = static_cast<int>(args[0].asNumber());
        double value = args[1].asNumber();
        {
          std::lock_guard<std::mutex> lock(host->_animateMutex);
          auto it = host->_sharedValues.find(id);
          if (it == host->_sharedValues.end()) {
            return Value::undefined();
          }
          it->second.value = value;
          it->second.animating = false;
        }
        SNRunOnMain(^{
          std::lock_guard<std::mutex> lock(host->_animateMutex);
          for (const auto &entry : host->_styleMappers) {
            [host applyStyleMapperLocked:entry.second];
          }
        });
        return Value::undefined();
      });

  auto cancelSharedValue = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "cancelSharedValue"), 1,
      [host](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int id = static_cast<int>(args[0].asNumber());
        std::lock_guard<std::mutex> lock(host->_animateMutex);
        auto it = host->_sharedValues.find(id);
        if (it != host->_sharedValues.end()) {
          it->second.animating = false;
        }
        return Value::undefined();
      });

  auto animateSharedValue = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "animateSharedValue"), 2,
      [host](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isObject()) {
          return Value::undefined();
        }
        int id = static_cast<int>(args[0].asNumber());
        auto config = args[1].getObject(rt);

        auto typeValue = config.getProperty(rt, "type");
        if (!typeValue.isString()) {
          return Value::undefined();
        }
        std::string type = typeValue.getString(rt).utf8(rt);

        auto toValueValue = config.getProperty(rt, "toValue");
        if (!toValueValue.isNumber()) {
          return Value::undefined();
        }
        double toValue = toValueValue.asNumber();

        ZynthSharedValueAnimation animation;
        animation.fromValue = 0.0;
        animation.toValue = toValue;
        animation.startTime = CACurrentMediaTime();
        animation.delay = 0.0;
        animation.duration = 0.3;

        if (config.hasProperty(rt, "delay")) {
          auto delayValue = config.getProperty(rt, "delay");
          if (delayValue.isNumber()) {
            animation.delay = delayValue.asNumber() / 1000.0;
          }
        }
        if (config.hasProperty(rt, "duration")) {
          auto durationValue = config.getProperty(rt, "duration");
          if (durationValue.isNumber()) {
            animation.duration = std::max(durationValue.asNumber() / 1000.0, 0.0);
          }
        }
        if (config.hasProperty(rt, "easing")) {
          auto easingValue = config.getProperty(rt, "easing");
          if (easingValue.isString()) {
            animation.easing = ZynthParseEasing(easingValue.getString(rt).utf8(rt));
          }
        }

        animation.startTime += animation.delay;

        {
          std::lock_guard<std::mutex> lock(host->_animateMutex);
          auto it = host->_sharedValues.find(id);
          if (it == host->_sharedValues.end()) {
            return Value::undefined();
          }
          animation.fromValue = it->second.value;
          if (type == "timing") {
            animation.kind = ZynthSharedAnimationKind::Timing;
          } else {
            animation.kind = ZynthSharedAnimationKind::Spring;
            if (config.hasProperty(rt, "damping")) {
              auto value = config.getProperty(rt, "damping");
              if (value.isNumber()) animation.damping = value.asNumber();
            }
            if (config.hasProperty(rt, "stiffness")) {
              auto value = config.getProperty(rt, "stiffness");
              if (value.isNumber()) animation.stiffness = value.asNumber();
            }
            if (config.hasProperty(rt, "mass")) {
              auto value = config.getProperty(rt, "mass");
              if (value.isNumber()) animation.mass = value.asNumber();
            }
            if (config.hasProperty(rt, "velocity")) {
              auto value = config.getProperty(rt, "velocity");
              if (value.isNumber()) animation.velocity = value.asNumber();
            }
            if (config.hasProperty(rt, "restSpeedThreshold")) {
              auto value = config.getProperty(rt, "restSpeedThreshold");
              if (value.isNumber()) animation.restSpeed = value.asNumber();
            }
            if (config.hasProperty(rt, "restDisplacementThreshold")) {
              auto value = config.getProperty(rt, "restDisplacementThreshold");
              if (value.isNumber()) animation.restDisplacement = value.asNumber();
            }
            if (config.hasProperty(rt, "overshootClamping")) {
              auto value = config.getProperty(rt, "overshootClamping");
              if (value.isBool()) animation.overshootClamping = value.getBool();
            }
          }
          it->second.animation = animation;
          it->second.animating = true;
        }

        [host ensureAnimationDisplayLink];
        return Value::undefined();
      });

  auto createStyleMapper = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "createStyleMapper"), 2,
      [host](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isObject()) {
          return Value::undefined();
        }
        int nodeId = static_cast<int>(args[0].asNumber());
        auto styleObj = args[1].getObject(rt);

        ZynthStyleMapper mapper;
        mapper.id = host->_nextStyleMapperId++;
        mapper.nodeId = nodeId;

        if (styleObj.hasProperty(rt, "opacity")) {
          ZynthParseMappedValue(rt, styleObj.getProperty(rt, "opacity"), mapper.opacity);
        }
        if (styleObj.hasProperty(rt, "transform")) {
          auto transformValue = styleObj.getProperty(rt, "transform");
          if (transformValue.isObject() && transformValue.getObject(rt).isArray(rt)) {
            auto array = transformValue.getObject(rt).getArray(rt);
            size_t length = array.size(rt);
            for (size_t i = 0; i < length; ++i) {
              auto entryValue = array.getValueAtIndex(rt, i);
              if (!entryValue.isObject()) continue;
              auto entry = entryValue.getObject(rt);
              auto keys = entry.getPropertyNames(rt);
              size_t keyCount = keys.size(rt);
              for (size_t k = 0; k < keyCount; ++k) {
                auto keyValue = keys.getValueAtIndex(rt, k);
                if (!keyValue.isString()) continue;
                std::string key = keyValue.getString(rt).utf8(rt);
                auto propValue = entry.getProperty(rt, key.c_str());
                if (key == "translateX") ZynthParseMappedValue(rt, propValue, mapper.translateX);
                else if (key == "translateY") ZynthParseMappedValue(rt, propValue, mapper.translateY);
                else if (key == "scale") ZynthParseMappedValue(rt, propValue, mapper.scale);
                else if (key == "scaleX") ZynthParseMappedValue(rt, propValue, mapper.scaleX);
                else if (key == "scaleY") ZynthParseMappedValue(rt, propValue, mapper.scaleY);
                else if (key == "rotate" || key == "rotateZ") ZynthParseMappedValue(rt, propValue, mapper.rotate, true);
                else if (key == "rotateX") ZynthParseMappedValue(rt, propValue, mapper.rotateX, true);
                else if (key == "rotateY") ZynthParseMappedValue(rt, propValue, mapper.rotateY, true);
                else if (key == "skewX") ZynthParseMappedValue(rt, propValue, mapper.skewX, true);
                else if (key == "skewY") ZynthParseMappedValue(rt, propValue, mapper.skewY, true);
                else if (key == "perspective") ZynthParseMappedValue(rt, propValue, mapper.perspective);
              }
            }
          }
        }

        __block ZynthStyleMapper mapperRef = mapper;
        SNRunOnMain(^{
        SNNode *node = [host.manager zynth_nodeForId:@(nodeId)];
        if (!node || !node.view) return;
        CATransform3D transform = node.view.layer.transform;
        double translateX = transform.m41;
        double translateY = transform.m42;
        double scaleX = sqrt(transform.m11 * transform.m11 + transform.m12 * transform.m12 + transform.m13 * transform.m13);
        double scaleY = sqrt(transform.m21 * transform.m21 + transform.m22 * transform.m22 + transform.m23 * transform.m23);
        double rotation = atan2(transform.m12, transform.m11);
        double perspective = (transform.m34 != 0.0) ? (-1.0 / transform.m34) : 0.0;

                            mapperRef.baseOpacity = node.view.alpha;
                            mapperRef.baseTranslateX = translateX;
                            mapperRef.baseTranslateY = translateY;
                            mapperRef.baseScaleX = scaleX;
                            mapperRef.baseScaleY = scaleY;
                            mapperRef.baseRotate = rotation;
                            mapperRef.basePerspective = perspective;          std::lock_guard<std::mutex> lock(host->_animateMutex);
          host->_styleMappers[mapperRef.id] = mapperRef;
          [host applyStyleMapperLocked:mapperRef];
        });

        return Value((double)mapper.id);
      });

  auto updateStyleMapper = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "updateStyleMapper"), 2,
      [host](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isObject()) {
          return Value::undefined();
        }
        int mapperId = static_cast<int>(args[0].asNumber());
        auto styleObj = args[1].getObject(rt);

        ZynthStyleMapper updated;
        {
          std::lock_guard<std::mutex> lock(host->_animateMutex);
          auto it = host->_styleMappers.find(mapperId);
          if (it == host->_styleMappers.end()) {
            return Value::undefined();
          }
          updated = it->second;
        }

        updated.opacity = ZynthMappedValue();
        updated.translateX = ZynthMappedValue();
        updated.translateY = ZynthMappedValue();
        updated.scale = ZynthMappedValue();
        updated.scaleX = ZynthMappedValue();
        updated.scaleY = ZynthMappedValue();
        updated.rotate = ZynthMappedValue();
        updated.rotateX = ZynthMappedValue();
        updated.rotateY = ZynthMappedValue();
        updated.skewX = ZynthMappedValue();
        updated.skewY = ZynthMappedValue();
        updated.perspective = ZynthMappedValue();

        if (styleObj.hasProperty(rt, "opacity")) {
          ZynthParseMappedValue(rt, styleObj.getProperty(rt, "opacity"), updated.opacity);
        }
        if (styleObj.hasProperty(rt, "transform")) {
          auto transformValue = styleObj.getProperty(rt, "transform");
          if (transformValue.isObject() && transformValue.getObject(rt).isArray(rt)) {
            auto array = transformValue.getObject(rt).getArray(rt);
            size_t length = array.size(rt);
            for (size_t i = 0; i < length; ++i) {
              auto entryValue = array.getValueAtIndex(rt, i);
              if (!entryValue.isObject()) continue;
              auto entry = entryValue.getObject(rt);
              auto keys = entry.getPropertyNames(rt);
              size_t keyCount = keys.size(rt);
              for (size_t k = 0; k < keyCount; ++k) {
                auto keyValue = keys.getValueAtIndex(rt, k);
                if (!keyValue.isString()) continue;
                std::string key = keyValue.getString(rt).utf8(rt);
                auto propValue = entry.getProperty(rt, key.c_str());
                if (key == "translateX") ZynthParseMappedValue(rt, propValue, updated.translateX);
                else if (key == "translateY") ZynthParseMappedValue(rt, propValue, updated.translateY);
                else if (key == "scale") ZynthParseMappedValue(rt, propValue, updated.scale);
                else if (key == "scaleX") ZynthParseMappedValue(rt, propValue, updated.scaleX);
                else if (key == "scaleY") ZynthParseMappedValue(rt, propValue, updated.scaleY);
                else if (key == "rotate" || key == "rotateZ") ZynthParseMappedValue(rt, propValue, updated.rotate, true);
                else if (key == "rotateX") ZynthParseMappedValue(rt, propValue, updated.rotateX, true);
                else if (key == "rotateY") ZynthParseMappedValue(rt, propValue, updated.rotateY, true);
                else if (key == "skewX") ZynthParseMappedValue(rt, propValue, updated.skewX, true);
                else if (key == "skewY") ZynthParseMappedValue(rt, propValue, updated.skewY, true);
                else if (key == "perspective") ZynthParseMappedValue(rt, propValue, updated.perspective);
              }
            }
          }
        }

        SNRunOnMain(^{
          std::lock_guard<std::mutex> lock(host->_animateMutex);
          host->_styleMappers[mapperId] = updated;
          [host applyStyleMapperLocked:updated];
        });

        return Value::undefined();
      });

  auto removeStyleMapper = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "removeStyleMapper"), 1,
      [host](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int mapperId = static_cast<int>(args[0].asNumber());
        std::lock_guard<std::mutex> lock(host->_animateMutex);
        host->_styleMappers.erase(mapperId);
        return Value::undefined();
      });

  Object sharedStore(rt);
  sharedStore.setProperty(rt, "createSharedValue", createSharedValue);
  sharedStore.setProperty(rt, "getSharedValue", getSharedValue);
  sharedStore.setProperty(rt, "setSharedValue", setSharedValue);
  sharedStore.setProperty(rt, "animateSharedValue", animateSharedValue);
  sharedStore.setProperty(rt, "cancelSharedValue", cancelSharedValue);
  sharedStore.setProperty(rt, "createStyleMapper", createStyleMapper);
  sharedStore.setProperty(rt, "updateStyleMapper", updateStyleMapper);
  sharedStore.setProperty(rt, "removeStyleMapper", removeStyleMapper);
  rt.global().setProperty(rt, "__zynth_animate", sharedStore);
  rt.global().setProperty(rt, "__zynth_shared_signals", sharedStore);
}

- (void)installSharedSignalsOnRuntime:(facebook::jsi::Runtime &)rt {
  HermesRuntimeHost *host = self;

  auto getSharedValue = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "getSharedValue"), 1,
      [host](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int id = static_cast<int>(args[0].asNumber());
        std::lock_guard<std::mutex> lock(host->_animateMutex);
        auto it = host->_sharedValues.find(id);
        if (it == host->_sharedValues.end()) {
          return Value::undefined();
        }
        return Value(it->second.value);
      });

  auto setSharedValue = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setSharedValue"), 2,
      [host](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isNumber()) {
          return Value::undefined();
        }
        int id = static_cast<int>(args[0].asNumber());
        double value = args[1].asNumber();
        {
          std::lock_guard<std::mutex> lock(host->_animateMutex);
          auto it = host->_sharedValues.find(id);
          if (it == host->_sharedValues.end()) {
            return Value::undefined();
          }
          it->second.value = value;
          it->second.animating = false;
        }
        SNEnqueueOnMain(^{
          std::lock_guard<std::mutex> lock(host->_animateMutex);
          for (const auto &entry : host->_styleMappers) {
            [host applyStyleMapperLocked:entry.second];
          }
        });
        return Value::undefined();
      });

  Object shared(rt);
  shared.setProperty(rt, "getSharedValue", getSharedValue);
  shared.setProperty(rt, "setSharedValue", setSharedValue);
  rt.global().setProperty(rt, "__zynth_shared_signals", shared);
}

- (void)ensureUIRuntime {
  if (_uiRt) {
    return;
  }
  _uiRt = facebook::hermes::makeHermesRuntime();
  [self installConsoleOnRuntime:*_uiRt];
  [self installSharedSignalsOnRuntime:*_uiRt];
}

- (void)registerWorkletOnUIRuntime:(int)workletId
                               code:(const std::string &)code
                           location:(const std::string &)location
                            closure:(const std::vector<ZynthWorkletClosureValue> &)closure {
  [self ensureUIRuntime];
  if (!_uiRt) {
    return;
  }
  auto &rt = *_uiRt;
  try {
    std::string source = "(" + code + ")";
    source.append("\n//# sourceURL=zynth-worklet.js");
    auto buffer = std::make_shared<StringBuffer>(source.c_str());
    auto result = rt.evaluateJavaScript(buffer, "zynth-worklet.js");
    if (!result.isObject() || !result.getObject(rt).isFunction(rt)) {
      return;
    }
    auto fn = std::make_shared<Function>(result.getObject(rt).getFunction(rt));
    std::lock_guard<std::mutex> lock(_uiWorkletMutex);
    _uiWorklets[workletId] = fn;
    _uiWorkletClosures[workletId] = closure;
    [self emitDevtoolsEventWithTopic:@"worklet/ios"
                               level:@"debug"
                                 tag:@"worklet"
                                data:@{
                                  @"phase": @"register",
                                  @"id": @(workletId),
                                  @"location": [NSString stringWithUTF8String:location.c_str()],
                                  @"isMainThread": @([NSThread isMainThread])
                                }];
  } catch (const facebook::jsi::JSError &error) {
    ZynthReportJSIError(rt, error, "WorkletRegister");
  } catch (const std::exception &ex) {
    [self reportStdException:ex context:@"WorkletRegister"];
  }
}

- (void)runWorkletOnUIRuntime:(int)workletId {
  [self ensureUIRuntime];
  if (!_uiRt) {
    return;
  }
  HermesRuntimeHost *host = self;
  auto &rt = *_uiRt;
  std::shared_ptr<Function> fn;
  std::vector<ZynthWorkletClosureValue> closure;
  {
    std::lock_guard<std::mutex> lock(_uiWorkletMutex);
    auto it = _uiWorklets.find(workletId);
    if (it == _uiWorklets.end()) {
      return;
    }
    fn = it->second;
    auto closureIt = _uiWorkletClosures.find(workletId);
    if (closureIt != _uiWorkletClosures.end()) {
      closure = closureIt->second;
    }
  }

  auto global = rt.global();
  for (const auto &entry : closure) {
    auto propId = PropNameID::forUtf8(rt, entry.name);
    switch (entry.kind) {
      case ZynthWorkletClosureValue::Kind::Shared: {
        int sharedId = entry.sharedId;
        auto getter = Function::createFromHostFunction(
            rt, propId, 0,
            [host, sharedId](Runtime &rt, const Value &, const Value *, size_t) -> Value {
              std::lock_guard<std::mutex> lock(host->_animateMutex);
              auto it = host->_sharedValues.find(sharedId);
              if (it == host->_sharedValues.end()) {
                return Value::undefined();
              }
              return Value(it->second.value);
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
        global.setProperty(
            rt,
            propId,
            String::createFromUtf8(rt, entry.stringValue));
        break;
    }
  }

  try {
    [self emitDevtoolsEventWithTopic:@"worklet/ios"
                               level:@"debug"
                                 tag:@"worklet"
                                data:@{
                                  @"phase": @"run",
                                  @"id": @(workletId),
                                  @"isMainThread": @([NSThread isMainThread])
                                }];
    fn->call(rt);
  } catch (const facebook::jsi::JSError &error) {
    ZynthReportJSIError(rt, error, "WorkletRun");
  } catch (const std::exception &ex) {
    [self reportStdException:ex context:@"WorkletRun"];
  }
}

- (void)installWorkletsBridge {
  auto &rt = *_rt;
  HermesRuntimeHost *host = self;

  auto registerWorklet = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "register"), 1,
      [host](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isObject()) {
          return Value::undefined();
        }
        auto payload = args[0].getObject(rt);
        if (!payload.hasProperty(rt, "code")) {
          return Value::undefined();
        }
        auto codeValue = payload.getProperty(rt, "code");
        if (!codeValue.isString()) {
          return Value::undefined();
        }
        std::string code = codeValue.getString(rt).utf8(rt);
        std::string location;
        if (payload.hasProperty(rt, "location")) {
          auto locValue = payload.getProperty(rt, "location");
          if (locValue.isString()) {
            location = locValue.getString(rt).utf8(rt);
          }
        }
        std::vector<ZynthWorkletClosureValue> closure;

        if (payload.hasProperty(rt, "closure")) {
          auto closureValue = payload.getProperty(rt, "closure");
          if (closureValue.isObject()) {
            auto closureObj = closureValue.getObject(rt);
            auto keys = closureObj.getPropertyNames(rt);
            size_t keyCount = keys.size(rt);
            for (size_t i = 0; i < keyCount; ++i) {
              auto keyValue = keys.getValueAtIndex(rt, i);
              if (!keyValue.isString()) continue;
              std::string name = keyValue.getString(rt).utf8(rt);
              auto entryValue = closureObj.getProperty(rt, name.c_str());
              if (entryValue.isObject()) {
                auto entryObj = entryValue.getObject(rt);
                if (entryObj.hasProperty(rt, kZynthSharedValueKey)) {
                  auto idValue = entryObj.getProperty(rt, kZynthSharedValueKey);
                  if (idValue.isNumber()) {
                    ZynthWorkletClosureValue entry;
                    entry.name = name;
                    entry.kind = ZynthWorkletClosureValue::Kind::Shared;
                    entry.sharedId = static_cast<int>(idValue.asNumber());
                    closure.push_back(entry);
                  }
                }
              } else if (entryValue.isNumber()) {
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
                entry.stringValue = entryValue.getString(rt).utf8(rt);
                closure.push_back(entry);
              }
            }
          }
        }

        int workletId = host->_nextWorkletId++;
        auto codeCopy = std::make_shared<std::string>(code);
        auto locationCopy = std::make_shared<std::string>(location);
        auto closureCopy = std::make_shared<std::vector<ZynthWorkletClosureValue>>(closure);

        SNRunOnMain(^{
          HermesRuntimeHost *strongHost = host;
          if (!strongHost) return;
          [strongHost registerWorkletOnUIRuntime:workletId
                                           code:*codeCopy
                                       location:*locationCopy
                                        closure:*closureCopy];
        });

        return Value(static_cast<double>(workletId));
      });

  auto runWorklet = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "run"), 1,
      [host](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int workletId = static_cast<int>(args[0].asNumber());
        SNEnqueueOnMain(^{
          HermesRuntimeHost *strongHost = host;
          if (!strongHost) return;
          [strongHost runWorkletOnUIRuntime:workletId];
        });
        return Value::undefined();
      });
  auto runAfter = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "runAfter"), 2,
      [host](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isNumber()) {
          return Value::undefined();
        }
        int workletId = static_cast<int>(args[0].asNumber());
        double delayMs = args[1].asNumber();
        HermesRuntimeHost *strongHost = host;
        if (!strongHost) return Value::undefined();
        int64_t delayNanos = (int64_t)(delayMs * NSEC_PER_MSEC);
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, delayNanos),
                       dispatch_get_main_queue(), ^{
          [strongHost runWorkletOnUIRuntime:workletId];
        });
        return Value::undefined();
      });

  Object worklets(rt);
  worklets.setProperty(rt, "register", registerWorklet);
  worklets.setProperty(rt, "run", runWorklet);
  worklets.setProperty(rt, "runAfter", runAfter);
  rt.global().setProperty(rt, "__zynth_worklets", worklets);
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
      if (!global.hasProperty(rt, "ZynthNativeEmitter")) {
        NSLog(@"[Hermes] ZynthNativeEmitter missing when emitting %@", eventName);
        return;
      }

      auto emitterValue = global.getProperty(rt, "ZynthNativeEmitter");
      if (!emitterValue.isObject()) {
        NSLog(@"[Hermes] ZynthNativeEmitter is not an object when emitting %@", eventName);
        return;
      }

      auto emitterObj = emitterValue.asObject(rt);
      if (!emitterObj.hasProperty(rt, "emit")) {
        NSLog(@"[Hermes] ZynthNativeEmitter.emit missing for event %@", eventName);
        return;
      }

      auto emitValue = emitterObj.getProperty(rt, "emit");
      if (!emitValue.isObject() || !emitValue.asObject(rt).isFunction(rt)) {
        NSLog(@"[Hermes] ZynthNativeEmitter.emit is not a function for event %@", eventName);
        return;
      }

      auto emitFn = emitValue.asObject(rt).asFunction(rt);
      std::string eventNameStd(eventName.UTF8String ?: "");
      Value args[2];
      args[0] = Value(rt, String::createFromUtf8(rt, eventNameStd));
      args[1] = payload ? SNConvertNSObjectToJSI(rt, payload) : Value::undefined();
      SNCallJSFunction(emitFn, rt, args, 2);
    } catch (const facebook::jsi::JSError &error) {
      ZynthReportJSIError(rt, error, "ZynthNativeEmitter.emit");
    } catch (const std::exception &ex) {
      [strongHost reportStdException:ex context:@"ZynthNativeEmitter.emit"];
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

          int timerId = host->_nextTimer.fetch_add(1);
          auto timer = std::make_unique<Timer>();
          timer->id = timerId;
          timer->fn = std::make_shared<Function>(fnObject.asFunction(rt));
          timer->args = std::move(args);
          timer->source = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, host->_jsQueue);
          timer->isInterval = false;
          timer->intervalNs = 0;

          dispatch_source_t source = timer->source;
          host->_timers.emplace(timerId, std::move(timer));

          int64_t delayNs = delayMs < 0 ? 0 : (int64_t)delayMs * NSEC_PER_MSEC;
          dispatch_source_set_timer(source, dispatch_time(DISPATCH_TIME_NOW, delayNs), DISPATCH_TIME_FOREVER, 0);

          dispatch_source_set_event_handler(source, ^{
            auto it = host->_timers.find(timerId);
            if (it == host->_timers.end()) {
              return;
            }
            auto &timerRef = *it->second;
            auto &runtime = *host->_rt;
            const Value *argsPtr = timerRef.args.empty() ? nullptr : timerRef.args.data();
            try {
              timerRef.fn->call(runtime, argsPtr, timerRef.args.size());
            } catch (const facebook::jsi::JSError &error) {
              ZynthReportJSIError(runtime, error, "setTimeout");
            } catch (const std::exception &ex) {
              [host reportStdException:ex context:@"setTimeout"];
            }
            dispatch_source_cancel(timerRef.source);
            host->_timers.erase(it);
          });

          dispatch_resume(source);
          return Value(static_cast<double>(timerId));
        } catch (const facebook::jsi::JSError &error) {
          ZynthReportJSIError(rt, error, "setTimeout");
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"setTimeout"];
        }
        return Value::undefined();
      });

  auto hostSetInterval = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostSetInterval"), 3,
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
          if (delayMs < 1) delayMs = 1; // Minimum 1ms for intervals to prevent tight loops
          
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

          int timerId = host->_nextTimer.fetch_add(1);
          int64_t intervalNs = (int64_t)delayMs * NSEC_PER_MSEC;
          
          auto timer = std::make_unique<Timer>();
          timer->id = timerId;
          timer->fn = std::make_shared<Function>(fnObject.asFunction(rt));
          timer->args = std::move(args);
          timer->source = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, host->_jsQueue);
          timer->isInterval = true;
          timer->intervalNs = intervalNs;

          dispatch_source_t source = timer->source;
          host->_timers.emplace(timerId, std::move(timer));

          // Set repeating timer: first fire after intervalNs, then repeat every intervalNs
          dispatch_source_set_timer(source, dispatch_time(DISPATCH_TIME_NOW, intervalNs), intervalNs, 0);

          dispatch_source_set_event_handler(source, ^{
            auto it = host->_timers.find(timerId);
            if (it == host->_timers.end()) {
              return;
            }
            auto &timerRef = *it->second;
            auto &runtime = *host->_rt;
            const Value *argsPtr = timerRef.args.empty() ? nullptr : timerRef.args.data();
            try {
              timerRef.fn->call(runtime, argsPtr, timerRef.args.size());
            } catch (const facebook::jsi::JSError &error) {
              ZynthReportJSIError(runtime, error, "setInterval");
            } catch (const std::exception &ex) {
              [host reportStdException:ex context:@"setInterval"];
            }
            // Note: Unlike setTimeout, we do NOT cancel or erase the timer here
            // The interval continues until explicitly cleared
          });

          dispatch_resume(source);
          return Value(static_cast<double>(timerId));
        } catch (const facebook::jsi::JSError &error) {
          ZynthReportJSIError(rt, error, "setInterval");
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"setInterval"];
        }
        return Value::undefined();
      });

  auto hostRequestAnimationFrame = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostRequestAnimationFrame"), 1,
      [host](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        try {
          if (count < 1 || !a[0].isObject()) {
            return Value::undefined();
          }
          Object fnObject = a[0].asObject(rt);
          if (!fnObject.isFunction(rt)) {
            return Value::undefined();
          }
          int frameId = host->_nextAnimationFrame.fetch_add(1);
          auto callback = std::make_shared<Function>(fnObject.asFunction(rt));
          host->_animationFrames.emplace(frameId, callback);
          [host ensureAnimationDisplayLink];
          return Value(static_cast<double>(frameId));
        } catch (const facebook::jsi::JSError &error) {
          ZynthReportJSIError(rt, error, "requestAnimationFrame");
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"requestAnimationFrame"];
        }
        return Value::undefined();
      });

  auto hostCancelAnimationFrame = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostCancelAnimationFrame"), 1,
      [host](Runtime &, const Value &, const Value *a, size_t count) -> Value {
        if (count < 1 || !a[0].isNumber()) {
          return Value::undefined();
        }
        int frameId = static_cast<int>(a[0].asNumber());
        host->_animationFrames.erase(frameId);
        if (host->_animationFrames.empty()) {
          [host stopAnimationDisplayLink];
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
          auto it = host->_timers.find(timerId);
          if (it == host->_timers.end()) {
            return Value::undefined();
          }
          dispatch_source_cancel(it->second->source);
          host->_timers.erase(it);
        } catch (const facebook::jsi::JSError &error) {
          ZynthReportJSIError(rt, error, "clearTimeout");
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"clearTimeout"];
        }
        return Value::undefined();
      });

  auto hostClearInterval = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostClearInterval"), 1,
      [host](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        try {
          if (count < 1 || !a[0].isNumber()) {
            return Value::undefined();
          }
          int timerId = static_cast<int>(a[0].asNumber());
          auto it = host->_timers.find(timerId);
          if (it == host->_timers.end()) {
            return Value::undefined();
          }
          dispatch_source_cancel(it->second->source);
          host->_timers.erase(it);
        } catch (const facebook::jsi::JSError &error) {
          ZynthReportJSIError(rt, error, "clearInterval");
        } catch (const std::exception &ex) {
          [host reportStdException:ex context:@"clearInterval"];
        }
        return Value::undefined();
      });

  rt.global().setProperty(rt, "__hostSetTimeout", hostSetTimeout);
  rt.global().setProperty(rt, "__hostSetInterval", hostSetInterval);
  rt.global().setProperty(rt, "__hostClearTimeout", hostClearTimeout);
  rt.global().setProperty(rt, "__hostClearInterval", hostClearInterval);
  rt.global().setProperty(rt, "__hostRequestAnimationFrame", hostRequestAnimationFrame);
  rt.global().setProperty(rt, "__hostCancelAnimationFrame", hostCancelAnimationFrame);

  static const char *timerScript = 
      "globalThis.setTimeout=(fn,ms,...a)=>__hostSetTimeout(fn,ms|0,a);"
    "globalThis.clearTimeout=(id)=>__hostClearTimeout(id);"
    "globalThis.setInterval=(fn,ms,...a)=>__hostSetInterval(fn,ms|0,a);"
    "globalThis.clearInterval=(id)=>__hostClearInterval(id);"
    "globalThis.setImmediate=(fn,...a)=>__hostSetTimeout(fn,0,a);"
    "globalThis.clearImmediate=(id)=>__hostClearTimeout(id);"
    "globalThis.requestAnimationFrame=(fn)=>__hostRequestAnimationFrame(fn);"
    "globalThis.cancelAnimationFrame=(id)=>__hostCancelAnimationFrame(id);";

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
        ZynthDiagnosticsReport("unhandled", message.c_str(), stack.c_str());
        return Value::undefined();
      });

  rt.global().setProperty(rt, "__hostReportUnhandled", reportUnhandled);

  const char *js = R"JS(
    (function(){
      if (globalThis.__zynth && __zynth._uh_installed) return;
      globalThis.__zynth = globalThis.__zynth || {};
      __zynth._uh_installed = true;
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
  _rt->evaluateJavaScript(buffer, "zynth-unhandled.js");
}

- (void)ensureAnimationDisplayLink {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_animationDisplayLink) return;
    self->_animationDisplayLink = [CADisplayLink displayLinkWithTarget:self selector:@selector(onAnimationFrame:)];
    [self->_animationDisplayLink addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
  });
}

- (void)stopAnimationDisplayLink {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!self->_animationDisplayLink) return;
    [self->_animationDisplayLink invalidate];
    self->_animationDisplayLink = nil;
  });
}

- (void)onAnimationFrame:(CADisplayLink *)link {
  CFTimeInterval timestamp = link.timestamp;
  [self stepNativeAnimations:timestamp];
  __weak HermesRuntimeHost *weakSelf = self;
  dispatch_async(_jsQueue, ^{
    [weakSelf flushAnimationFrames:timestamp];
  });
}

- (void)flushAnimationFrames:(CFTimeInterval)timestamp {
  if (!_rt) return;

  std::vector<std::shared_ptr<Function>> callbacks;
  callbacks.reserve(_animationFrames.size());
  for (auto &entry : _animationFrames) {
    callbacks.push_back(entry.second);
  }
  _animationFrames.clear();

  auto &rt = *_rt;
  for (auto &fn : callbacks) {
    try {
      Value ts(static_cast<double>(timestamp * 1000.0));
      SNCallJSFunction(*fn, rt, &ts, 1);
    } catch (const facebook::jsi::JSError &error) {
      ZynthReportJSIError(rt, error, "requestAnimationFrame");
    } catch (const std::exception &ex) {
      [self reportStdException:ex context:@"requestAnimationFrame"];
    }
  }

  if (_animationFrames.empty() && ![self hasActiveNativeAnimations]) {
    [self stopAnimationDisplayLink];
  } else {
    [self ensureAnimationDisplayLink];
  }
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
      ZynthReportJSIError(rt, error, "invokeHandler");
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
      ZynthReportJSIError(*_rt, error, "Evaluate");
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
      ZynthReportJSIError(rt, error, "callGlobal");
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
      auto *rootApiCast = facebook::hermes::makeHermesRootAPI();
      auto *rootApi = facebook::jsi::castInterface<facebook::hermes::IHermesRootAPI>(rootApiCast);
      const bool isBytecode = rootApi ? rootApi->isHermesBytecode(bytes, len) : false;
      if (!isBytecode) {
        // Fallback: try to decode as UTF-8 source
        NSString *code = [[NSString alloc] initWithData:(NSData *)data encoding:NSUTF8StringEncoding];
        if (code.length > 0) {
          [self evaluateString:code];
          return;
        }
      } else {
        if (rootApi) {
          rootApi->prefetchHermesBytecode(bytes, len);
        }
      }

      auto buffer = std::make_shared<NSDataBuffer>(data);
      std::string url = sourceURL ? [sourceURL UTF8String] : "main.hbc";
      _rt->evaluateJavaScript(buffer, url);
    } catch (const facebook::jsi::JSError &error) {
      ZynthReportJSIError(*_rt, error, "EvaluateBytecode");
    } catch (const std::exception &ex) {
      [self reportStdException:ex context:@"EvaluateBytecode"];
    }
  });
}

@end
