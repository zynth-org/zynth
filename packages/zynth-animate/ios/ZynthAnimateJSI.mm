#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

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
};

struct StyleValueRef {
  bool isShared = false;
  int sharedId = 0;
  double constant = 0.0;
  std::string stringValue;
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

@interface ZynthAnimateJSI : NSObject
@property (nonatomic, weak) ZynthHermesRuntimeHost *host;
@property (nonatomic, strong) CADisplayLink *displayLink;
@property (nonatomic, assign) BOOL needsStyleUpdate;
@end

@implementation ZynthAnimateJSI {
  std::atomic<int> _nextStyleMapperId;
  std::unordered_map<int, SharedAnimation> _sharedAnimations;
  std::mutex _sharedAnimationsMutex;
  std::unordered_map<int, StyleMapper> _styleMappers;
  std::mutex _styleMappersMutex;
}

- (instancetype)initWithHost:(ZynthHermesRuntimeHost *)host {
  self = [super init];
  if (self) {
    _host = host;
    _nextStyleMapperId = 1;
    _needsStyleUpdate = NO;
  }
  return self;
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
    if (mapper.hasOpacity) {
      double opacity = mapper.opacity.isShared
        ? [self sharedSignalValueForId:mapper.opacity.sharedId]
        : mapper.opacity.constant;
      if (std::isnan(opacity)) {
        opacity = 0.0;
      }
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
      _sharedAnimations.erase(id);
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
  auto *animate = [[ZynthAnimateJSI alloc] initWithHost:host];
  __weak ZynthAnimateJSI *weakAnimate = animate;

  auto createSharedValue = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "createSharedValue"), 1,
      [weakAnimate](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        ZynthAnimateJSI *strong = weakAnimate;
        if (!strong || count < 1 || !args[0].isNumber()) {
          return Value::undefined();
        }
        ZynthWorklets *worklets = [strong worklets];
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
        ZynthAnimateJSI *strong = weakAnimate;
        if (!strong || count < 1 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int signalId = static_cast<int>(args[0].asNumber());
        double value = [strong sharedSignalValueForId:signalId];
        if (std::isnan(value)) {
          return Value::undefined();
        }
        return Value(value);
      });

  auto setSharedValue = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setSharedValue"), 2,
      [weakAnimate](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        ZynthAnimateJSI *strong = weakAnimate;
        if (!strong || count < 2 || !args[0].isNumber() || !args[1].isNumber()) {
          return Value::undefined();
        }
        int signalId = static_cast<int>(args[0].asNumber());
        double value = args[1].asNumber();
        [strong setSharedSignalValue:signalId value:value];
        return Value::undefined();
      });

  auto animateSharedValue = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "animateSharedValue"), 2,
      [weakAnimate](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        ZynthAnimateJSI *strong = weakAnimate;
        if (!strong || count < 2 || !args[0].isNumber() || !args[1].isObject()) {
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
        anim.fromValue = [strong sharedSignalValueForId:signalId];
        anim.toValue = toValue;
        anim.startTime = startTime;
        anim.delay = config.hasProperty(rt, "delay")
                         ? config.getProperty(rt, "delay").asNumber()
                         : 0.0;
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
          std::lock_guard<std::mutex> lock(strong->_sharedAnimationsMutex);
          strong->_sharedAnimations[signalId] = anim;
        }
        [strong ensureDisplayLink];
        return Value::undefined();
      });

  auto cancelSharedValue = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "cancelSharedValue"), 1,
      [weakAnimate](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        ZynthAnimateJSI *strong = weakAnimate;
        if (!strong || count < 1 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int signalId = static_cast<int>(args[0].asNumber());
        {
          std::lock_guard<std::mutex> lock(strong->_sharedAnimationsMutex);
          strong->_sharedAnimations.erase(signalId);
        }
        [strong stopDisplayLinkIfNeeded];
        return Value::undefined();
      });

  auto createStyleMapper = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "createStyleMapper"), 2,
      [weakAnimate](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        ZynthAnimateJSI *strong = weakAnimate;
        if (!strong || count < 2 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int nodeId = static_cast<int>(args[0].asNumber());
        StyleMapper mapper = [strong buildStyleMapper:rt value:args[1] nodeId:nodeId];
        int mapperId = strong->_nextStyleMapperId.fetch_add(1);
        mapper.mapperId = mapperId;
        {
          std::lock_guard<std::mutex> lock(strong->_styleMappersMutex);
          strong->_styleMappers[mapperId] = mapper;
        }
        [strong markNeedsStyleUpdate];
        return Value(static_cast<double>(mapperId));
      });

  auto updateStyleMapper = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "updateStyleMapper"), 2,
      [weakAnimate](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        ZynthAnimateJSI *strong = weakAnimate;
        if (!strong || count < 2 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int mapperId = static_cast<int>(args[0].asNumber());
        StyleMapper mapper;
        {
          std::lock_guard<std::mutex> lock(strong->_styleMappersMutex);
          auto it = strong->_styleMappers.find(mapperId);
          if (it == strong->_styleMappers.end()) {
            return Value::undefined();
          }
          mapper = [strong buildStyleMapper:rt value:args[1] nodeId:it->second.nodeId];
          mapper.mapperId = mapperId;
          strong->_styleMappers[mapperId] = mapper;
        }
        [strong markNeedsStyleUpdate];
        return Value::undefined();
      });

  auto removeStyleMapper = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "removeStyleMapper"), 1,
      [weakAnimate](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        ZynthAnimateJSI *strong = weakAnimate;
        if (!strong || count < 1 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int mapperId = static_cast<int>(args[0].asNumber());
        {
          std::lock_guard<std::mutex> lock(strong->_styleMappersMutex);
          strong->_styleMappers.erase(mapperId);
        }
        return Value::undefined();
      });

  Object animate(rt);
  animate.setProperty(rt, "createSharedValue", createSharedValue);
  animate.setProperty(rt, "getSharedValue", getSharedValue);
  animate.setProperty(rt, "setSharedValue", setSharedValue);
  animate.setProperty(rt, "animateSharedValue", animateSharedValue);
  animate.setProperty(rt, "cancelSharedValue", cancelSharedValue);
  animate.setProperty(rt, "createStyleMapper", createStyleMapper);
  animate.setProperty(rt, "updateStyleMapper", updateStyleMapper);
  animate.setProperty(rt, "removeStyleMapper", removeStyleMapper);
  rt.global().setProperty(rt, kZynthAnimateKey, animate);
  NSLog(@"[ZynthAnimate] animate bridge installed");
}

__attribute__((constructor)) static void ZynthRegisterAnimatePlugin(void) {
  ZynthRegisterJSIPluginInstaller(ZynthInstallAnimateBridge);
}
