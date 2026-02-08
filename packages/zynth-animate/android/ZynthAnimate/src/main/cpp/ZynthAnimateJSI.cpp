#include <jni.h>
#include <android/log.h>
#include <dlfcn.h>
#include <jsi/jsi.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <limits>
#include <mutex>
#include <string>
#include <time.h>
#include <unordered_map>
#include <vector>

#include "ZynthJSIPluginRegistry.h"

using namespace facebook::jsi;

namespace {
constexpr const char *kTag = "ZynthAnimate";
constexpr const char *kAnimateKey = "__zynth_animate";
constexpr const char *kSharedValueKey = "__zynth_shared_value";
constexpr const char *kInterpolationKey = "__zynth_interpolation";

JavaVM *gVm = nullptr;
jclass gFrameClockClass = nullptr;
jmethodID gRequestFrame = nullptr;
jmethodID gCancelFrame = nullptr;

using CreateSharedSignalFn = int (*)(void *, double);
using GetSharedSignalFn = double (*)(void *, int, bool *);
using SetSharedSignalFn = bool (*)(void *, int, double);
using ApplyAnimatedStyleFn =
    void (*)(void *, int, float, float, float, float, float, float, float, float, float, float, float);
using ApplyAnimatedLayoutStyleFn =
    void (*)(void *, int, float, float, float, float, float, float, float);

CreateSharedSignalFn gCreateSharedSignal = nullptr;
GetSharedSignalFn gGetSharedSignal = nullptr;
SetSharedSignalFn gSetSharedSignal = nullptr;
ApplyAnimatedStyleFn gApplyAnimatedStyle = nullptr;
ApplyAnimatedLayoutStyleFn gApplyAnimatedLayoutStyle = nullptr;

using RegisterInstallerFn = void (*)(ZynthJSIPluginInstaller);
using RegisterSharedSignalCallbackFn = void (*)(ZynthSharedSignalChangedCallback);
RegisterInstallerFn gRegisterInstaller = nullptr;
RegisterSharedSignalCallbackFn gRegisterSharedSignalCallback = nullptr;

JNIEnv *getEnv() {
  if (!gVm) return nullptr;
  JNIEnv *env = nullptr;
  if (gVm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) != JNI_OK) {
    if (gVm->AttachCurrentThread(&env, nullptr) != JNI_OK) return nullptr;
  }
  return env;
}

void resolveCoreSymbols() {
  if (gRegisterInstaller) return;
  __android_log_print(ANDROID_LOG_DEBUG, kTag, "Resolving core symbols...");
  
  void *handle = dlopen("libzynthkit.so", RTLD_NOW | RTLD_GLOBAL);
  if (!handle) {
    __android_log_print(ANDROID_LOG_ERROR, kTag, "Failed to dlopen libzynthkit.so: %s", dlerror());
    // Fallback to default search just in case
    handle = RTLD_DEFAULT;
  }

  gRegisterInstaller = reinterpret_cast<RegisterInstallerFn>(
      dlsym(handle, "ZynthRegisterJSIPluginInstaller"));
  gRegisterSharedSignalCallback = reinterpret_cast<RegisterSharedSignalCallbackFn>(
      dlsym(handle, "ZynthRegisterSharedSignalChangedCallback"));
  
  if (gRegisterSharedSignalCallback) {
    __android_log_print(ANDROID_LOG_DEBUG, kTag, "Successfully resolved ZynthRegisterSharedSignalChangedCallback");
  } else {
    __android_log_print(ANDROID_LOG_ERROR, kTag, "FAILED to resolve ZynthRegisterSharedSignalChangedCallback: %s", dlerror());
  }

  gCreateSharedSignal = reinterpret_cast<CreateSharedSignalFn>(
      dlsym(handle, "ZynthCreateSharedSignal"));
  gGetSharedSignal = reinterpret_cast<GetSharedSignalFn>(
      dlsym(handle, "ZynthGetSharedSignal"));
  gSetSharedSignal = reinterpret_cast<SetSharedSignalFn>(
      dlsym(handle, "ZynthSetSharedSignal"));
  gApplyAnimatedStyle = reinterpret_cast<ApplyAnimatedStyleFn>(
      dlsym(handle, "ZynthApplyAnimatedStyle"));
  gApplyAnimatedLayoutStyle = reinterpret_cast<ApplyAnimatedLayoutStyleFn>(
      dlsym(handle, "ZynthApplyAnimatedLayoutStyle"));
}

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

struct MappedValue {
  bool hasValue = false;
  bool isShared = false;
  bool isInterpolation = false;
  int sharedId = 0;
  double numberValue = 0.0;
  std::vector<double> inputRange;
  std::vector<double> outputRange;
  std::string extrapolateLeft = "clamp";
  std::string extrapolateRight = "clamp";
};

struct StyleMapper {
  int id = 0;
  int nodeId = 0;
  MappedValue opacity;
  MappedValue translateX;
  MappedValue translateY;
  MappedValue scale;
  MappedValue scaleX;
  MappedValue scaleY;
  MappedValue rotate;
  MappedValue rotateX;
  MappedValue rotateY;
  MappedValue skewX;
  MappedValue skewY;
  MappedValue perspective;
  MappedValue width;
  MappedValue height;
  MappedValue minWidth;
  MappedValue minHeight;
  MappedValue maxWidth;
  MappedValue maxHeight;
  MappedValue flexBasis;
};

bool extractSharedValueId(Runtime &rt, const Value &value, int &outId) {
  if (!value.isObject()) return false;
  Object obj = value.getObject(rt);
  if (!obj.hasProperty(rt, kSharedValueKey)) return false;
  Value idVal = obj.getProperty(rt, kSharedValueKey);
  if (!idVal.isNumber()) return false;
  outId = static_cast<int>(idVal.asNumber());
  return true;
}

bool parseAngleString(const std::string &input, double &outDegrees) {
  if (input.size() >= 3 && input.compare(input.size() - 3, 3, "deg") == 0) {
    try {
      outDegrees = std::stod(input.substr(0, input.size() - 3));
      return true;
    } catch (...) {
      return false;
    }
  }
  if (input.size() >= 3 && input.compare(input.size() - 3, 3, "rad") == 0) {
    try {
      outDegrees = std::stod(input.substr(0, input.size() - 3)) * 180.0 / M_PI;
      return true;
    } catch (...) {
      return false;
    }
  }
  try {
    outDegrees = std::stod(input);
    return true;
  } catch (...) {
    return false;
  }
}

bool parseMappedValue(Runtime &rt, const Value &value, MappedValue &out, bool isAngle = false) {
  int sharedId = 0;
  if (extractSharedValueId(rt, value, sharedId)) {
    out.hasValue = true;
    out.isShared = true;
    out.sharedId = sharedId;
    return true;
  }
  if (value.isObject()) {
    Object obj = value.getObject(rt);
    if (obj.hasProperty(rt, kInterpolationKey)) {
      Value interpolationValue = obj.getProperty(rt, kInterpolationKey);
      if (!interpolationValue.isObject()) return false;
      Object interpolationObj = interpolationValue.getObject(rt);
      if (!interpolationObj.hasProperty(rt, "source") ||
          !interpolationObj.hasProperty(rt, "inputRange") ||
          !interpolationObj.hasProperty(rt, "outputRange")) {
        return false;
      }

      int sourceId = 0;
      Value sourceValue = interpolationObj.getProperty(rt, "source");
      if (sourceValue.isNumber()) {
        sourceId = static_cast<int>(sourceValue.asNumber());
      } else if (!extractSharedValueId(rt, sourceValue, sourceId)) {
        return false;
      }

      Value inputRangeValue = interpolationObj.getProperty(rt, "inputRange");
      Value outputRangeValue = interpolationObj.getProperty(rt, "outputRange");
      if (!inputRangeValue.isObject() || !outputRangeValue.isObject()) {
        return false;
      }
      Object inputObj = inputRangeValue.getObject(rt);
      Object outputObj = outputRangeValue.getObject(rt);
      if (!inputObj.isArray(rt) || !outputObj.isArray(rt)) {
        return false;
      }
      Array inputArray = inputObj.asArray(rt);
      Array outputArray = outputObj.asArray(rt);
      size_t count = inputArray.size(rt);
      if (count < 2 || outputArray.size(rt) != count) {
        return false;
      }

      out.hasValue = true;
      out.isInterpolation = true;
      out.isShared = false;
      out.sharedId = sourceId;
      out.inputRange.clear();
      out.outputRange.clear();
      out.inputRange.reserve(count);
      out.outputRange.reserve(count);

      for (size_t i = 0; i < count; i++) {
        Value inputEntry = inputArray.getValueAtIndex(rt, i);
        Value outputEntry = outputArray.getValueAtIndex(rt, i);
        if (!inputEntry.isNumber() || !outputEntry.isNumber()) {
          out.hasValue = false;
          return false;
        }
        out.inputRange.push_back(inputEntry.asNumber());
        out.outputRange.push_back(outputEntry.asNumber());
      }

      if (interpolationObj.hasProperty(rt, "extrapolateLeft")) {
        Value left = interpolationObj.getProperty(rt, "extrapolateLeft");
        if (left.isString()) {
          out.extrapolateLeft = left.getString(rt).utf8(rt);
        }
      }
      if (interpolationObj.hasProperty(rt, "extrapolateRight")) {
        Value right = interpolationObj.getProperty(rt, "extrapolateRight");
        if (right.isString()) {
          out.extrapolateRight = right.getString(rt).utf8(rt);
        }
      }
      return true;
    }
  }
  if (value.isNumber()) {
    out.hasValue = true;
    out.isShared = false;
    out.numberValue = value.asNumber();
    return true;
  }
  if (isAngle && value.isString()) {
    auto text = value.getString(rt).utf8(rt);
    double degrees = 0.0;
    if (parseAngleString(text, degrees)) {
      out.hasValue = true;
      out.isShared = false;
      out.numberValue = degrees;
      return true;
    }
  }
  return false;
}

double interpolateMappedValue(const MappedValue &value, double source, double fallback) {
  if (value.inputRange.size() < 2 || value.inputRange.size() != value.outputRange.size()) {
    return fallback;
  }

  size_t i = 1;
  for (; i < value.inputRange.size() - 1; i++) {
    if (source < value.inputRange[i]) break;
  }

  double inputMin = value.inputRange[i - 1];
  double inputMax = value.inputRange[i];
  double outputMin = value.outputRange[i - 1];
  double outputMax = value.outputRange[i];

  if (source < inputMin) {
    if (value.extrapolateLeft == "identity") return source;
    if (value.extrapolateLeft == "clamp") return outputMin;
  }

  if (source > inputMax) {
    if (value.extrapolateRight == "identity") return source;
    if (value.extrapolateRight == "clamp") return outputMax;
  }

  double inputSpan = inputMax - inputMin;
  if (std::abs(inputSpan) <= 0.000001) {
    return outputMax;
  }
  double progress = (source - inputMin) / inputSpan;
  return outputMin + progress * (outputMax - outputMin);
}

double resolveMappedValue(const MappedValue &value, void *state, double fallback) {
  if (!value.hasValue) return fallback;
  if (value.isInterpolation) {
    if (!gGetSharedSignal) return fallback;
    bool found = false;
    double source = gGetSharedSignal(state, value.sharedId, &found);
    if (!found || !std::isfinite(source)) return fallback;
    return interpolateMappedValue(value, source, fallback);
  }
  if (value.isShared) {
    if (!gGetSharedSignal) return fallback;
    bool found = false;
    double result = gGetSharedSignal(state, value.sharedId, &found);
    return found ? result : fallback;
  }
  return value.numberValue;
}

class ZynthAnimateRuntime {
 public:
  ZynthAnimateRuntime(Runtime &rt, void *state)
      : runtime(rt), state(state), nextStyleMapperId(1) {}

  void *getState() const { return state; }

  void install() {
    auto createSharedValue = Function::createFromHostFunction(
        runtime, PropNameID::forAscii(runtime, "createSharedValue"), 1,
        [this](Runtime &, const Value &, const Value *args, size_t count) -> Value {
          if (!gCreateSharedSignal || count < 1 || !args[0].isNumber()) {
            return Value::undefined();
          }
          int id = gCreateSharedSignal(state, args[0].asNumber());
          return Value(static_cast<double>(id));
        });

    auto getSharedValue = Function::createFromHostFunction(
        runtime, PropNameID::forAscii(runtime, "getSharedValue"), 1,
        [this](Runtime &, const Value &, const Value *args, size_t count) -> Value {
          if (!gGetSharedSignal || count < 1 || !args[0].isNumber()) {
            return Value::undefined();
          }
          int id = static_cast<int>(args[0].asNumber());
          bool found = false;
          double value = gGetSharedSignal(state, id, &found);
          return found ? Value(value) : Value::undefined();
        });

    auto setSharedValue = Function::createFromHostFunction(
        runtime, PropNameID::forAscii(runtime, "setSharedValue"), 2,
        [this](Runtime &, const Value &, const Value *args, size_t count) -> Value {
          if (!gSetSharedSignal || count < 2 || !args[0].isNumber() || !args[1].isNumber()) {
            return Value::undefined();
          }
          int id = static_cast<int>(args[0].asNumber());
          double value = args[1].asNumber();
          gSetSharedSignal(state, id, value);
          // Coalesce high-frequency shared value updates (e.g. scroll) to one
          // mapper application per frame to avoid stale main-thread layout writes.
          ensureFrame();
          return Value::undefined();
        });

    auto animateSharedValue = Function::createFromHostFunction(
        runtime, PropNameID::forAscii(runtime, "animateSharedValue"), 2,
        [this](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
          if (count < 2 || !args[0].isNumber() || !args[1].isObject()) {
            return Value::undefined();
          }
          int id = static_cast<int>(args[0].asNumber());
          Object config = args[1].asObject(rt);
          if (!config.hasProperty(rt, "type")) return Value::undefined();
          std::string type = config.getProperty(rt, "type").asString(rt).utf8(rt);
          if (!config.hasProperty(rt, "toValue")) return Value::undefined();
          double toValue = config.getProperty(rt, "toValue").asNumber();
          bool found = false;
          double current = gGetSharedSignal ? gGetSharedSignal(state, id, &found) : 0.0;

          SharedAnimation anim;
          anim.signalId = id;
          anim.fromValue = found ? current : 0.0;
          anim.toValue = toValue;
          anim.startTime = nowMs();
          anim.delay = config.hasProperty(rt, "delay") ? config.getProperty(rt, "delay").asNumber() : 0.0;
          anim.direction = anim.toValue - anim.fromValue;

          if (type == "spring") {
            anim.kind = SharedAnimation::Kind::Spring;
            anim.damping = config.hasProperty(rt, "damping") ? config.getProperty(rt, "damping").asNumber() : 20.0;
            anim.stiffness = config.hasProperty(rt, "stiffness") ? config.getProperty(rt, "stiffness").asNumber() : 150.0;
            anim.mass = config.hasProperty(rt, "mass") ? config.getProperty(rt, "mass").asNumber() : 1.0;
            anim.velocity = config.hasProperty(rt, "velocity") ? config.getProperty(rt, "velocity").asNumber() : 0.0;
            anim.restSpeed = config.hasProperty(rt, "restSpeedThreshold")
                                 ? config.getProperty(rt, "restSpeedThreshold").asNumber()
                                 : 0.001;
            anim.restDisplacement = config.hasProperty(rt, "restDisplacementThreshold")
                                        ? config.getProperty(rt, "restDisplacementThreshold").asNumber()
                                        : 0.001;
            anim.overshootClamping =
                config.hasProperty(rt, "overshootClamping") &&
                config.getProperty(rt, "overshootClamping").getBool();
          } else {
            anim.kind = SharedAnimation::Kind::Timing;
            anim.duration = config.hasProperty(rt, "duration") ? config.getProperty(rt, "duration").asNumber() : 300.0;
          }

          {
            std::lock_guard<std::mutex> lock(mutex);
            animations[id] = anim;
          }
          ensureFrame();
          return Value::undefined();
        });

    auto cancelSharedValue = Function::createFromHostFunction(
        runtime, PropNameID::forAscii(runtime, "cancelSharedValue"), 1,
        [this](Runtime &, const Value &, const Value *args, size_t count) -> Value {
          if (count < 1 || !args[0].isNumber()) return Value::undefined();
          int id = static_cast<int>(args[0].asNumber());
          {
            std::lock_guard<std::mutex> lock(mutex);
            animations.erase(id);
          }
          return Value::undefined();
        });

    auto createStyleMapper = Function::createFromHostFunction(
        runtime, PropNameID::forAscii(runtime, "createStyleMapper"), 2,
        [this](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
          if (count < 2 || !args[0].isNumber() || !args[1].isObject()) {
            return Value::undefined();
          }
          int nodeId = static_cast<int>(args[0].asNumber());
          StyleMapper mapper = buildStyleMapper(rt, args[1]);
          mapper.nodeId = nodeId;
          mapper.id = nextStyleMapperId.fetch_add(1);
          {
            std::lock_guard<std::mutex> lock(mutex);
            styleMappers[mapper.id] = mapper;
          }
          applyStyleMapper(mapper);
          return Value(static_cast<double>(mapper.id));
        });

    auto updateStyleMapper = Function::createFromHostFunction(
        runtime, PropNameID::forAscii(runtime, "updateStyleMapper"), 2,
        [this](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
          if (count < 2 || !args[0].isNumber() || !args[1].isObject()) {
            return Value::undefined();
          }
          int mapperId = static_cast<int>(args[0].asNumber());
          StyleMapper mapper;
          {
            std::lock_guard<std::mutex> lock(mutex);
            auto it = styleMappers.find(mapperId);
            if (it == styleMappers.end()) return Value::undefined();
            mapper = it->second;
          }
          StyleMapper updated = buildStyleMapper(rt, args[1]);
          updated.id = mapperId;
          updated.nodeId = mapper.nodeId;
          {
            std::lock_guard<std::mutex> lock(mutex);
            styleMappers[mapperId] = updated;
          }
          applyStyleMapper(updated);
          return Value::undefined();
        });

    auto removeStyleMapper = Function::createFromHostFunction(
        runtime, PropNameID::forAscii(runtime, "removeStyleMapper"), 1,
        [this](Runtime &, const Value &, const Value *args, size_t count) -> Value {
          if (count < 1 || !args[0].isNumber()) return Value::undefined();
          int mapperId = static_cast<int>(args[0].asNumber());
          std::lock_guard<std::mutex> lock(mutex);
          styleMappers.erase(mapperId);
          return Value::undefined();
        });

    Object animate(runtime);
    animate.setProperty(runtime, "createSharedValue", createSharedValue);
    animate.setProperty(runtime, "getSharedValue", getSharedValue);
    animate.setProperty(runtime, "setSharedValue", setSharedValue);
    animate.setProperty(runtime, "animateSharedValue", animateSharedValue);
    animate.setProperty(runtime, "cancelSharedValue", cancelSharedValue);
    animate.setProperty(runtime, "createStyleMapper", createStyleMapper);
    animate.setProperty(runtime, "updateStyleMapper", updateStyleMapper);
    animate.setProperty(runtime, "removeStyleMapper", removeStyleMapper);
    runtime.global().setProperty(runtime, kAnimateKey, animate);
    __android_log_print(ANDROID_LOG_INFO, kTag, "animate bridge installed");
  }

  void onFrame(double timeMs) {
    frameScheduled = false;
    std::vector<int> finished;
    {
      std::lock_guard<std::mutex> lock(mutex);
      for (auto &entry : animations) {
        SharedAnimation &anim = entry.second;
        if (timeMs < anim.startTime + anim.delay) continue;
        double elapsed = timeMs - (anim.startTime + anim.delay);
        if (anim.kind == SharedAnimation::Kind::Timing) {
          double duration = anim.duration <= 0 ? 1.0 : anim.duration;
          double progress = std::min(elapsed / duration, 1.0);
          double value = anim.fromValue + (anim.toValue - anim.fromValue) * progress;
          if (gSetSharedSignal) gSetSharedSignal(state, anim.signalId, value);
          if (progress >= 1.0) finished.push_back(anim.signalId);
        } else {
          if (anim.lastTime == 0.0) {
            anim.lastTime = timeMs;
            continue;
          }
          double deltaMs = std::min(timeMs - anim.lastTime, 64.0);
          anim.lastTime = timeMs;
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
          if (gSetSharedSignal) gSetSharedSignal(state, anim.signalId, anim.fromValue);
          if (std::abs(anim.velocity) <= anim.restSpeed &&
              std::abs(anim.fromValue - anim.toValue) <= anim.restDisplacement) {
            if (gSetSharedSignal) gSetSharedSignal(state, anim.signalId, anim.toValue);
            finished.push_back(anim.signalId);
          }
        }
      }
      for (int id : finished) {
        animations.erase(id);
      }
    }
    applyStyleMappers();
    if (hasActiveAnimations()) {
      ensureFrame();
    }
  }

  void ensureFrame() {
    if (frameScheduled) return;
    frameScheduled = true;
    JNIEnv *env = getEnv();
    if (!env || !gFrameClockClass || !gRequestFrame) {
      frameScheduled = false;
      return;
    }
    env->CallStaticVoidMethod(gFrameClockClass, gRequestFrame,
                              reinterpret_cast<jlong>(this));
  }

 private:
  Runtime &runtime;
  void *state;
  std::atomic<int> nextStyleMapperId;
  std::unordered_map<int, SharedAnimation> animations;
  std::unordered_map<int, StyleMapper> styleMappers;
  std::mutex mutex;
  bool frameScheduled = false;

  double nowMs() const {
    timespec ts{};
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (static_cast<double>(ts.tv_sec) * 1000.0) +
        (static_cast<double>(ts.tv_nsec) / 1e6);
  }

  bool hasActiveAnimations() {
    std::lock_guard<std::mutex> lock(mutex);
    return !animations.empty();
  }

  StyleMapper buildStyleMapper(Runtime &rt, const Value &value) {
    StyleMapper mapper;
    if (!value.isObject()) return mapper;
    Object styleObj = value.asObject(rt);
    if (styleObj.hasProperty(rt, "opacity")) {
      parseMappedValue(rt, styleObj.getProperty(rt, "opacity"), mapper.opacity);
    }
    if (styleObj.hasProperty(rt, "width")) {
      parseMappedValue(rt, styleObj.getProperty(rt, "width"), mapper.width);
    }
    if (styleObj.hasProperty(rt, "height")) {
      parseMappedValue(rt, styleObj.getProperty(rt, "height"), mapper.height);
    }
    if (styleObj.hasProperty(rt, "minWidth")) {
      parseMappedValue(rt, styleObj.getProperty(rt, "minWidth"), mapper.minWidth);
    }
    if (styleObj.hasProperty(rt, "minHeight")) {
      parseMappedValue(rt, styleObj.getProperty(rt, "minHeight"), mapper.minHeight);
    }
    if (styleObj.hasProperty(rt, "maxWidth")) {
      parseMappedValue(rt, styleObj.getProperty(rt, "maxWidth"), mapper.maxWidth);
    }
    if (styleObj.hasProperty(rt, "maxHeight")) {
      parseMappedValue(rt, styleObj.getProperty(rt, "maxHeight"), mapper.maxHeight);
    }
    if (styleObj.hasProperty(rt, "flexBasis")) {
      parseMappedValue(rt, styleObj.getProperty(rt, "flexBasis"), mapper.flexBasis);
    }
    if (styleObj.hasProperty(rt, "transform")) {
      Value transformValue = styleObj.getProperty(rt, "transform");
      if (transformValue.isObject()) {
        Object transformObj = transformValue.asObject(rt);
        if (transformObj.isArray(rt)) {
          Array array = transformObj.asArray(rt);
          size_t count = array.size(rt);
          for (size_t i = 0; i < count; i++) {
            Value entryValue = array.getValueAtIndex(rt, i);
            if (!entryValue.isObject()) continue;
            Object entryObj = entryValue.asObject(rt);
            Array keys = entryObj.getPropertyNames(rt);
            size_t keyCount = keys.size(rt);
            for (size_t k = 0; k < keyCount; k++) {
              Value keyValue = keys.getValueAtIndex(rt, k);
              if (!keyValue.isString()) continue;
              std::string key = keyValue.asString(rt).utf8(rt);
              Value propValue = entryObj.getProperty(rt, key.c_str());
              if (key == "translateX") parseMappedValue(rt, propValue, mapper.translateX);
              else if (key == "translateY") parseMappedValue(rt, propValue, mapper.translateY);
              else if (key == "scale") parseMappedValue(rt, propValue, mapper.scale);
              else if (key == "scaleX") parseMappedValue(rt, propValue, mapper.scaleX);
              else if (key == "scaleY") parseMappedValue(rt, propValue, mapper.scaleY);
              else if (key == "rotate" || key == "rotateZ") parseMappedValue(rt, propValue, mapper.rotate, true);
              else if (key == "rotateX") parseMappedValue(rt, propValue, mapper.rotateX, true);
              else if (key == "rotateY") parseMappedValue(rt, propValue, mapper.rotateY, true);
              else if (key == "skewX") parseMappedValue(rt, propValue, mapper.skewX, true);
              else if (key == "skewY") parseMappedValue(rt, propValue, mapper.skewY, true);
              else if (key == "perspective") parseMappedValue(rt, propValue, mapper.perspective);
            }
          }
        }
      }
    }
    return mapper;
  }

  void applyStyleMapper(const StyleMapper &mapper) {
    if (!gApplyAnimatedStyle) return;
    float opacity = mapper.opacity.hasValue
        ? static_cast<float>(resolveMappedValue(mapper.opacity, state, 1.0))
        : 1.0f;
    float translateX = mapper.translateX.hasValue
        ? static_cast<float>(resolveMappedValue(mapper.translateX, state, 0.0))
        : 0.0f;
    float translateY = mapper.translateY.hasValue
        ? static_cast<float>(resolveMappedValue(mapper.translateY, state, 0.0))
        : 0.0f;
    float scaleX = 1.0f;
    float scaleY = 1.0f;
    if (mapper.scale.hasValue) {
      float uniform = static_cast<float>(resolveMappedValue(mapper.scale, state, 1.0));
      scaleX = uniform;
      scaleY = uniform;
    }
    if (mapper.scaleX.hasValue) {
      scaleX = static_cast<float>(resolveMappedValue(mapper.scaleX, state, 1.0));
    }
    if (mapper.scaleY.hasValue) {
      scaleY = static_cast<float>(resolveMappedValue(mapper.scaleY, state, 1.0));
    }
    float rotate = mapper.rotate.hasValue
        ? static_cast<float>(resolveMappedValue(mapper.rotate, state, 0.0))
        : 0.0f;
    float rotateX = mapper.rotateX.hasValue
        ? static_cast<float>(resolveMappedValue(mapper.rotateX, state, 0.0))
        : 0.0f;
    float rotateY = mapper.rotateY.hasValue
        ? static_cast<float>(resolveMappedValue(mapper.rotateY, state, 0.0))
        : 0.0f;
    float skewX = mapper.skewX.hasValue
        ? static_cast<float>(resolveMappedValue(mapper.skewX, state, 0.0))
        : 0.0f;
    float skewY = mapper.skewY.hasValue
        ? static_cast<float>(resolveMappedValue(mapper.skewY, state, 0.0))
        : 0.0f;
    float perspective = mapper.perspective.hasValue
        ? static_cast<float>(resolveMappedValue(mapper.perspective, state, std::numeric_limits<float>::quiet_NaN()))
        : std::numeric_limits<float>::quiet_NaN();
    gApplyAnimatedStyle(
        state,
        mapper.nodeId,
        opacity,
        translateX,
        translateY,
        scaleX,
        scaleY,
        rotate,
        rotateX,
        rotateY,
        skewX,
        skewY,
        perspective);

    if (gApplyAnimatedLayoutStyle) {
      float width = mapper.width.hasValue
          ? static_cast<float>(resolveMappedValue(mapper.width, state, std::numeric_limits<float>::quiet_NaN()))
          : std::numeric_limits<float>::quiet_NaN();
      float height = mapper.height.hasValue
          ? static_cast<float>(resolveMappedValue(mapper.height, state, std::numeric_limits<float>::quiet_NaN()))
          : std::numeric_limits<float>::quiet_NaN();
      
      if (!std::isnan(height)) {
        __android_log_print(ANDROID_LOG_DEBUG, kTag, "Applying height %.2f to node %d", height, mapper.nodeId);
      }
      
      float minWidth = mapper.minWidth.hasValue
          ? static_cast<float>(resolveMappedValue(mapper.minWidth, state, std::numeric_limits<float>::quiet_NaN()))
          : std::numeric_limits<float>::quiet_NaN();
      float minHeight = mapper.minHeight.hasValue
          ? static_cast<float>(resolveMappedValue(mapper.minHeight, state, std::numeric_limits<float>::quiet_NaN()))
          : std::numeric_limits<float>::quiet_NaN();
      float maxWidth = mapper.maxWidth.hasValue
          ? static_cast<float>(resolveMappedValue(mapper.maxWidth, state, std::numeric_limits<float>::quiet_NaN()))
          : std::numeric_limits<float>::quiet_NaN();
      float maxHeight = mapper.maxHeight.hasValue
          ? static_cast<float>(resolveMappedValue(mapper.maxHeight, state, std::numeric_limits<float>::quiet_NaN()))
          : std::numeric_limits<float>::quiet_NaN();
      float flexBasis = mapper.flexBasis.hasValue
          ? static_cast<float>(resolveMappedValue(mapper.flexBasis, state, std::numeric_limits<float>::quiet_NaN()))
          : std::numeric_limits<float>::quiet_NaN();
      gApplyAnimatedLayoutStyle(
          state,
          mapper.nodeId,
          width,
          height,
          minWidth,
          minHeight,
          maxWidth,
          maxHeight,
          flexBasis);
    }
  }

  void applyStyleMappers() {
    std::vector<StyleMapper> snapshot;
    {
      std::lock_guard<std::mutex> lock(mutex);
      snapshot.reserve(styleMappers.size());
      for (const auto &entry : styleMappers) {
        snapshot.push_back(entry.second);
      }
    }
    for (const auto &mapper : snapshot) {
      applyStyleMapper(mapper);
    }
  }
};

std::mutex gInstanceMutex;
std::unordered_map<ZynthAnimateRuntime *, std::shared_ptr<ZynthAnimateRuntime>> gInstances;

void onSharedSignalChanged(void *state, int signalId) {
  __android_log_print(ANDROID_LOG_DEBUG, kTag, "Shared signal %d changed", signalId);
  std::lock_guard<std::mutex> lock(gInstanceMutex);
  if (gInstances.empty()) {
    __android_log_print(ANDROID_LOG_DEBUG, kTag, "onSharedSignalChanged: gInstances is empty!");
  }
  for (auto &pair : gInstances) {
    if (pair.first->getState() == state) {
      __android_log_print(ANDROID_LOG_DEBUG, kTag, "Scheduling frame for signal %d", signalId);
      pair.first->ensureFrame();
    }
  }
}

void registerInstaller() {
  __android_log_print(ANDROID_LOG_DEBUG, kTag, "Registering installer...");
  resolveCoreSymbols();
  if (gRegisterSharedSignalCallback) {
    gRegisterSharedSignalCallback(onSharedSignalChanged);
  }
  if (!gRegisterInstaller) {
    __android_log_print(ANDROID_LOG_WARN, kTag, "JSI plugin registry not available");
    return;
  }
  gRegisterInstaller([](Runtime &rt, void *state) {
    if (!state) return;
    auto instance = std::make_shared<ZynthAnimateRuntime>(rt, state);
    ZynthAnimateRuntime *raw = instance.get();
    {
      std::lock_guard<std::mutex> lock(gInstanceMutex);
      gInstances[raw] = instance;
    }
    instance->install();
  });
}
} // namespace

extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *) {
  gVm = vm;
  registerInstaller();
  return JNI_VERSION_1_6;
}

extern "C" JNIEXPORT void JNICALL
Java_dev_zynth_animate_ZynthAnimateFrameClock_nativeInstall(
    JNIEnv *env, jclass, jclass clazz) {
  if (!clazz) return;
  gFrameClockClass = static_cast<jclass>(env->NewGlobalRef(clazz));
  gRequestFrame = env->GetStaticMethodID(gFrameClockClass, "requestFrame", "(J)V");
  gCancelFrame = env->GetStaticMethodID(gFrameClockClass, "cancelFrame", "(J)V");
}

extern "C" JNIEXPORT void JNICALL
Java_dev_zynth_animate_ZynthAnimateFrameClock_nativeOnFrame(
    JNIEnv *, jclass, jlong handle, jdouble timeMs) {
  auto *instance = reinterpret_cast<ZynthAnimateRuntime *>(handle);
  if (!instance) return;
  instance->onFrame(timeMs);
}