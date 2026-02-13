#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>

#import <hermes/hermes.h>
#import <jsi/jsi.h>

#import "ZynthJSIPluginRegistry.h"
#import "ZynthHermesRuntimeHost.h"
#import "ZynthUIManager+Private.h"
#import "ZynthWorklets.h"

#import <algorithm>
#import <atomic>
#import <cmath>
#import <limits>
#import <mutex>
#import <string>
#import <unordered_map>
#import <vector>

using namespace facebook::jsi;

namespace {
static const char *kZynthSharedValueKey = "__zynth_shared_value";
static const char *kZynthAnimateKey = "__zynth_animate";
static const char *kZynthInterpolationKey = "__zynth_interpolation";
static char kZynthAnimateHostAssociationKey;

struct SharedAnimation {
  enum class Kind { Timing, Spring };
  Kind kind = Kind::Timing;
  int signalId = 0;
  double fromValue = 0.0;
  double toValue = 0.0;
  double startTime = 0.0;
  double delay = 0.0;
  double duration = 0.0;
  double lastTime = 0.0;
  double velocity = 0.0;
  double damping = 20.0;
  double stiffness = 150.0;
  double mass = 1.0;
  double restSpeed = 0.001;
  double restDisplacement = 0.001;
  bool overshootClamping = false;
  double direction = 0.0;
  int callbackId = 0;
};

struct SharedAnimationCompletion {
  int callbackId = 0;
  bool finished = false;
};

struct StyleValueRef {
  bool isShared = false;
  bool isInterpolation = false;
  int sharedId = 0;
  double constant = 0.0;
  std::string stringValue;
  std::vector<double> inputRange;
  std::vector<double> outputRange;
  std::string extrapolateLeft = "clamp";
  std::string extrapolateRight = "clamp";
};

struct TransformOp {
  std::string key;
  StyleValueRef value;
};

struct StyleMapper {
  int mapperId = 0;
  int nodeId = 0;
  bool hasOpacity = false;
  StyleValueRef opacity;
  bool hasWidth = false;
  StyleValueRef width;
  bool hasHeight = false;
  StyleValueRef height;
  bool hasMinWidth = false;
  StyleValueRef minWidth;
  bool hasMinHeight = false;
  StyleValueRef minHeight;
  bool hasMaxWidth = false;
  StyleValueRef maxWidth;
  bool hasMaxHeight = false;
  StyleValueRef maxHeight;
  bool hasFlexBasis = false;
  StyleValueRef flexBasis;
  std::vector<TransformOp> transforms;
};

static bool isAngleKey(const std::string &key) {
  return key == "rotate" || key == "rotateZ" || key == "rotateX" ||
         key == "rotateY" || key == "skewX" || key == "skewY";
}

static double parseAngleString(const std::string &value) {
  if (value.size() >= 3 &&
      value.compare(value.size() - 3, 3, "deg") == 0) {
    const auto raw = value.substr(0, value.size() - 3);
    return std::stod(raw) * M_PI / 180.0;
  }
  if (value.size() >= 3 &&
      value.compare(value.size() - 3, 3, "rad") == 0) {
    const auto raw = value.substr(0, value.size() - 3);
    return std::stod(raw);
  }
  return std::stod(value);
}
} // namespace

@interface ZynthAnimateJSI : NSObject {
 @public
  std::atomic<int> _nextStyleMapperId;
  std::unordered_map<int, SharedAnimation> _sharedAnimations;
  std::mutex _sharedAnimationsMutex;
  std::vector<SharedAnimationCompletion> _sharedAnimationCompletions;
  std::mutex _sharedAnimationCompletionsMutex;
  std::unordered_map<int, StyleMapper> _styleMappers;
  std::mutex _styleMappersMutex;
  void *_hostKey;
}
@property (nonatomic, weak) ZynthHermesRuntimeHost *host;
@property (nonatomic, strong) CADisplayLink *displayLink;
@property (nonatomic, assign) BOOL needsStyleUpdate;

- (instancetype)initWithHost:(ZynthHermesRuntimeHost *)host;
- (void)markNeedsStyleUpdate;
- (void)ensureDisplayLink;
- (void)stopDisplayLinkIfNeeded;
- (double)sharedSignalValueForId:(int)signalId;
- (void)setSharedSignalValue:(int)signalId value:(double)value;
- (void)pushSharedAnimationCompletion:(int)callbackId finished:(BOOL)finished;
- (StyleMapper)buildStyleMapper:(Runtime &)rt value:(const Value &)value nodeId:(int)nodeId;

@end

static void ZynthInstallAnimateBridge(ZynthHermesRuntimeHost *host, Runtime &rt);

@implementation ZynthAnimateJSI

+ (void)load {
  ZynthRegisterJSIPluginInstaller(ZynthInstallAnimateBridge);
}

static std::mutex gInstanceMutex;
static std::unordered_map<void *, __weak ZynthAnimateJSI *> gInstances;

static void onSharedSignalChanged(void *state, int signalId) {
  static NSInteger changeCount = 0;
  if (changeCount++ % 30 == 0) {
    NSLog(@"[ZynthAnimate] Shared signal %d changed, updating host %p", signalId, state);
  }
  ZynthAnimateJSI *instance = nil;
  {
    std::lock_guard<std::mutex> lock(gInstanceMutex);
    auto it = gInstances.find(state);
    if (it != gInstances.end()) {
      instance = it->second;
      if (!instance) {
        gInstances.erase(it);
      }
    }
  }
  [instance markNeedsStyleUpdate];
}

- (instancetype)initWithHost:(ZynthHermesRuntimeHost *)host {
  self = [super init];
  if (self) {
    _host = host;
    _hostKey = (__bridge void *)host;
    _nextStyleMapperId = 1;
    _needsStyleUpdate = NO;
    
    NSLog(@"[ZynthAnimate] Registering instance for host %p", (__bridge void *)host);
    if (host) {
      // Keep the bridge alive for the host lifetime; callbacks only hold weak pointers.
      objc_setAssociatedObject(host, &kZynthAnimateHostAssociationKey, self, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
      std::lock_guard<std::mutex> lock(gInstanceMutex);
      gInstances[_hostKey] = self;
    }
    
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
      NSLog(@"[ZynthAnimate] Registering global shared signal changed callback");
      ZynthRegisterSharedSignalChangedCallback(onSharedSignalChanged);
    });
  }
  return self;
}

- (void)dealloc {
  if (_displayLink) {
    [_displayLink invalidate];
    _displayLink = nil;
  }
  if (_hostKey) {
    std::lock_guard<std::mutex> lock(gInstanceMutex);
    gInstances.erase(_hostKey);
  }
}

- (ZynthWorklets *)worklets {
  return _host ? [_host worklets] : nil;
}

- (ZynthUIManager *)uiManager {
  return _host ? [_host uiManager] : nil;
}

- (void)ensureDisplayLink {
  if (_displayLink) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_displayLink) return;
    self->_displayLink = [CADisplayLink displayLinkWithTarget:self selector:@selector(step:)];
    [self->_displayLink addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
  });
}

- (void)stopDisplayLinkIfNeeded {
  if (!_displayLink) return;
  if (_sharedAnimations.empty()) {
    [_displayLink invalidate];
    _displayLink = nil;
  }
}

- (double)sharedSignalValueForId:(int)signalId {
  ZynthWorklets *worklets = [self worklets];
  if (!worklets) {
    return std::numeric_limits<double>::quiet_NaN();
  }
  return [worklets sharedSignalValueForId:signalId];
}

- (void)setSharedSignalValue:(int)signalId value:(double)value {
  ZynthWorklets *worklets = [self worklets];
  if (!worklets) return;
  if ([worklets setSharedSignalValue:signalId value:value]) {
    [self markNeedsStyleUpdate];
  }
}

- (void)pushSharedAnimationCompletion:(int)callbackId finished:(BOOL)finished {
  if (callbackId <= 0) return;
  std::lock_guard<std::mutex> lock(_sharedAnimationCompletionsMutex);
  SharedAnimationCompletion completion;
  completion.callbackId = callbackId;
  completion.finished = finished;
  _sharedAnimationCompletions.push_back(completion);
}

- (StyleValueRef)resolveStyleValue:(Runtime &)rt value:(const Value &)value {
  StyleValueRef ref;
  if (value.isNumber()) {
    ref.constant = value.asNumber();
    return ref;
  }
  if (value.isString()) {
    ref.stringValue = value.asString(rt).utf8(rt);
    return ref;
  }
  if (value.isObject()) {
    Object obj = value.asObject(rt);
    if (obj.hasProperty(rt, kZynthInterpolationKey)) {
      Value interpolationValue = obj.getProperty(rt, kZynthInterpolationKey);
      if (interpolationValue.isObject()) {
        Object interpolationObj = interpolationValue.asObject(rt);
        if (interpolationObj.hasProperty(rt, "source") &&
            interpolationObj.hasProperty(rt, "inputRange") &&
            interpolationObj.hasProperty(rt, "outputRange")) {
          int sourceId = 0;
          Value sourceValue = interpolationObj.getProperty(rt, "source");
          if (sourceValue.isNumber()) {
            sourceId = static_cast<int>(sourceValue.asNumber());
          } else if (sourceValue.isObject()) {
            Object sourceObj = sourceValue.asObject(rt);
            if (sourceObj.hasProperty(rt, kZynthSharedValueKey)) {
              Value sourceIdValue = sourceObj.getProperty(rt, kZynthSharedValueKey);
              if (sourceIdValue.isNumber()) {
                sourceId = static_cast<int>(sourceIdValue.asNumber());
              }
            }
          }

          Value inputRangeValue = interpolationObj.getProperty(rt, "inputRange");
          Value outputRangeValue = interpolationObj.getProperty(rt, "outputRange");
          if (sourceId > 0 && inputRangeValue.isObject() && outputRangeValue.isObject()) {
            Object inputObj = inputRangeValue.asObject(rt);
            Object outputObj = outputRangeValue.asObject(rt);
            if (inputObj.isArray(rt) && outputObj.isArray(rt)) {
              Array inputArray = inputObj.asArray(rt);
              Array outputArray = outputObj.asArray(rt);
              size_t count = inputArray.size(rt);
              if (count >= 2 && outputArray.size(rt) == count) {
                bool valid = true;
                ref.inputRange.clear();
                ref.outputRange.clear();
                ref.inputRange.reserve(count);
                ref.outputRange.reserve(count);
                for (size_t i = 0; i < count; i++) {
                  Value inputEntry = inputArray.getValueAtIndex(rt, i);
                  Value outputEntry = outputArray.getValueAtIndex(rt, i);
                  if (!inputEntry.isNumber() || !outputEntry.isNumber()) {
                    valid = false;
                    break;
                  }
                  ref.inputRange.push_back(inputEntry.asNumber());
                  ref.outputRange.push_back(outputEntry.asNumber());
                }
                if (valid) {
                  ref.isInterpolation = true;
                  ref.sharedId = sourceId;
                  if (interpolationObj.hasProperty(rt, "extrapolateLeft")) {
                    Value left = interpolationObj.getProperty(rt, "extrapolateLeft");
                    if (left.isString()) {
                      ref.extrapolateLeft = left.asString(rt).utf8(rt);
                    }
                  }
                  if (interpolationObj.hasProperty(rt, "extrapolateRight")) {
                    Value right = interpolationObj.getProperty(rt, "extrapolateRight");
                    if (right.isString()) {
                      ref.extrapolateRight = right.asString(rt).utf8(rt);
                    }
                  }
                  return ref;
                }
              }
            }
          }
        }
      }
    }
    if (obj.hasProperty(rt, kZynthSharedValueKey)) {
      Value idValue = obj.getProperty(rt, kZynthSharedValueKey);
      if (idValue.isNumber()) {
        ref.isShared = true;
        ref.sharedId = static_cast<int>(idValue.asNumber());
      }
    }
  }
  return ref;
}

- (double)interpolateStyleValue:(const StyleValueRef &)ref source:(double)source fallback:(double)fallback {
  if (ref.inputRange.size() < 2 || ref.inputRange.size() != ref.outputRange.size()) {
    return fallback;
  }

  size_t i = 1;
  for (; i < ref.inputRange.size() - 1; i++) {
    if (source < ref.inputRange[i]) break;
  }

  double inputMin = ref.inputRange[i - 1];
  double inputMax = ref.inputRange[i];
  double outputMin = ref.outputRange[i - 1];
  double outputMax = ref.outputRange[i];

  if (source < inputMin) {
    if (ref.extrapolateLeft == "identity") return source;
    if (ref.extrapolateLeft == "clamp") return outputMin;
  }

  if (source > inputMax) {
    if (ref.extrapolateRight == "identity") return source;
    if (ref.extrapolateRight == "clamp") return outputMax;
  }

  double span = inputMax - inputMin;
  if (fabs(span) <= 0.000001) {
    return outputMax;
  }
  double progress = (source - inputMin) / span;
  return outputMin + progress * (outputMax - outputMin);
}

- (void)markNeedsStyleUpdate {
  if (_needsStyleUpdate) return;
  _needsStyleUpdate = YES;
  dispatch_async(dispatch_get_main_queue(), ^{
    [self applyStyleMappers];
  });
}

- (void)applyStyleMappers {
  _needsStyleUpdate = NO;
  ZynthUIManager *manager = [self uiManager];
  if (!manager) return;

  std::vector<StyleMapper> mappers;
  {
    std::lock_guard<std::mutex> lock(_styleMappersMutex);
    for (const auto &entry : _styleMappers) {
      mappers.push_back(entry.second);
    }
  }

  for (const auto &mapper : mappers) {
    UIView *view = [manager viewForNodeId:@(mapper.nodeId)];
    if (!view) continue;
    auto resolveValue = [&](const StyleValueRef &ref, double fallback) -> double {
      double resolved = ref.constant;
      if (ref.isInterpolation) {
        double source = [self sharedSignalValueForId:ref.sharedId];
        if (std::isnan(source)) return fallback;
        resolved = [self interpolateStyleValue:ref source:source fallback:fallback];
      } else if (ref.isShared) {
        resolved = [self sharedSignalValueForId:ref.sharedId];
      }
      if (std::isnan(resolved)) {
        return fallback;
      }
      return resolved;
    };
    auto applyLayout = [&](const char *name, bool hasValue, const StyleValueRef &ref) {
      if (!hasValue) return;
      double value = resolveValue(ref, std::numeric_limits<double>::quiet_NaN());
      if (std::isnan(value)) return;
      
      if (strcmp(name, "height") == 0) {
        static NSInteger heightLogCount = 0;
        if (heightLogCount++ % 30 == 0) {
          NSLog(@"[ZynthAnimate] Applying height %.2f to node %d", value, mapper.nodeId);
        }
      }
      
      CGFloat scale = UIScreen.mainScreen.scale > 0 ? UIScreen.mainScreen.scale : 1.0;
      double snapped = std::round(value * scale) / scale;
      NSString *propName = [NSString stringWithUTF8String:name];
      [manager setProp:@(mapper.nodeId) name:propName valueAny:@(snapped)];
    };
    applyLayout("width", mapper.hasWidth, mapper.width);
    applyLayout("height", mapper.hasHeight, mapper.height);
    applyLayout("minWidth", mapper.hasMinWidth, mapper.minWidth);
    applyLayout("minHeight", mapper.hasMinHeight, mapper.minHeight);
    applyLayout("maxWidth", mapper.hasMaxWidth, mapper.maxWidth);
    applyLayout("maxHeight", mapper.hasMaxHeight, mapper.maxHeight);
    applyLayout("flexBasis", mapper.hasFlexBasis, mapper.flexBasis);
    if (mapper.hasOpacity) {
      double opacity = resolveValue(mapper.opacity, 0.0);
      view.alpha = (CGFloat)opacity;
    }

    CGFloat translateX = 0.0;
    CGFloat translateY = 0.0;
    CGFloat scaleX = 1.0;
    CGFloat scaleY = 1.0;
    CGFloat rotate = 0.0;
    CGFloat rotateX = 0.0;
    CGFloat rotateY = 0.0;
    CGFloat skewX = 0.0;
    CGFloat skewY = 0.0;
    CGFloat perspective = 0.0;

    for (const auto &op : mapper.transforms) {
      const auto &key = op.key;
      double raw = op.value.isShared
        ? [self sharedSignalValueForId:op.value.sharedId]
        : (op.value.stringValue.empty() ? op.value.constant : parseAngleString(op.value.stringValue));
      if (std::isnan(raw)) {
        raw = 0.0;
      }
      if (isAngleKey(key) && op.value.stringValue.empty()) {
        raw = raw * M_PI / 180.0;
      }
      if (key == "translateX") {
        translateX = (CGFloat)raw;
      } else if (key == "translateY") {
        translateY = (CGFloat)raw;
      } else if (key == "scale") {
        scaleX *= (CGFloat)raw;
        scaleY *= (CGFloat)raw;
      } else if (key == "scaleX") {
        scaleX *= (CGFloat)raw;
      } else if (key == "scaleY") {
        scaleY *= (CGFloat)raw;
      } else if (key == "rotate" || key == "rotateZ") {
        rotate = (CGFloat)raw;
      } else if (key == "rotateX") {
        rotateX = (CGFloat)raw;
      } else if (key == "rotateY") {
        rotateY = (CGFloat)raw;
      } else if (key == "skewX") {
        skewX = (CGFloat)raw;
      } else if (key == "skewY") {
        skewY = (CGFloat)raw;
      } else if (key == "perspective") {
        perspective = (CGFloat)raw;
      }
    }

    CATransform3D transform = CATransform3DIdentity;
    if (perspective != 0) {
      transform.m34 = -1.0 / perspective;
    } else if (rotateX != 0 || rotateY != 0) {
      transform.m34 = -1.0 / 500.0;
    }
    transform = CATransform3DTranslate(transform, translateX, translateY, 0);
    if (rotate != 0) {
      transform = CATransform3DRotate(transform, rotate, 0, 0, 1);
    }
    if (rotateX != 0 || rotateY != 0) {
      CATransform3D rx = CATransform3DMakeRotation(-rotateX, 1, 0, 0);
      CATransform3D ry = CATransform3DMakeRotation(-rotateY, 0, 1, 0);
      transform = CATransform3DConcat(transform, CATransform3DConcat(ry, rx));
    }
    if (skewX != 0 || skewY != 0) {
      CATransform3D skew = CATransform3DIdentity;
      skew.m21 = tan(skewX);
      skew.m12 = tan(skewY);
      transform = CATransform3DConcat(transform, skew);
    }
    transform = CATransform3DScale(transform, scaleX, scaleY, 1);
    view.layer.transform = transform;
  }
}

- (void)step:(CADisplayLink *)link {
  CFTimeInterval now = link.timestamp;
  std::vector<int> finished;
  {
    std::lock_guard<std::mutex> lock(_sharedAnimationsMutex);
    for (auto &entry : _sharedAnimations) {
      SharedAnimation &anim = entry.second;
      double time = now * 1000.0;
      if (time < anim.startTime + anim.delay) {
        continue;
      }
      double elapsed = time - (anim.startTime + anim.delay);
      if (anim.kind == SharedAnimation::Kind::Timing) {
        double duration = anim.duration <= 0 ? 1 : anim.duration;
        double progress = std::min(elapsed / duration, 1.0);
        double nextValue = anim.fromValue + (anim.toValue - anim.fromValue) * progress;
        [self setSharedSignalValue:anim.signalId value:nextValue];
        if (progress >= 1.0) {
          finished.push_back(anim.signalId);
        }
      } else {
        if (anim.lastTime == 0.0) {
          anim.lastTime = time;
          continue;
        }
        double deltaMs = std::min(time - anim.lastTime, 64.0);
        anim.lastTime = time;
        double delta = deltaMs / 1000.0;
        double displacement = anim.fromValue - anim.toValue;
        double springForce = -anim.stiffness * displacement;
        double dampingForce = -anim.damping * anim.velocity;
        double acceleration = (springForce + dampingForce) / anim.mass;
        anim.velocity += acceleration * delta;
        anim.fromValue += anim.velocity * delta;
        if (anim.overshootClamping && anim.direction != 0) {
          if (anim.direction > 0 && anim.fromValue > anim.toValue) {
            anim.fromValue = anim.toValue;
            anim.velocity = 0;
          } else if (anim.direction < 0 && anim.fromValue < anim.toValue) {
            anim.fromValue = anim.toValue;
            anim.velocity = 0;
          }
        }
        [self setSharedSignalValue:anim.signalId value:anim.fromValue];
        if (fabs(anim.velocity) <= anim.restSpeed &&
            fabs(anim.fromValue - anim.toValue) <= anim.restDisplacement) {
          [self setSharedSignalValue:anim.signalId value:anim.toValue];
          finished.push_back(anim.signalId);
        }
      }
    }
    for (int id : finished) {
      auto it = _sharedAnimations.find(id);
      if (it != _sharedAnimations.end()) {
        if (it->second.callbackId > 0) {
          [self pushSharedAnimationCompletion:it->second.callbackId finished:YES];
        }
        _sharedAnimations.erase(it);
      }
    }
  }
  [self applyStyleMappers];
  [self stopDisplayLinkIfNeeded];
}

- (StyleMapper)buildStyleMapper:(Runtime &)rt value:(const Value &)value nodeId:(int)nodeId {
  StyleMapper mapper;
  mapper.nodeId = nodeId;
  if (!value.isObject()) {
    return mapper;
  }
  Object obj = value.asObject(rt);

  if (obj.hasProperty(rt, "opacity")) {
    Value opacityValue = obj.getProperty(rt, "opacity");
    mapper.hasOpacity = true;
    mapper.opacity = [self resolveStyleValue:rt value:opacityValue];
  }
  if (obj.hasProperty(rt, "width")) {
    mapper.hasWidth = true;
    mapper.width = [self resolveStyleValue:rt value:obj.getProperty(rt, "width")];
  }
  if (obj.hasProperty(rt, "height")) {
    mapper.hasHeight = true;
    mapper.height = [self resolveStyleValue:rt value:obj.getProperty(rt, "height")];
  }
  if (obj.hasProperty(rt, "minWidth")) {
    mapper.hasMinWidth = true;
    mapper.minWidth = [self resolveStyleValue:rt value:obj.getProperty(rt, "minWidth")];
  }
  if (obj.hasProperty(rt, "minHeight")) {
    mapper.hasMinHeight = true;
    mapper.minHeight = [self resolveStyleValue:rt value:obj.getProperty(rt, "minHeight")];
  }
  if (obj.hasProperty(rt, "maxWidth")) {
    mapper.hasMaxWidth = true;
    mapper.maxWidth = [self resolveStyleValue:rt value:obj.getProperty(rt, "maxWidth")];
  }
  if (obj.hasProperty(rt, "maxHeight")) {
    mapper.hasMaxHeight = true;
    mapper.maxHeight = [self resolveStyleValue:rt value:obj.getProperty(rt, "maxHeight")];
  }
  if (obj.hasProperty(rt, "flexBasis")) {
    mapper.hasFlexBasis = true;
    mapper.flexBasis = [self resolveStyleValue:rt value:obj.getProperty(rt, "flexBasis")];
  }

  if (obj.hasProperty(rt, "transform")) {
    Value transformValue = obj.getProperty(rt, "transform");
    if (transformValue.isObject()) {
      Object transformObj = transformValue.asObject(rt);
      if (transformObj.isArray(rt)) {
        Array transformArray = transformObj.asArray(rt);
        size_t count = transformArray.size(rt);
        for (size_t i = 0; i < count; i++) {
          Value entryValue = transformArray.getValueAtIndex(rt, i);
          if (!entryValue.isObject()) continue;
          Object entryObj = entryValue.asObject(rt);
          Array keys = entryObj.getPropertyNames(rt);
          size_t keyCount = keys.size(rt);
          for (size_t k = 0; k < keyCount; k++) {
            Value keyValue = keys.getValueAtIndex(rt, k);
            if (!keyValue.isString()) continue;
            std::string key = keyValue.asString(rt).utf8(rt);
            Value rawValue = entryObj.getProperty(rt, key.c_str());
            TransformOp op;
            op.key = key;
            op.value = [self resolveStyleValue:rt value:rawValue];
            mapper.transforms.push_back(op);
          }
        }
      }
    }
  }

  return mapper;
}

@end

static void ZynthInstallAnimateBridge(ZynthHermesRuntimeHost *host, Runtime &rt) {
  if (!host) return;
  NSLog(@"[ZynthAnimate] Installing JSI bridge for host %p", (__bridge void *)host);
  auto *animate = [[ZynthAnimateJSI alloc] initWithHost:host];
  __weak ZynthAnimateJSI *weakAnimate = animate;

  auto createSharedValue = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "createSharedValue"), 1,
      [weakAnimate](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        ZynthAnimateJSI *strongAnimate = weakAnimate;
        if (!strongAnimate || count < 1 || !args[0].isNumber()) {
          return Value::undefined();
        }
        ZynthWorklets *worklets = [strongAnimate worklets];
        if (!worklets) {
          return Value::undefined();
        }
        double initialValue = args[0].asNumber();
        int signalId = [worklets createSharedSignalWithValue:initialValue];
        return Value(static_cast<double>(signalId));
      });

  auto getSharedValue = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "getSharedValue"), 1,
      [weakAnimate](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        ZynthAnimateJSI *strongAnimate = weakAnimate;
        if (!strongAnimate || count < 1 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int signalId = static_cast<int>(args[0].asNumber());
        double value = [strongAnimate sharedSignalValueForId:signalId];
        if (std::isnan(value)) {
          return Value::undefined();
        }
        return Value(value);
      });

  auto setSharedValue = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setSharedValue"), 2,
      [weakAnimate](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        ZynthAnimateJSI *strongAnimate = weakAnimate;
        if (!strongAnimate || count < 2 || !args[0].isNumber() || !args[1].isNumber()) {
          return Value::undefined();
        }
        int signalId = static_cast<int>(args[0].asNumber());
        double value = args[1].asNumber();
        [strongAnimate setSharedSignalValue:signalId value:value];
        return Value::undefined();
      });

  auto animateSharedValue = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "animateSharedValue"), 2,
      [weakAnimate](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        ZynthAnimateJSI *strongAnimate = weakAnimate;
        if (!strongAnimate || count < 2 || !args[0].isNumber() || !args[1].isObject()) {
          return Value::undefined();
        }
        int signalId = static_cast<int>(args[0].asNumber());
        Object config = args[1].asObject(rt);
        if (!config.hasProperty(rt, "type")) {
          return Value::undefined();
        }
        std::string type = config.getProperty(rt, "type").asString(rt).utf8(rt);
        double toValue = config.getProperty(rt, "toValue").asNumber();
        double startTime = CACurrentMediaTime() * 1000.0;
        SharedAnimation anim;
        anim.signalId = signalId;
        anim.fromValue = [strongAnimate sharedSignalValueForId:signalId];
        anim.toValue = toValue;
        anim.startTime = startTime;
        anim.delay = config.hasProperty(rt, "delay")
                         ? config.getProperty(rt, "delay").asNumber()
                         : 0.0;
        anim.callbackId = config.hasProperty(rt, "callbackId")
                              ? static_cast<int>(config.getProperty(rt, "callbackId").asNumber())
                              : 0;
        anim.direction = anim.toValue - anim.fromValue;
        if (type == "spring") {
          anim.kind = SharedAnimation::Kind::Spring;
          anim.damping = config.hasProperty(rt, "damping")
                            ? config.getProperty(rt, "damping").asNumber()
                            : 20.0;
          anim.stiffness = config.hasProperty(rt, "stiffness")
                              ? config.getProperty(rt, "stiffness").asNumber()
                              : 150.0;
          anim.mass = config.hasProperty(rt, "mass")
                          ? config.getProperty(rt, "mass").asNumber()
                          : 1.0;
          anim.velocity = config.hasProperty(rt, "velocity")
                              ? config.getProperty(rt, "velocity").asNumber()
                              : 0.0;
          anim.restSpeed = config.hasProperty(rt, "restSpeedThreshold")
                               ? config.getProperty(rt, "restSpeedThreshold").asNumber()
                               : 0.001;
          anim.restDisplacement = config.hasProperty(rt, "restDisplacementThreshold")
                                      ? config.getProperty(rt, "restDisplacementThreshold").asNumber()
                                      : 0.001;
          anim.overshootClamping = config.hasProperty(rt, "overshootClamping") &&
                                   config.getProperty(rt, "overshootClamping").getBool();
        } else {
          anim.kind = SharedAnimation::Kind::Timing;
          anim.duration = config.hasProperty(rt, "duration")
                              ? config.getProperty(rt, "duration").asNumber()
                              : 300.0;
        }
        {
          std::lock_guard<std::mutex> lock(strongAnimate->_sharedAnimationsMutex);
          auto existing = strongAnimate->_sharedAnimations.find(signalId);
          if (existing != strongAnimate->_sharedAnimations.end() &&
              existing->second.callbackId > 0) {
            [strongAnimate pushSharedAnimationCompletion:existing->second.callbackId finished:NO];
          }
          strongAnimate->_sharedAnimations[signalId] = anim;
        }
        [strongAnimate ensureDisplayLink];
        return Value::undefined();
      });

  auto cancelSharedValue = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "cancelSharedValue"), 1,
      [weakAnimate](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        ZynthAnimateJSI *strongAnimate = weakAnimate;
        if (!strongAnimate || count < 1 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int signalId = static_cast<int>(args[0].asNumber());
        {
          std::lock_guard<std::mutex> lock(strongAnimate->_sharedAnimationsMutex);
          auto existing = strongAnimate->_sharedAnimations.find(signalId);
          if (existing != strongAnimate->_sharedAnimations.end()) {
            if (existing->second.callbackId > 0) {
              [strongAnimate pushSharedAnimationCompletion:existing->second.callbackId finished:NO];
            }
            strongAnimate->_sharedAnimations.erase(existing);
          }
        }
        [strongAnimate stopDisplayLinkIfNeeded];
        return Value::undefined();
      });

  auto consumeAnimationCompletions = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "consumeAnimationCompletions"), 0,
      [weakAnimate](Runtime &rt, const Value &, const Value *, size_t) -> Value {
        ZynthAnimateJSI *strongAnimate = weakAnimate;
        if (!strongAnimate) {
          return Array(rt, 0);
        }
        std::vector<SharedAnimationCompletion> completions;
        {
          std::lock_guard<std::mutex> lock(strongAnimate->_sharedAnimationCompletionsMutex);
          completions.swap(strongAnimate->_sharedAnimationCompletions);
        }
        Array result(rt, completions.size());
        for (size_t index = 0; index < completions.size(); index++) {
          const auto &completion = completions[index];
          Object entry(rt);
          entry.setProperty(rt, "callbackId", Value(static_cast<double>(completion.callbackId)));
          entry.setProperty(rt, "finished", Value(completion.finished));
          result.setValueAtIndex(rt, index, entry);
        }
        return result;
      });

  auto createStyleMapper = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "createStyleMapper"), 2,
      [weakAnimate](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        ZynthAnimateJSI *strongAnimate = weakAnimate;
        if (!strongAnimate || count < 2 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int nodeId = static_cast<int>(args[0].asNumber());
        StyleMapper mapper = [strongAnimate buildStyleMapper:rt value:args[1] nodeId:nodeId];
        int mapperId = strongAnimate->_nextStyleMapperId.fetch_add(1);
        mapper.mapperId = mapperId;
        {
          std::lock_guard<std::mutex> lock(strongAnimate->_styleMappersMutex);
          strongAnimate->_styleMappers[mapperId] = mapper;
        }
        [strongAnimate markNeedsStyleUpdate];
        return Value(static_cast<double>(mapperId));
      });

  auto updateStyleMapper = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "updateStyleMapper"), 2,
      [weakAnimate](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        ZynthAnimateJSI *strongAnimate = weakAnimate;
        if (!strongAnimate || count < 2 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int mapperId = static_cast<int>(args[0].asNumber());
        StyleMapper mapper;
        {
          std::lock_guard<std::mutex> lock(strongAnimate->_styleMappersMutex);
          auto it = strongAnimate->_styleMappers.find(mapperId);
          if (it == strongAnimate->_styleMappers.end()) {
            return Value::undefined();
          }
          mapper = [strongAnimate buildStyleMapper:rt value:args[1] nodeId:it->second.nodeId];
          mapper.mapperId = mapperId;
          strongAnimate->_styleMappers[mapperId] = mapper;
        }
        [strongAnimate markNeedsStyleUpdate];
        return Value::undefined();
      });

  auto removeStyleMapper = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "removeStyleMapper"), 1,
      [weakAnimate](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        ZynthAnimateJSI *strongAnimate = weakAnimate;
        if (!strongAnimate || count < 1 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int mapperId = static_cast<int>(args[0].asNumber());
        {
          std::lock_guard<std::mutex> lock(strongAnimate->_styleMappersMutex);
          strongAnimate->_styleMappers.erase(mapperId);
        }
        return Value::undefined();
      });

  Object animateJSIObj(rt);
  animateJSIObj.setProperty(rt, "createSharedValue", createSharedValue);
  animateJSIObj.setProperty(rt, "getSharedValue", getSharedValue);
  animateJSIObj.setProperty(rt, "setSharedValue", setSharedValue);
  animateJSIObj.setProperty(rt, "animateSharedValue", animateSharedValue);
  animateJSIObj.setProperty(rt, "cancelSharedValue", cancelSharedValue);
  animateJSIObj.setProperty(rt, "consumeAnimationCompletions", consumeAnimationCompletions);
  animateJSIObj.setProperty(rt, "createStyleMapper", createStyleMapper);
  animateJSIObj.setProperty(rt, "updateStyleMapper", updateStyleMapper);
  animateJSIObj.setProperty(rt, "removeStyleMapper", removeStyleMapper);
  rt.global().setProperty(rt, kZynthAnimateKey, animateJSIObj);
  NSLog(@"[ZynthAnimate] animate bridge installed");
}
