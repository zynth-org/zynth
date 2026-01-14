#include <jni.h>

#include <android/log.h>
#include <hermes/Public/RuntimeConfig.h>
#include <hermes/hermes.h>
#include <jsi/jsi.h>

#include <chrono>
#include <cmath>
#include <algorithm>
#include <limits>
#include <memory>
#include <mutex>
#include <optional>
#include <time.h>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace rune::kit {
namespace {

constexpr const char *kLogTag = "RuneHermesBridge";

#define BRIDGE_LOG(priority, fmt, ...) __android_log_print(priority, kLogTag, fmt, ##__VA_ARGS__)

JavaVM *gJavaVm = nullptr;

class JniEnv {
 public:
  JniEnv() {
    env_ = nullptr;
    attached_ = false;
    if (!gJavaVm) {
      return;
    }
    if (gJavaVm->GetEnv(reinterpret_cast<void **>(&env_), JNI_VERSION_1_6) != JNI_OK) {
      if (gJavaVm->AttachCurrentThread(&env_, nullptr) == JNI_OK) {
        attached_ = true;
      } else {
        env_ = nullptr;
      }
    }
  }

  ~JniEnv() {
    if (attached_ && gJavaVm && env_) {
      gJavaVm->DetachCurrentThread();
    }
  }

  JNIEnv *operator->() const { return env_; }
  JNIEnv *get() const { return env_; }
  bool valid() const { return env_ != nullptr; }

 private:
  JNIEnv *env_;
  bool attached_;
};

class BytecodeBuffer final : public facebook::jsi::Buffer {
 public:
  BytecodeBuffer(const uint8_t *data, size_t length) : bytes_(data, data + length) {}
  size_t size() const override { return bytes_.size(); }
  const uint8_t *data() const override { return bytes_.data(); }

 private:
  std::vector<uint8_t> bytes_;
};

struct UIShimMethods {
  jmethodID createNode = nullptr;
  jmethodID setProp = nullptr;
  jmethodID setText = nullptr;
  jmethodID insertChild = nullptr;
  jmethodID removeChild = nullptr;
  jmethodID removeNode = nullptr;
  jmethodID setHandler = nullptr;
  jmethodID flush = nullptr;
  jmethodID dequeueEventPayload = nullptr;
  jmethodID setSurface = nullptr;
  jmethodID applyBatch = nullptr;
  jmethodID applyAnimatedStyle = nullptr;
};

struct ModulesShimMethods {
  jmethodID getConstants = nullptr;
  jmethodID invoke = nullptr;
  jmethodID callSync = nullptr;
};

struct TimerShimMethods {
  jmethodID scheduleTimeout = nullptr;
  jmethodID clearTimeout = nullptr;
  jmethodID scheduleInterval = nullptr;
  jmethodID clearInterval = nullptr;
  jmethodID requestAnimationFrame = nullptr;
  jmethodID cancelAnimationFrame = nullptr;
};

struct HandlerEntry {
  long id = 0;
  int nodeId = 0;
  std::string event;
  std::shared_ptr<facebook::jsi::Function> function;
};

struct TimerEntry {
  int id = 0;
  std::shared_ptr<facebook::jsi::Function> callback;
  std::vector<facebook::jsi::Value> args;
  bool isInterval = false;
};

struct PromiseEntry {
  std::shared_ptr<facebook::jsi::Function> resolve;
  std::shared_ptr<facebook::jsi::Function> reject;
};

constexpr const char *kRuneSharedValueKey = "__rune_shared_value";

enum class RuneSharedAnimationKind {
  Timing,
  Spring,
};

enum class RuneSharedEasing {
  Linear,
  Ease,
  EaseIn,
  EaseOut,
  EaseInOut,
  EaseOutCubic,
};

struct RuneSharedValueAnimation {
  RuneSharedAnimationKind kind = RuneSharedAnimationKind::Timing;
  RuneSharedEasing easing = RuneSharedEasing::EaseOutCubic;
  double fromValue = 0.0;
  double toValue = 0.0;
  double startTimeMs = 0.0;
  double durationMs = 0.0;
  double velocity = 0.0;
  double damping = 20.0;
  double stiffness = 150.0;
  double mass = 1.0;
  double restSpeed = 0.001;
  double restDisplacement = 0.001;
  bool overshootClamping = false;
  double lastTimeMs = 0.0;
};

struct RuneSharedValue {
  double value = 0.0;
  bool animating = false;
  RuneSharedValueAnimation animation;
};

struct RuneMappedValue {
  bool hasValue = false;
  bool isShared = false;
  int sharedId = 0;
  double numberValue = 0.0;
};

struct RuneStyleMapper {
  int id = 0;
  int nodeId = 0;
  RuneMappedValue opacity;
  RuneMappedValue translateX;
  RuneMappedValue translateY;
  RuneMappedValue scale;
  RuneMappedValue scaleX;
  RuneMappedValue scaleY;
  RuneMappedValue rotate;
  RuneMappedValue rotateX;
  RuneMappedValue rotateY;
  RuneMappedValue skewX;
  RuneMappedValue skewY;
  RuneMappedValue perspective;
};

struct RuntimeState {
  facebook::hermes::HermesRuntime *runtime = nullptr;
  jobject uiShim = nullptr;
  jobject modulesShim = nullptr;
  jobject timerShim = nullptr;
  jobject errorHandler = nullptr;
  jclass uiClass = nullptr;
  jclass modulesClass = nullptr;
  jclass timerClass = nullptr;
  jclass errorHandlerClass = nullptr;
  UIShimMethods uiMethods;
  ModulesShimMethods moduleMethods;
  TimerShimMethods timerMethods;
  jmethodID reportError = nullptr;
  std::mutex mutex;
  long nextHandlerId = 1;
  int nextTimerId = 1;
  int nextAnimationFrameId = 1;
  int nextPromiseId = 1;
  int nextSharedValueId = 1;
  int nextStyleMapperId = 1;
  int nativeAnimationFrameId = -1000;
  bool nativeAnimationScheduled = false;
  std::unordered_map<long, HandlerEntry> handlers;
  std::unordered_map<int, TimerEntry> timers;
  std::unordered_map<int, std::shared_ptr<facebook::jsi::Function>> animationFrames;
  std::unordered_map<int, PromiseEntry> promises;
  std::unordered_map<std::string, double> consoleTimers;
  std::unordered_map<int, RuneSharedValue> sharedValues;
  std::unordered_map<int, RuneStyleMapper> styleMappers;
  double performanceOriginMs = 0.0;
};

std::mutex gStateMutex;
std::unordered_map<facebook::hermes::HermesRuntime *, std::shared_ptr<RuntimeState>> gStates;

inline std::shared_ptr<RuntimeState> getState(facebook::hermes::HermesRuntime *runtime) {
  std::lock_guard<std::mutex> lock(gStateMutex);
  auto it = gStates.find(runtime);
  if (it == gStates.end()) {
    return nullptr;
  }
  return it->second;
}

inline void storeState(facebook::hermes::HermesRuntime *runtime, std::shared_ptr<RuntimeState> state) {
  std::lock_guard<std::mutex> lock(gStateMutex);
  gStates[runtime] = std::move(state);
}

inline std::shared_ptr<RuntimeState> removeState(facebook::hermes::HermesRuntime *runtime) {
  std::lock_guard<std::mutex> lock(gStateMutex);
  auto it = gStates.find(runtime);
  if (it == gStates.end()) {
    return nullptr;
  }
  auto state = it->second;
  gStates.erase(it);
  return state;
}

void logJniException(JNIEnv *env, const char *context) {
  if (!env || !env->ExceptionCheck()) {
    return;
  }
  env->ExceptionDescribe();
  env->ExceptionClear();
  BRIDGE_LOG(ANDROID_LOG_ERROR, "JNI exception in %s", context);
}

jstring makeJString(JNIEnv *env, const std::string &s) {
  return env->NewStringUTF(s.c_str());
}

std::string getUtfString(JNIEnv *env, jstring str) {
  if (!str) return {};
  const char *chars = env->GetStringUTFChars(str, nullptr);
  std::string result = chars ? chars : "";
  if (chars) env->ReleaseStringUTFChars(str, chars);
  return result;
}

std::string getThrowableMessage(JNIEnv *env, jthrowable throwable) {
  if (!env || !throwable) {
    return {};
  }
  jclass throwableClass = env->GetObjectClass(throwable);
  if (!throwableClass) {
    return {};
  }
  jmethodID getMessage = env->GetMethodID(throwableClass, "getMessage", "()Ljava/lang/String;");
  std::string message;
  if (getMessage) {
    jstring jMessage = static_cast<jstring>(env->CallObjectMethod(throwable, getMessage));
    message = getUtfString(env, jMessage);
    if (jMessage) {
      env->DeleteLocalRef(jMessage);
    }
  }
  env->DeleteLocalRef(throwableClass);
  return message;
}

std::string toJsonString(facebook::jsi::Runtime &rt, const facebook::jsi::Value &value) {
  using namespace facebook::jsi;
  
  // If the value is already a string, check if it looks like JSON
  // If it does, pass it through as-is to avoid double-encoding
  if (value.isString()) {
    std::string str = value.getString(rt).utf8(rt);
    // Trim whitespace
    size_t start = str.find_first_not_of(" \t\n\r");
    size_t end = str.find_last_not_of(" \t\n\r");
    if (start != std::string::npos && end != std::string::npos) {
      std::string trimmed = str.substr(start, end - start + 1);
      // If it looks like JSON (starts with { or [ and ends with } or ]), pass through
      if ((trimmed.length() >= 2) &&
          ((trimmed.front() == '{' && trimmed.back() == '}') ||
           (trimmed.front() == '[' && trimmed.back() == ']'))) {
        return trimmed;
      }
    }
    // Otherwise, fall through to stringify it
  }
  
  auto global = rt.global();
  auto jsonObj = global.getPropertyAsObject(rt, "JSON");
  auto stringify = jsonObj.getPropertyAsFunction(rt, "stringify");
  Value tmp = stringify.call(rt, value);
  if (tmp.isString()) {
    return tmp.getString(rt).utf8(rt);
  }
  return "{}";
}

static RuneSharedEasing parseEasing(const std::string &name) {
  if (name == "linear") return RuneSharedEasing::Linear;
  if (name == "ease") return RuneSharedEasing::Ease;
  if (name == "easeIn") return RuneSharedEasing::EaseIn;
  if (name == "easeOut") return RuneSharedEasing::EaseOut;
  if (name == "easeInOut") return RuneSharedEasing::EaseInOut;
  if (name == "easeOutCubic") return RuneSharedEasing::EaseOutCubic;
  return RuneSharedEasing::EaseOutCubic;
}

static double applyEasing(RuneSharedEasing easing, double t) {
  double clamped = std::max(0.0, std::min(1.0, t));
  switch (easing) {
    case RuneSharedEasing::Linear:
      return clamped;
    case RuneSharedEasing::Ease:
      return clamped * clamped * (3.0 - 2.0 * clamped);
    case RuneSharedEasing::EaseIn:
      return clamped * clamped;
    case RuneSharedEasing::EaseOut: {
      double inv = 1.0 - clamped;
      return 1.0 - inv * inv;
    }
    case RuneSharedEasing::EaseInOut:
      if (clamped < 0.5) {
        return 2.0 * clamped * clamped;
      } else {
        double inv = 1.0 - clamped;
        return 1.0 - 2.0 * inv * inv;
      }
    case RuneSharedEasing::EaseOutCubic: {
      double inv = 1.0 - clamped;
      return 1.0 - inv * inv * inv;
    }
  }
}

static bool extractSharedValueId(
    facebook::jsi::Runtime &rt,
    const facebook::jsi::Value &value,
    int &outId) {
  if (!value.isObject()) return false;
  auto obj = value.getObject(rt);
  if (!obj.hasProperty(rt, kRuneSharedValueKey)) return false;
  auto idValue = obj.getProperty(rt, kRuneSharedValueKey);
  if (!idValue.isNumber()) return false;
  outId = static_cast<int>(idValue.asNumber());
  return true;
}

static bool parseAngleString(const std::string &input, double &outDegrees) {
  if (input.size() >= 3 && input.compare(input.size() - 3, 3, "deg") == 0) {
    std::string raw = input.substr(0, input.size() - 3);
    try {
      outDegrees = std::stod(raw);
      return true;
    } catch (...) {
      return false;
    }
  }
  if (input.size() >= 3 && input.compare(input.size() - 3, 3, "rad") == 0) {
    std::string raw = input.substr(0, input.size() - 3);
    try {
      outDegrees = std::stod(raw) * 180.0 / M_PI;
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

static bool parseMappedValue(
    facebook::jsi::Runtime &rt,
    const facebook::jsi::Value &value,
    RuneMappedValue &out,
    bool isAngle = false) {
  int sharedId = 0;
  if (extractSharedValueId(rt, value, sharedId)) {
    out.hasValue = true;
    out.isShared = true;
    out.sharedId = sharedId;
    return true;
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

static double monotonicTimeMs() {
  timespec ts{};
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (static_cast<double>(ts.tv_sec) * 1000.0) +
      (static_cast<double>(ts.tv_nsec) / 1e6);
}

facebook::jsi::Value parseJson(facebook::jsi::Runtime &rt, const std::string &json) {
  using namespace facebook::jsi;
  auto global = rt.global();
  auto jsonObj = global.getPropertyAsObject(rt, "JSON");
  auto parse = jsonObj.getPropertyAsFunction(rt, "parse");
  auto arg = String::createFromUtf8(rt, json);
  return parse.call(rt, arg);
}

inline void CallJSFunction(facebook::jsi::Function &fn,
                           facebook::jsi::Runtime &rt,
                           const facebook::jsi::Value *args,
                           size_t count) {
  const auto callPtr = static_cast<facebook::jsi::Value (facebook::jsi::Function::*)(
      facebook::jsi::Runtime &, const facebook::jsi::Value *, size_t) const>(&facebook::jsi::Function::call);
  (fn.*callPtr)(rt, args, count);
  if (auto *hermesRt = dynamic_cast<facebook::hermes::HermesRuntime *>(&rt)) {
    hermesRt->drainMicrotasks();
  }
}

void reportJsError(
    const std::shared_ptr<RuntimeState> &state,
    const std::string &message,
    const std::string &stack) {
  if (!state || !state->errorHandler || !state->reportError) {
    return;
  }
  std::string safeMessage = message.empty() ? std::string("Unknown JavaScript error") : message;
  JniEnv env;
  if (!env.valid()) {
    return;
  }
  jstring jMessage = makeJString(env.get(), safeMessage);
  jstring jStack = stack.empty() ? nullptr : makeJString(env.get(), stack);
  env->CallVoidMethod(state->errorHandler, state->reportError, jMessage, jStack);
  if (jMessage) env->DeleteLocalRef(jMessage);
  if (jStack) env->DeleteLocalRef(jStack);
  logJniException(env.get(), "ErrorHandler.report");
}

/**
 * Unified diagnostics reporting function similar to iOS RuneReportJSIError.
 * Reports errors through the RuneDiagnostics system.
 */
void RuneReportJSIError(
    facebook::jsi::Runtime & /* rt */, 
    const facebook::jsi::JSError &error, 
    const char *phase) {
  std::string message = error.getMessage();
  std::string stack = error.getStack();
  
  if (message.empty()) {
    message = "Unknown JSI error";
  }
  
  JniEnv env;
  if (!env.valid()) {
    BRIDGE_LOG(ANDROID_LOG_ERROR, "[%s] %s", phase ? phase : "jsi", message.c_str());
    return;
  }
  
  jstring jPhase = env->NewStringUTF(phase ? phase : "jsi");
  jstring jMessage = env->NewStringUTF(message.c_str());
  jstring jStack = env->NewStringUTF(stack.c_str());
  
  // Call the JNI bridge to RuneDiagnostics
  jclass runeDiagClass = env->FindClass("com/rune/kit/dev/RuneDiagnosticsKt");
  if (runeDiagClass) {
    jmethodID reportMethod = env->GetStaticMethodID(
        runeDiagClass, 
        "runeDiagnosticsReportJNI", 
        "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V");
    if (reportMethod) {
      env->CallStaticVoidMethod(runeDiagClass, reportMethod, jPhase, jMessage, jStack);
    }
    env->DeleteLocalRef(runeDiagClass);
  }
  
  if (jPhase) env->DeleteLocalRef(jPhase);
  if (jMessage) env->DeleteLocalRef(jMessage);
  if (jStack) env->DeleteLocalRef(jStack);
}

/**
 * Clean up all handlers for a given node ID.
 * This should be called when a node is removed to prevent memory leaks
 * and ensure handlers don't fire for non-existent nodes.
 */
void removeHandlersForNode(const std::shared_ptr<RuntimeState> &state, int nodeId) {
  std::lock_guard<std::mutex> lock(state->mutex);
  for (auto it = state->handlers.begin(); it != state->handlers.end();) {
    if (it->second.nodeId == nodeId) {
      // BRIDGE_LOG(ANDROID_LOG_DEBUG, "Removing handler %ld for node %d event %s", 
      //            it->first, nodeId, it->second.event.c_str());
      it = state->handlers.erase(it);
    } else {
      ++it;
    }
  }
}

facebook::jsi::Value makePromise(
    facebook::jsi::Runtime &rt,
    std::function<void(facebook::jsi::Function &&resolve, facebook::jsi::Function &&reject)> work) {
  using namespace facebook::jsi;
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

facebook::jsi::Value javaObjectToJsValue(
    facebook::jsi::Runtime &rt,
    JNIEnv *env,
    jobject value,
    jclass classInteger,
    jmethodID integerValue,
    jclass classDouble,
    jmethodID doubleValue,
    jclass classBoolean,
    jmethodID booleanValue,
    jclass classString) {
  using namespace facebook::jsi;
  if (!value) {
    return Value::null();
  }
  if (env->IsInstanceOf(value, classInteger)) {
    jint v = env->CallIntMethod(value, integerValue);
    return Value(static_cast<double>(v));
  }
  if (env->IsInstanceOf(value, classDouble)) {
    jdouble v = env->CallDoubleMethod(value, doubleValue);
    return Value(static_cast<double>(v));
  }
  if (env->IsInstanceOf(value, classBoolean)) {
    jboolean v = env->CallBooleanMethod(value, booleanValue);
    return Value(static_cast<bool>(v == JNI_TRUE));
  }
  if (env->IsInstanceOf(value, classString)) {
    auto js = static_cast<jstring>(value);
    std::string utf = getUtfString(env, js);
    return Value(facebook::jsi::String::createFromUtf8(rt, utf));
  }
  jclass jsonObjectClass = env->FindClass("org/json/JSONObject");
  if (jsonObjectClass) {
    const bool isJsonObject = env->IsInstanceOf(value, jsonObjectClass);
    if (isJsonObject) {
      jmethodID toStringMethod = env->GetMethodID(jsonObjectClass, "toString", "()Ljava/lang/String;");
      jstring jsonString = nullptr;
      if (toStringMethod) {
        jsonString = static_cast<jstring>(env->CallObjectMethod(value, toStringMethod));
      }
      std::string jsonUtf = getUtfString(env, jsonString);
      if (jsonString) {
        env->DeleteLocalRef(jsonString);
      }
      env->DeleteLocalRef(jsonObjectClass);
      if (env->ExceptionCheck()) {
        env->ExceptionClear();
        BRIDGE_LOG(ANDROID_LOG_ERROR, "javaObjectToJsValue: JSONObject.toString threw an exception");
        return Value::undefined();
      }
      if (!jsonUtf.empty()) {
        return parseJson(rt, jsonUtf);
      }
      return parseJson(rt, "{}");
    }
    env->DeleteLocalRef(jsonObjectClass);
  }
  jclass jsonArrayClass = env->FindClass("org/json/JSONArray");
  if (jsonArrayClass) {
    const bool isJsonArray = env->IsInstanceOf(value, jsonArrayClass);
    if (isJsonArray) {
      jmethodID toStringMethod = env->GetMethodID(jsonArrayClass, "toString", "()Ljava/lang/String;");
      jstring jsonString = nullptr;
      if (toStringMethod) {
        jsonString = static_cast<jstring>(env->CallObjectMethod(value, toStringMethod));
      }
      std::string jsonUtf = getUtfString(env, jsonString);
      if (jsonString) {
        env->DeleteLocalRef(jsonString);
      }
      env->DeleteLocalRef(jsonArrayClass);
      if (env->ExceptionCheck()) {
        env->ExceptionClear();
        BRIDGE_LOG(ANDROID_LOG_ERROR, "javaObjectToJsValue: JSONArray.toString threw an exception");
        return Value::undefined();
      }
      if (!jsonUtf.empty()) {
        return parseJson(rt, jsonUtf);
      }
      return parseJson(rt, "[]");
    }
    env->DeleteLocalRef(jsonArrayClass);
  }
  jclass byteBufferClass = env->FindClass("java/nio/ByteBuffer");
  if (env->IsInstanceOf(value, byteBufferClass)) {
    auto buffer = static_cast<uint8_t*>(env->GetDirectBufferAddress(value));
    auto capacity = env->GetDirectBufferCapacity(value);
    auto arrayBuffer = rt.global()
      .getPropertyAsFunction(rt, "ArrayBuffer")
      .callAsConstructor(rt, {Value(static_cast<double>(capacity))})
      .getObject(rt)
      .getArrayBuffer(rt);
    memcpy(arrayBuffer.data(rt), buffer, capacity);
    return arrayBuffer;
  }

  BRIDGE_LOG(ANDROID_LOG_WARN, "javaObjectToJsValue: Unknown type, returning undefined");
  return Value::undefined();
}

void installConsole(std::shared_ptr<RuntimeState> state) {
  using namespace facebook::jsi;
  auto &rt = *state->runtime;
  auto weakState = std::weak_ptr<RuntimeState>(state);

  auto nowMs = []() -> double {
    using namespace std::chrono;
    return duration_cast<duration<double, std::milli>>(
               steady_clock::now().time_since_epoch())
        .count();
  };

  auto stringifyValue = [](Runtime &rt, const Value &value) -> std::string {
    if (value.isString()) {
      return value.getString(rt).utf8(rt);
    }
    if (value.isNumber()) {
      return std::to_string(value.getNumber());
    }
    if (value.isBool()) {
      return value.getBool() ? "true" : "false";
    }
    if (value.isNull()) {
      return "null";
    }
    if (value.isUndefined()) {
      return "undefined";
    }
    if (value.isObject()) {
      try {
        auto global = rt.global();
        if (global.hasProperty(rt, "JSON")) {
          auto jsonObj = global.getPropertyAsObject(rt, "JSON");
          if (jsonObj.hasProperty(rt, "stringify")) {
            auto stringify = jsonObj.getPropertyAsFunction(rt, "stringify");
            auto result = stringify.call(rt, value);
            if (result.isString()) {
              return result.getString(rt).utf8(rt);
            }
          }
        }
      } catch (...) {
        // Fall through to default formatting.
      }
      try {
        auto str = value.toString(rt);
        return str.utf8(rt);
      } catch (...) {
        return "[object]";
      }
    }
    return "[object]";
  };

  auto formatArgs = [stringifyValue](Runtime &rt, const Value *args, size_t count) {
    std::string message;
    for (size_t i = 0; i < count; ++i) {
      if (i > 0) message += " ";
      message += stringifyValue(rt, args[i]);
    }
    return message;
  };
  auto logFunction = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "log"), 0,
      [formatArgs](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        std::string message = formatArgs(rt, args, count);
        BRIDGE_LOG(ANDROID_LOG_INFO, "%s", message.c_str());
        return Value::undefined();
      });
  auto warnFunction = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "warn"), 0,
      [formatArgs](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        std::string message = formatArgs(rt, args, count);
        BRIDGE_LOG(ANDROID_LOG_WARN, "%s", message.c_str());
        return Value::undefined();
      });
  auto errorFunction = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "error"), 0,
      [formatArgs](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        std::string message = formatArgs(rt, args, count);
        BRIDGE_LOG(ANDROID_LOG_ERROR, "%s", message.c_str());
        return Value::undefined();
      });

  auto timeFunction = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "time"), 1,
      [weakState, nowMs](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        std::string label = "default";
        if (count > 0) {
          label = args[0].isString() ? args[0].getString(rt).utf8(rt)
                                    : "default";
        }
        state->consoleTimers[label] = nowMs();
        return Value::undefined();
      });

  auto timeLogFunction = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "timeLog"), 1,
      [weakState, nowMs](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        std::string label = "default";
        if (count > 0) {
          label = args[0].isString() ? args[0].getString(rt).utf8(rt)
                                    : "default";
        }
        auto it = state->consoleTimers.find(label);
        if (it == state->consoleTimers.end()) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "Timer \"%s\" does not exist", label.c_str());
          return Value::undefined();
        }
        const double delta = nowMs() - it->second;
        BRIDGE_LOG(ANDROID_LOG_INFO, "%s: %.3fms", label.c_str(), delta);
        return Value::undefined();
      });

  auto timeEndFunction = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "timeEnd"), 1,
      [weakState, nowMs](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        std::string label = "default";
        if (count > 0) {
          label = args[0].isString() ? args[0].getString(rt).utf8(rt)
                                    : "default";
        }
        auto it = state->consoleTimers.find(label);
        if (it == state->consoleTimers.end()) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "Timer \"%s\" does not exist", label.c_str());
          return Value::undefined();
        }
        const double delta = nowMs() - it->second;
        state->consoleTimers.erase(it);
        BRIDGE_LOG(ANDROID_LOG_INFO, "%s: %.3fms", label.c_str(), delta);
        return Value::undefined();
      });

  auto performanceNow = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "now"), 0,
      [weakState, nowMs](Runtime &, const Value &, const Value *, size_t) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        if (state->performanceOriginMs == 0.0) {
          state->performanceOriginMs = nowMs();
        }
        return Value(nowMs() - state->performanceOriginMs);
      });

  Object console(rt);
  auto global = rt.global();
  if (global.hasProperty(rt, "console")) {
    auto existing = global.getProperty(rt, "console");
    if (existing.isObject()) {
      console = existing.getObject(rt);
    }
  }
  console.setProperty(rt, "log", logFunction);
  console.setProperty(rt, "warn", warnFunction);
  console.setProperty(rt, "error", errorFunction);
  console.setProperty(rt, "time", timeFunction);
  console.setProperty(rt, "timeLog", timeLogFunction);
  console.setProperty(rt, "timeEnd", timeEndFunction);
  global.setProperty(rt, "console", console);

  Object performance(rt);
  if (global.hasProperty(rt, "performance")) {
    auto existing = global.getProperty(rt, "performance");
    if (existing.isObject()) {
      performance = existing.getObject(rt);
    }
  }
  performance.setProperty(rt, "now", performanceNow);
  global.setProperty(rt, "performance", performance);
}

void installPlatformFlag(std::shared_ptr<RuntimeState> state) {
  using namespace facebook::jsi;
  auto &rt = *state->runtime;
  auto platform = String::createFromAscii(rt, "android");
  rt.global().setProperty(rt, "__RUNE_PLATFORM", platform);
}

void installUIBindings(std::shared_ptr<RuntimeState> state) {
  using namespace facebook::jsi;
  auto weakState = std::weak_ptr<RuntimeState>(state);
  auto &rt = *state->runtime;

  auto createNode = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "createNode"), 1,
      [weakState](Runtime &runtime, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        if (count < 1 || !args[0].isString()) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "createNode expects a string type");
          return Value::undefined();
        }
        std::string type = args[0].getString(runtime).utf8(runtime);
        JniEnv env;
        if (!env.valid()) return Value::undefined();
        jstring jType = makeJString(env.get(), type);
        jint nodeId = env->CallIntMethod(state->uiShim, state->uiMethods.createNode, jType);
        env->DeleteLocalRef(jType);
        logJniException(env.get(), "UIShim.createNode");
        return Value(static_cast<double>(nodeId));
      });

  auto setProp = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setProp"), 3,
      [weakState](Runtime &runtime, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        if (count < 3 || !args[0].isNumber() || !args[1].isString()) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "setProp expects (id, name, value)");
          return Value::undefined();
        }
        int nodeId = static_cast<int>(args[0].asNumber());
        std::string name = args[1].getString(runtime).utf8(runtime);
        std::string json = toJsonString(runtime, args[2]);
        JniEnv env;
        if (!env.valid()) return Value::undefined();
        jstring jName = makeJString(env.get(), name);
        jstring jValue = makeJString(env.get(), json);
        env->CallVoidMethod(state->uiShim, state->uiMethods.setProp, nodeId, jName, jValue);
        env->DeleteLocalRef(jName);
        env->DeleteLocalRef(jValue);
        logJniException(env.get(), "UIShim.setProp");
        return Value::undefined();
      });

  auto setText = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setText"), 2,
      [weakState](Runtime &runtime, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        if (count < 2 || !args[0].isNumber()) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "setText expects (id, text)");
          return Value::undefined();
        }
        int nodeId = static_cast<int>(args[0].asNumber());
        std::string text;
        if (args[1].isString()) {
          text = args[1].getString(runtime).utf8(runtime);
        } else {
          text = toJsonString(runtime, args[1]);
        }
        JniEnv env;
        if (!env.valid()) return Value::undefined();
        jstring jText = makeJString(env.get(), text);
        env->CallVoidMethod(state->uiShim, state->uiMethods.setText, nodeId, jText);
        env->DeleteLocalRef(jText);
        logJniException(env.get(), "UIShim.setText");
        return Value::undefined();
      });

  auto insertChild = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "insertChild"), 3,
      [weakState](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        if (count < 3 || !args[0].isNumber() || !args[1].isNumber()) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "insertChild expects (parent, child, index)");
          return Value::undefined();
        }
        int parentId = static_cast<int>(args[0].asNumber());
        int childId = static_cast<int>(args[1].asNumber());
        int index = static_cast<int>(count >= 3 && args[2].isNumber() ? args[2].asNumber() : 0);
        JniEnv env;
        if (!env.valid()) return Value::undefined();
        env->CallVoidMethod(state->uiShim, state->uiMethods.insertChild, parentId, childId, index);
        logJniException(env.get(), "UIShim.insertChild");
        return Value::undefined();
      });

  auto removeChild = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "removeChild"), 2,
      [weakState](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        if (count < 2 || !args[0].isNumber() || !args[1].isNumber()) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "removeChild expects (parent, child)");
          return Value::undefined();
        }
        int parentId = static_cast<int>(args[0].asNumber());
        int childId = static_cast<int>(args[1].asNumber());
        
        // Clean up handlers for the child node (matching iOS behavior)
        removeHandlersForNode(state, childId);
        
        JniEnv env;
        if (!env.valid()) return Value::undefined();
        env->CallVoidMethod(state->uiShim, state->uiMethods.removeChild, parentId, childId);
        logJniException(env.get(), "UIShim.removeChild");
        return Value::undefined();
      });

  auto removeNode = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "removeNode"), 1,
      [weakState](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        if (count < 1 || !args[0].isNumber()) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "removeNode expects node id");
          return Value::undefined();
        }
        int nodeId = static_cast<int>(args[0].asNumber());
        
        // Clean up handlers for the node
        removeHandlersForNode(state, nodeId);
        JniEnv env;
        if (!env.valid()) return Value::undefined();
        env->CallVoidMethod(state->uiShim, state->uiMethods.removeNode, nodeId);
        logJniException(env.get(), "UIShim.removeNode");
        return Value::undefined();
      });

  auto setHandler = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setHandler"), 3,
      [weakState](Runtime &runtime, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        if (count < 3 || !args[0].isNumber() || !args[1].isString()) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "setHandler expects (id, name, fn)");
          return Value::undefined();
        }
        int nodeId = static_cast<int>(args[0].asNumber());
        std::string event = args[1].getString(runtime).utf8(runtime);
        long handlerId = 0;
        {
          std::lock_guard<std::mutex> lock(state->mutex);
          // Remove previous mapping for this node/event
          for (auto it = state->handlers.begin(); it != state->handlers.end();) {
            if (it->second.nodeId == nodeId && it->second.event == event) {
              it = state->handlers.erase(it);
            } else {
              ++it;
            }
          }
          if (args[2].isObject()) {
            auto obj = args[2].asObject(runtime);
            if (obj.isFunction(runtime)) {
              handlerId = state->nextHandlerId++;
              HandlerEntry entry;
              entry.id = handlerId;
              entry.nodeId = nodeId;
              entry.event = event;
              entry.function = std::make_shared<facebook::jsi::Function>(obj.asFunction(runtime));
              state->handlers.emplace(handlerId, std::move(entry));
            }
          }
        }
        JniEnv env;
        if (!env.valid()) return Value::undefined();
        jstring jEvent = makeJString(env.get(), event);
        env->CallVoidMethod(state->uiShim, state->uiMethods.setHandler, nodeId, jEvent, static_cast<jlong>(handlerId));
        env->DeleteLocalRef(jEvent);
        logJniException(env.get(), "UIShim.setHandler");
        return Value(static_cast<double>(handlerId));
      });

  auto flush = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "flush"), 0,
      [weakState](Runtime &, const Value &, const Value *, size_t) -> Value {
        auto state = weakState.lock();
        if (!state) return facebook::jsi::Value::undefined();
        JniEnv env;
        if (!env.valid()) return Value::undefined();
        env->CallVoidMethod(state->uiShim, state->uiMethods.flush);
        logJniException(env.get(), "UIShim.flush");
        return facebook::jsi::Value::undefined();
      });
  auto setSurface = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setSurface"), 1,
      [weakState](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        if (count < 1 || !args[0].isNumber()) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "setSurface expects a numeric id");
          return Value::undefined();
        }
        int surfaceId = static_cast<int>(args[0].asNumber());
        JniEnv env;
        if (!env.valid()) return Value::undefined();
        env->CallVoidMethod(state->uiShim, state->uiMethods.setSurface, surfaceId);
        logJniException(env.get(), "UIShim.setSurface");
        return Value::undefined();
      });

  auto applyBatch = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "applyBatch"), 1,
      [weakState](Runtime &runtime, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        if (count < 1) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "applyBatch expects a JSON string argument");
          return Value::undefined();
        }
        std::string batchJson;
        if (args[0].isString()) {
          batchJson = args[0].getString(runtime).utf8(runtime);
        } else {
          batchJson = toJsonString(runtime, args[0]);
        }
        if (batchJson.empty()) {
          return Value::undefined();
        }
        JniEnv env;
        if (!env.valid()) return Value::undefined();
        jstring jBatchJson = makeJString(env.get(), batchJson);
        env->CallVoidMethod(state->uiShim, state->uiMethods.applyBatch, jBatchJson);
        env->DeleteLocalRef(jBatchJson);
        logJniException(env.get(), "UIShim.applyBatch");
        return Value::undefined();
      });

  facebook::jsi::Object ui(rt);
  ui.setProperty(rt, "createNode", createNode);
  ui.setProperty(rt, "setProp", setProp);
  ui.setProperty(rt, "setText", setText);
  ui.setProperty(rt, "insertChild", insertChild);
  ui.setProperty(rt, "removeChild", removeChild);
  ui.setProperty(rt, "removeNode", removeNode);
  ui.setProperty(rt, "setHandler", setHandler);
  ui.setProperty(rt, "flush", flush);
  ui.setProperty(rt, "setSurface", setSurface);
  ui.setProperty(rt, "applyBatch", applyBatch);

  rt.global().setProperty(rt, "__ui", std::move(ui));
}

void installTimers(std::shared_ptr<RuntimeState> state) {
  using namespace facebook::jsi;
  auto weakState = std::weak_ptr<RuntimeState>(state);
  auto &rt = *state->runtime;

  auto setTimeoutFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setTimeout"), 2,
      [weakState](Runtime &runtime, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        if (count < 1 || !args[0].isObject() || !args[0].asObject(runtime).isFunction(runtime)) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "setTimeout expects a function");
          return Value::undefined();
        }
        double delayMs = (count >= 2 && args[1].isNumber()) ? args[1].getNumber() : 0.0;
        int timerId;
        TimerEntry entry;
        entry.callback = std::make_shared<Function>(args[0].asObject(runtime).asFunction(runtime));
        entry.args.reserve(count >= 3 ? count - 2 : 0);
        for (size_t i = 2; i < count; ++i) {
          entry.args.emplace_back(runtime, args[i]);
        }
        {
          std::lock_guard<std::mutex> lock(state->mutex);
          timerId = state->nextTimerId++;
          entry.id = timerId;
          state->timers.emplace(timerId, std::move(entry));
        }
        JniEnv env;
        if (!env.valid()) {
          return Value(static_cast<double>(timerId));
        }
        jlong delay = static_cast<jlong>(delayMs <= 0 ? 0 : std::llround(delayMs));
        env->CallVoidMethod(state->timerShim, state->timerMethods.scheduleTimeout, timerId, delay);
        logJniException(env.get(), "TimerShim.scheduleTimeout");
        return Value(static_cast<double>(timerId));
      });

  auto clearTimeoutFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "clearTimeout"), 1,
      [weakState](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        if (count < 1 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int timerId = static_cast<int>(args[0].asNumber());
        {
          std::lock_guard<std::mutex> lock(state->mutex);
          state->timers.erase(timerId);
        }
        JniEnv env;
        if (env.valid()) {
          env->CallVoidMethod(state->timerShim, state->timerMethods.clearTimeout, timerId);
          logJniException(env.get(), "TimerShim.clearTimeout");
        }
        return Value::undefined();
      });

  auto setIntervalFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setInterval"), 2,
      [weakState](Runtime &runtime, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        if (count < 1 || !args[0].isObject() || !args[0].asObject(runtime).isFunction(runtime)) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "setInterval expects a function");
          return Value::undefined();
        }
        double delayMs = (count >= 2 && args[1].isNumber()) ? args[1].getNumber() : 0.0;
        if (delayMs < 1) delayMs = 1; // Minimum 1ms to prevent tight loops
        int timerId;
        TimerEntry entry;
        entry.callback = std::make_shared<Function>(args[0].asObject(runtime).asFunction(runtime));
        entry.args.reserve(count >= 3 ? count - 2 : 0);
        for (size_t i = 2; i < count; ++i) {
          entry.args.emplace_back(runtime, args[i]);
        }
        entry.isInterval = true;
        {
          std::lock_guard<std::mutex> lock(state->mutex);
          timerId = state->nextTimerId++;
          entry.id = timerId;
          state->timers.emplace(timerId, std::move(entry));
        }
        JniEnv env;
        if (!env.valid()) {
          return Value(static_cast<double>(timerId));
        }
        jlong delay = static_cast<jlong>(std::llround(delayMs));
        env->CallVoidMethod(state->timerShim, state->timerMethods.scheduleInterval, timerId, delay);
        logJniException(env.get(), "TimerShim.scheduleInterval");
        return Value(static_cast<double>(timerId));
      });

  auto clearIntervalFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "clearInterval"), 1,
      [weakState](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        if (count < 1 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int timerId = static_cast<int>(args[0].asNumber());
        {
          std::lock_guard<std::mutex> lock(state->mutex);
          state->timers.erase(timerId);
        }
        JniEnv env;
        if (env.valid()) {
          env->CallVoidMethod(state->timerShim, state->timerMethods.clearInterval, timerId);
          logJniException(env.get(), "TimerShim.clearInterval");
        }
        return Value::undefined();
      });

  auto queueMicrotaskFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "queueMicrotask"), 1,
      [weakState](Runtime &runtime, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        if (count < 1 || !args[0].isObject() || !args[0].asObject(runtime).isFunction(runtime)) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "queueMicrotask expects a function");
          return Value::undefined();
        }

        // THREAD-SAFE IMPLEMENTATION:
        // Leverage Hermes' built-in microtask queue via Promise.resolve().then()
        // This avoids JNI calls entirely and uses the engine's native scheduling.
        const Value &callbackValue = args[0];
        try {
          auto promiseValue = runtime.global().getProperty(
              runtime, facebook::jsi::PropNameID::forAscii(runtime, "Promise"));
          if (promiseValue.isObject()) {
            auto promiseObj = promiseValue.asObject(runtime);
            auto resolveFn = promiseObj.getPropertyAsFunction(runtime, "resolve");
            auto resolved = resolveFn.call(runtime);
            auto resolvedObj = resolved.asObject(runtime);
            auto thenFn = resolvedObj.getPropertyAsFunction(runtime, "then");
            Value callbackCopy(runtime, callbackValue);
            thenFn.callWithThis(runtime, resolvedObj, callbackCopy);
            return Value::undefined();
          }
        } catch (const facebook::jsi::JSError &err) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "queueMicrotask Promise failed: %s, using setTimeout fallback", err.getMessage().c_str());
        } catch (const std::exception &ex) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "queueMicrotask Promise failed: %s, using setTimeout fallback", ex.what());
        }

        // Fallback to setTimeout(callback, 0) - this goes through the timer system
        // which is thread-safe as the JNI call happens from the constructor context
        auto callback = std::make_shared<Function>(args[0].asObject(runtime).asFunction(runtime));
        int timerId;
        TimerEntry entry;
        entry.callback = callback;
        entry.args.clear();
        
        {
          std::lock_guard<std::mutex> lock(state->mutex);
          timerId = state->nextTimerId++;
          entry.id = timerId;
          state->timers.emplace(timerId, std::move(entry));
        }
        
        JniEnv env;
        if (env.valid()) {
          env->CallVoidMethod(state->timerShim, state->timerMethods.scheduleTimeout, timerId, 0L);
          logJniException(env.get(), "TimerShim.scheduleTimeout (queueMicrotask fallback)");
        } else {
          std::lock_guard<std::mutex> lock(state->mutex);
          state->timers.erase(timerId);
          BRIDGE_LOG(ANDROID_LOG_ERROR, "queueMicrotask: JNI not available");
        }
        
        return Value::undefined();
      });

  auto requestAnimationFrameFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "requestAnimationFrame"), 1,
      [weakState](Runtime &runtime, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        if (count < 1 || !args[0].isObject() || !args[0].asObject(runtime).isFunction(runtime)) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "requestAnimationFrame expects a function");
          return Value::undefined();
        }

        // THREAD-SAFE IMPLEMENTATION:
        // Check if JavaVM is initialized before attempting JNI calls.
        // If not available, we fall back to immediate execution.
        // The JSBridge.kt posts callbacks back to the JS thread, so this is safe
        // as long as the JNI environment can be obtained.
        
        auto callback = std::make_shared<Function>(args[0].asObject(runtime).asFunction(runtime));
        int frameId;
        {
          std::lock_guard<std::mutex> lock(state->mutex);
          frameId = state->nextAnimationFrameId++;
          state->animationFrames.emplace(frameId, callback);
        }

        // Check if JavaVM is available before creating JniEnv
        if (!gJavaVm) {
          BRIDGE_LOG(ANDROID_LOG_ERROR, "requestAnimationFrame: JavaVM not initialized, executing callback immediately");
          {
            std::lock_guard<std::mutex> lock(state->mutex);
            state->animationFrames.erase(frameId);
          }
          try {
            Value timestamp(0.0);
            callback->call(runtime, timestamp);
          } catch (const facebook::jsi::JSError &err) {
            reportJsError(state, err.getMessage(), err.getStack());
          } catch (const std::exception &ex) {
            reportJsError(state, ex.what(), "");
          }
          return Value(static_cast<double>(frameId));
        }

        JniEnv env;
        if (env.valid() && state->timerMethods.requestAnimationFrame) {
          env->CallVoidMethod(state->timerShim, state->timerMethods.requestAnimationFrame, frameId);
          logJniException(env.get(), "TimerShim.requestAnimationFrame");
        } else {
          // If JNI attach failed, clean up and execute callback immediately
          {
            std::lock_guard<std::mutex> lock(state->mutex);
            state->animationFrames.erase(frameId);
          }
          try {
            Value timestamp(0.0);
            callback->call(runtime, timestamp);
          } catch (const facebook::jsi::JSError &err) {
            reportJsError(state, err.getMessage(), err.getStack());
          } catch (const std::exception &ex) {
            reportJsError(state, ex.what(), "");
          }
          BRIDGE_LOG(ANDROID_LOG_WARN, "requestAnimationFrame: JNI attach failed, executed callback immediately");
        }

        return Value(static_cast<double>(frameId));
      });

  auto cancelAnimationFrameFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "cancelAnimationFrame"), 1,
      [weakState](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        if (count < 1 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int frameId = static_cast<int>(args[0].asNumber());
        {
          std::lock_guard<std::mutex> lock(state->mutex);
          state->animationFrames.erase(frameId);
        }
        JniEnv env;
        if (env.valid() && state->timerMethods.cancelAnimationFrame) {
          env->CallVoidMethod(state->timerShim, state->timerMethods.cancelAnimationFrame, frameId);
          logJniException(env.get(), "TimerShim.cancelAnimationFrame");
        }
        return Value::undefined();
      });

  rt.global().setProperty(rt, "setTimeout", setTimeoutFn);
  rt.global().setProperty(rt, "clearTimeout", clearTimeoutFn);
  rt.global().setProperty(rt, "setInterval", setIntervalFn);
  rt.global().setProperty(rt, "clearInterval", clearIntervalFn);
  rt.global().setProperty(rt, "setImmediate", setTimeoutFn);
  rt.global().setProperty(rt, "clearImmediate", clearTimeoutFn);
  rt.global().setProperty(rt, "queueMicrotask", queueMicrotaskFn);
  rt.global().setProperty(rt, "requestAnimationFrame", requestAnimationFrameFn);
  rt.global().setProperty(rt, "cancelAnimationFrame", cancelAnimationFrameFn);

  // Host timer functions for framework usage
  auto hostSetTimeoutFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostSetTimeout"), 3,
      [weakState](Runtime &runtime, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        if (count < 2 || !args[0].isObject() || !args[0].asObject(runtime).isFunction(runtime)) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "__hostSetTimeout expects (function, delay, ...args)");
          return Value::undefined();
        }
        double delayMs = args[1].isNumber() ? args[1].getNumber() : 0.0;
        int timerId;
        TimerEntry entry;
        entry.callback = std::make_shared<Function>(args[0].asObject(runtime).asFunction(runtime));
        
        // Handle args array if provided as third parameter
        if (count >= 3 && args[2].isObject()) {
          auto argsArray = args[2].asObject(runtime);
          if (argsArray.isArray(runtime)) {
            auto arrayLength = argsArray.getArray(runtime).length(runtime);
            entry.args.reserve(arrayLength);
            for (size_t i = 0; i < arrayLength; ++i) {
              entry.args.emplace_back(runtime, argsArray.getArray(runtime).getValueAtIndex(runtime, i));
            }
          }
        }
        
        {
          std::lock_guard<std::mutex> lock(state->mutex);
          timerId = state->nextTimerId++;
          entry.id = timerId;
          state->timers.emplace(timerId, std::move(entry));
        }
        JniEnv env;
        if (!env.valid()) {
          return Value(static_cast<double>(timerId));
        }
        jlong delay = static_cast<jlong>(delayMs <= 0 ? 0 : std::llround(delayMs));
        env->CallVoidMethod(state->timerShim, state->timerMethods.scheduleTimeout, timerId, delay);
        logJniException(env.get(), "TimerShim.scheduleTimeout");
        return Value(static_cast<double>(timerId));
      });

  auto hostClearTimeoutFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostClearTimeout"), 1,
      [weakState](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        if (count < 1 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int timerId = static_cast<int>(args[0].asNumber());
        {
          std::lock_guard<std::mutex> lock(state->mutex);
          state->timers.erase(timerId);
        }
        JniEnv env;
        if (env.valid()) {
          env->CallVoidMethod(state->timerShim, state->timerMethods.clearTimeout, timerId);
          logJniException(env.get(), "TimerShim.clearTimeout");
        }
        return Value::undefined();
      });

  auto hostSetIntervalFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostSetInterval"), 3,
      [weakState](Runtime &runtime, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        if (count < 2 || !args[0].isObject() || !args[0].asObject(runtime).isFunction(runtime)) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "__hostSetInterval expects (function, delay, ...args)");
          return Value::undefined();
        }
        double delayMs = args[1].isNumber() ? args[1].getNumber() : 0.0;
        if (delayMs < 1) delayMs = 1; // Minimum 1ms to prevent tight loops
        
        int timerId;
        TimerEntry entry;
        entry.callback = std::make_shared<Function>(args[0].asObject(runtime).asFunction(runtime));
        
        // Handle args array if provided as third parameter
        if (count >= 3 && args[2].isObject()) {
          auto argsArray = args[2].asObject(runtime);
          if (argsArray.isArray(runtime)) {
            auto arrayLength = argsArray.getArray(runtime).length(runtime);
            entry.args.reserve(arrayLength);
            for (size_t i = 0; i < arrayLength; ++i) {
              entry.args.emplace_back(runtime, argsArray.getArray(runtime).getValueAtIndex(runtime, i));
            }
          }
        }
        
        entry.isInterval = true;
        {
          std::lock_guard<std::mutex> lock(state->mutex);
          timerId = state->nextTimerId++;
          entry.id = timerId;
          state->timers.emplace(timerId, std::move(entry));
        }
        JniEnv env;
        if (!env.valid()) {
          return Value(static_cast<double>(timerId));
        }
        jlong delay = static_cast<jlong>(std::llround(delayMs));
        env->CallVoidMethod(state->timerShim, state->timerMethods.scheduleInterval, timerId, delay);
        logJniException(env.get(), "TimerShim.scheduleInterval");
        return Value(static_cast<double>(timerId));
      });

  auto hostClearIntervalFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostClearInterval"), 1,
      [weakState](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        if (count < 1 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int timerId = static_cast<int>(args[0].asNumber());
        {
          std::lock_guard<std::mutex> lock(state->mutex);
          state->timers.erase(timerId);
        }
        JniEnv env;
        if (env.valid()) {
          env->CallVoidMethod(state->timerShim, state->timerMethods.clearInterval, timerId);
          logJniException(env.get(), "TimerShim.clearInterval");
        }
        return Value::undefined();
      });

  rt.global().setProperty(rt, "__hostSetTimeout", hostSetTimeoutFn);
  rt.global().setProperty(rt, "__hostClearTimeout", hostClearTimeoutFn);
  rt.global().setProperty(rt, "__hostSetInterval", hostSetIntervalFn);
  rt.global().setProperty(rt, "__hostClearInterval", hostClearIntervalFn);
}

static double resolveMappedValue(
    const RuneMappedValue &value,
    const std::unordered_map<int, double> &sharedValues,
    double fallback) {
  if (!value.hasValue) return fallback;
  if (value.isShared) {
    auto it = sharedValues.find(value.sharedId);
    if (it != sharedValues.end()) {
      return it->second;
    }
    return fallback;
  }
  return value.numberValue;
}

static void applyStyleMapper(
    facebook::jsi::Runtime &rt,
    const std::shared_ptr<RuntimeState> &state,
    const RuneStyleMapper &mapper,
    const std::unordered_map<int, double> &sharedValues) {
  if (!state || !state->uiShim || !state->uiMethods.applyAnimatedStyle) {
    BRIDGE_LOG(ANDROID_LOG_WARN, "animate: applyStyleMapper missing UI shim or applyAnimatedStyle");
    return;
  }

  bool hasOpacity = mapper.opacity.hasValue;
  bool hasTransform =
      mapper.translateX.hasValue || mapper.translateY.hasValue ||
      mapper.scale.hasValue || mapper.scaleX.hasValue || mapper.scaleY.hasValue ||
      mapper.rotate.hasValue || mapper.rotateX.hasValue || mapper.rotateY.hasValue ||
      mapper.skewX.hasValue || mapper.skewY.hasValue || mapper.perspective.hasValue;

  if (!hasOpacity && !hasTransform) {
    BRIDGE_LOG(ANDROID_LOG_WARN, "animate: applyStyleMapper no mapped props");
    return;
  }

  // Resolve all animated values
  float opacity = hasOpacity ? static_cast<float>(resolveMappedValue(mapper.opacity, sharedValues, 1.0)) : 1.0f;
  float translateX = mapper.translateX.hasValue ? static_cast<float>(resolveMappedValue(mapper.translateX, sharedValues, 0.0)) : 0.0f;
  float translateY = mapper.translateY.hasValue ? static_cast<float>(resolveMappedValue(mapper.translateY, sharedValues, 0.0)) : 0.0f;
  
  // Handle scale: uniform scale or individual scaleX/scaleY
  float scaleX = 1.0f;
  float scaleY = 1.0f;
  if (mapper.scale.hasValue) {
    float uniformScale = static_cast<float>(resolveMappedValue(mapper.scale, sharedValues, 1.0));
    scaleX = uniformScale;
    scaleY = uniformScale;
  }
  if (mapper.scaleX.hasValue) {
    scaleX = static_cast<float>(resolveMappedValue(mapper.scaleX, sharedValues, 1.0));
  }
  if (mapper.scaleY.hasValue) {
    scaleY = static_cast<float>(resolveMappedValue(mapper.scaleY, sharedValues, 1.0));
  }
  
  float rotate = mapper.rotate.hasValue ? static_cast<float>(resolveMappedValue(mapper.rotate, sharedValues, 0.0)) : 0.0f;
  float rotateX = mapper.rotateX.hasValue ? static_cast<float>(resolveMappedValue(mapper.rotateX, sharedValues, 0.0)) : 0.0f;
  float rotateY = mapper.rotateY.hasValue ? static_cast<float>(resolveMappedValue(mapper.rotateY, sharedValues, 0.0)) : 0.0f;
  float skewX = mapper.skewX.hasValue ? static_cast<float>(resolveMappedValue(mapper.skewX, sharedValues, 0.0)) : 0.0f;
  float skewY = mapper.skewY.hasValue ? static_cast<float>(resolveMappedValue(mapper.skewY, sharedValues, 0.0)) : 0.0f;
  float perspective = mapper.perspective.hasValue
      ? static_cast<float>(resolveMappedValue(mapper.perspective, sharedValues, 0.0))
      : std::numeric_limits<float>::quiet_NaN();

  JniEnv env;
  if (!env.valid()) {
    BRIDGE_LOG(ANDROID_LOG_WARN, "animate: applyStyleMapper JNI env unavailable");
    return;
  }
  
  // Call applyAnimatedStyle directly - bypasses the batching system for immediate visual feedback
  env->CallVoidMethod(
      state->uiShim,
      state->uiMethods.applyAnimatedStyle,
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
      perspective
  );
  logJniException(env.get(), "UIShim.applyAnimatedStyle");
}

static void ensureNativeAnimationFrame(const std::shared_ptr<RuntimeState> &state) {
  if (!state) {
    BRIDGE_LOG(ANDROID_LOG_WARN, "animate: ensureNativeAnimationFrame no state");
    return;
  }
  if (state->nativeAnimationScheduled) return;
  JniEnv env;
  if (!env.valid() || !state->timerMethods.requestAnimationFrame) {
    BRIDGE_LOG(ANDROID_LOG_WARN, "animate: ensureNativeAnimationFrame no JNI/timer");
    return;
  }
  state->nativeAnimationScheduled = true;
  BRIDGE_LOG(ANDROID_LOG_INFO, "animate: schedule native frame id=%d", state->nativeAnimationFrameId);
  env->CallVoidMethod(state->timerShim, state->timerMethods.requestAnimationFrame, state->nativeAnimationFrameId);
  logJniException(env.get(), "TimerShim.requestAnimationFrame(native)");
}

static void stepNativeAnimations(
    facebook::jsi::Runtime &rt,
    const std::shared_ptr<RuntimeState> &state,
    double frameTimeMs) {
  if (!state) return;

  std::vector<RuneStyleMapper> mappers;
  std::unordered_map<int, double> sharedSnapshot;
  bool hasActive = false;

  {
    std::lock_guard<std::mutex> lock(state->mutex);
    if (state->sharedValues.empty()) {
      BRIDGE_LOG(ANDROID_LOG_INFO, "animate: stepNativeAnimations no shared values");
    }
    for (auto &entry : state->sharedValues) {
      auto &shared = entry.second;
      if (!shared.animating) continue;
      auto &anim = shared.animation;
      if (frameTimeMs < anim.startTimeMs) {
        hasActive = true;
        continue;
      }

      if (anim.kind == RuneSharedAnimationKind::Timing) {
        double duration = std::max(anim.durationMs, 1.0);
        double elapsed = frameTimeMs - anim.startTimeMs;
        double progress = std::min(elapsed / duration, 1.0);
        double eased = applyEasing(anim.easing, progress);
        shared.value = anim.fromValue + (anim.toValue - anim.fromValue) * eased;
        if (progress >= 1.0) {
          shared.value = anim.toValue;
          shared.animating = false;
        } else {
          hasActive = true;
        }
      } else {
        if (anim.lastTimeMs == 0.0) {
          anim.lastTimeMs = frameTimeMs;
          hasActive = true;
          continue;
        }
        double delta = std::min(frameTimeMs - anim.lastTimeMs, 64.0);
        anim.lastTimeMs = frameTimeMs;
        double dt = delta / 1000.0;
        double displacement = shared.value - anim.toValue;
        double springForce = -anim.stiffness * displacement;
        double dampingForce = -anim.damping * anim.velocity;
        double acceleration = (springForce + dampingForce) / anim.mass;
        anim.velocity += acceleration * dt;
        shared.value += anim.velocity * dt;

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

    for (const auto &entry : state->sharedValues) {
      sharedSnapshot.emplace(entry.first, entry.second.value);
    }
    for (const auto &entry : state->styleMappers) {
      mappers.push_back(entry.second);
    }
  }

  for (const auto &mapper : mappers) {
    applyStyleMapper(rt, state, mapper, sharedSnapshot);
  }

  if (hasActive) {
    ensureNativeAnimationFrame(state);
  } else {
    BRIDGE_LOG(ANDROID_LOG_INFO, "animate: stepNativeAnimations completed");
  }
}

void installAnimateBindings(std::shared_ptr<RuntimeState> state) {
  using namespace facebook::jsi;
  auto weakState = std::weak_ptr<RuntimeState>(state);
  auto &rt = *state->runtime;

  auto createSharedValue = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "createSharedValue"), 1,
      [weakState](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "animate: createSharedValue no state");
          return Value::undefined();
        }
        double initial = (count > 0 && args[0].isNumber()) ? args[0].asNumber() : 0.0;
        int id;
        {
          std::lock_guard<std::mutex> lock(state->mutex);
          id = state->nextSharedValueId++;
          RuneSharedValue shared;
          shared.value = initial;
          state->sharedValues[id] = shared;
        }
        BRIDGE_LOG(ANDROID_LOG_INFO, "animate: createSharedValue id=%d initial=%.3f", id, initial);
        return Value(static_cast<double>(id));
      });

  auto getSharedValue = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "getSharedValue"), 1,
      [weakState](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state || count < 1 || !args[0].isNumber()) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "animate: getSharedValue invalid args/state");
          return Value::undefined();
        }
        int id = static_cast<int>(args[0].asNumber());
        std::lock_guard<std::mutex> lock(state->mutex);
        auto it = state->sharedValues.find(id);
        if (it == state->sharedValues.end()) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "animate: getSharedValue missing id=%d", id);
          return Value::undefined();
        }
        return Value(it->second.value);
      });

  auto setSharedValue = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setSharedValue"), 2,
      [weakState](Runtime &runtime, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state || count < 2 || !args[0].isNumber() || !args[1].isNumber()) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "animate: setSharedValue invalid args/state");
          return Value::undefined();
        }
        int id = static_cast<int>(args[0].asNumber());
        double value = args[1].asNumber();
        {
          std::lock_guard<std::mutex> lock(state->mutex);
          auto it = state->sharedValues.find(id);
          if (it == state->sharedValues.end()) {
            BRIDGE_LOG(ANDROID_LOG_WARN, "animate: setSharedValue missing id=%d", id);
            return Value::undefined();
          }
          it->second.value = value;
          it->second.animating = false;
        }
        BRIDGE_LOG(ANDROID_LOG_INFO, "animate: setSharedValue id=%d value=%.3f", id, value);
        std::vector<RuneStyleMapper> mappers;
        std::unordered_map<int, double> snapshot;
        {
          std::lock_guard<std::mutex> lock(state->mutex);
          for (const auto &entry : state->sharedValues) {
            snapshot.emplace(entry.first, entry.second.value);
          }
          for (const auto &entry : state->styleMappers) {
            mappers.push_back(entry.second);
          }
        }
        for (const auto &mapper : mappers) {
          applyStyleMapper(runtime, state, mapper, snapshot);
        }
        return Value::undefined();
      });

  auto cancelSharedValue = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "cancelSharedValue"), 1,
      [weakState](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state || count < 1 || !args[0].isNumber()) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "animate: cancelSharedValue invalid args/state");
          return Value::undefined();
        }
        int id = static_cast<int>(args[0].asNumber());
        std::lock_guard<std::mutex> lock(state->mutex);
        auto it = state->sharedValues.find(id);
        if (it != state->sharedValues.end()) {
          it->second.animating = false;
        }
        BRIDGE_LOG(ANDROID_LOG_INFO, "animate: cancelSharedValue id=%d", id);
        return Value::undefined();
      });

  auto animateSharedValue = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "animateSharedValue"), 2,
      [weakState](Runtime &runtime, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state || count < 2 || !args[0].isNumber() || !args[1].isObject()) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "animate: animateSharedValue invalid args/state");
          return Value::undefined();
        }
        int id = static_cast<int>(args[0].asNumber());
        auto config = args[1].getObject(runtime);

        auto typeValue = config.getProperty(runtime, "type");
        auto toValueValue = config.getProperty(runtime, "toValue");
        if (!typeValue.isString() || !toValueValue.isNumber()) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "animate: animateSharedValue missing type/toValue");
          return Value::undefined();
        }
        std::string type = typeValue.getString(runtime).utf8(runtime);
        double toValue = toValueValue.asNumber();

        RuneSharedValueAnimation animation;
        animation.toValue = toValue;
        animation.startTimeMs = monotonicTimeMs();

        if (config.hasProperty(runtime, "delay")) {
          auto delayValue = config.getProperty(runtime, "delay");
          if (delayValue.isNumber()) animation.startTimeMs += delayValue.asNumber();
        }
        if (config.hasProperty(runtime, "duration")) {
          auto durationValue = config.getProperty(runtime, "duration");
          if (durationValue.isNumber()) animation.durationMs = std::max(durationValue.asNumber(), 0.0);
        } else {
          animation.durationMs = 300.0;
        }
        if (config.hasProperty(runtime, "easing")) {
          auto easingValue = config.getProperty(runtime, "easing");
          if (easingValue.isString()) animation.easing = parseEasing(easingValue.getString(runtime).utf8(runtime));
        }

        {
          std::lock_guard<std::mutex> lock(state->mutex);
          auto it = state->sharedValues.find(id);
          if (it == state->sharedValues.end()) {
            BRIDGE_LOG(ANDROID_LOG_WARN, "animate: animateSharedValue missing id=%d", id);
            return Value::undefined();
          }
          animation.fromValue = it->second.value;
          if (type == "timing") {
            animation.kind = RuneSharedAnimationKind::Timing;
          } else {
            animation.kind = RuneSharedAnimationKind::Spring;
            if (config.hasProperty(runtime, "damping")) {
              auto value = config.getProperty(runtime, "damping");
              if (value.isNumber()) animation.damping = value.asNumber();
            }
            if (config.hasProperty(runtime, "stiffness")) {
              auto value = config.getProperty(runtime, "stiffness");
              if (value.isNumber()) animation.stiffness = value.asNumber();
            }
            if (config.hasProperty(runtime, "mass")) {
              auto value = config.getProperty(runtime, "mass");
              if (value.isNumber()) animation.mass = value.asNumber();
            }
            if (config.hasProperty(runtime, "velocity")) {
              auto value = config.getProperty(runtime, "velocity");
              if (value.isNumber()) animation.velocity = value.asNumber();
            }
            if (config.hasProperty(runtime, "restSpeedThreshold")) {
              auto value = config.getProperty(runtime, "restSpeedThreshold");
              if (value.isNumber()) animation.restSpeed = value.asNumber();
            }
            if (config.hasProperty(runtime, "restDisplacementThreshold")) {
              auto value = config.getProperty(runtime, "restDisplacementThreshold");
              if (value.isNumber()) animation.restDisplacement = value.asNumber();
            }
            if (config.hasProperty(runtime, "overshootClamping")) {
              auto value = config.getProperty(runtime, "overshootClamping");
              if (value.isBool()) animation.overshootClamping = value.getBool();
            }
          }
          it->second.animation = animation;
          it->second.animating = true;
        }

        BRIDGE_LOG(ANDROID_LOG_INFO, "animate: animateSharedValue id=%d type=%s to=%.3f", id, type.c_str(), toValue);
        ensureNativeAnimationFrame(state);
        return Value::undefined();
      });

  auto createStyleMapper = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "createStyleMapper"), 2,
      [weakState](Runtime &runtime, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state || count < 2 || !args[0].isNumber() || !args[1].isObject()) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "animate: createStyleMapper invalid args/state");
          return Value::undefined();
        }
        int nodeId = static_cast<int>(args[0].asNumber());
        auto styleObj = args[1].getObject(runtime);

        RuneStyleMapper mapper;
        {
          std::lock_guard<std::mutex> lock(state->mutex);
          mapper.id = state->nextStyleMapperId++;
        }
        mapper.nodeId = nodeId;

        if (styleObj.hasProperty(runtime, "opacity")) {
          parseMappedValue(runtime, styleObj.getProperty(runtime, "opacity"), mapper.opacity);
        }
        if (styleObj.hasProperty(runtime, "transform")) {
          auto transformValue = styleObj.getProperty(runtime, "transform");
          if (transformValue.isObject() && transformValue.getObject(runtime).isArray(runtime)) {
            auto array = transformValue.getObject(runtime).getArray(runtime);
            size_t length = array.size(runtime);
            for (size_t i = 0; i < length; ++i) {
              auto entryValue = array.getValueAtIndex(runtime, i);
              if (!entryValue.isObject()) continue;
              auto entry = entryValue.getObject(runtime);
              auto keys = entry.getPropertyNames(runtime);
              size_t keyCount = keys.size(runtime);
              for (size_t k = 0; k < keyCount; ++k) {
                auto keyValue = keys.getValueAtIndex(runtime, k);
                if (!keyValue.isString()) continue;
                std::string key = keyValue.getString(runtime).utf8(runtime);
                auto propValue = entry.getProperty(runtime, key.c_str());
                if (key == "translateX") parseMappedValue(runtime, propValue, mapper.translateX);
                else if (key == "translateY") parseMappedValue(runtime, propValue, mapper.translateY);
                else if (key == "scale") parseMappedValue(runtime, propValue, mapper.scale);
                else if (key == "scaleX") parseMappedValue(runtime, propValue, mapper.scaleX);
                else if (key == "scaleY") parseMappedValue(runtime, propValue, mapper.scaleY);
                else if (key == "rotate" || key == "rotateZ") parseMappedValue(runtime, propValue, mapper.rotate, true);
                else if (key == "rotateX") parseMappedValue(runtime, propValue, mapper.rotateX, true);
                else if (key == "rotateY") parseMappedValue(runtime, propValue, mapper.rotateY, true);
                else if (key == "skewX") parseMappedValue(runtime, propValue, mapper.skewX, true);
                else if (key == "skewY") parseMappedValue(runtime, propValue, mapper.skewY, true);
                else if (key == "perspective") parseMappedValue(runtime, propValue, mapper.perspective);
              }
            }
          }
        }

        {
          std::lock_guard<std::mutex> lock(state->mutex);
          state->styleMappers[mapper.id] = mapper;
        }
        BRIDGE_LOG(ANDROID_LOG_INFO, "animate: createStyleMapper id=%d node=%d", mapper.id, nodeId);

        std::unordered_map<int, double> snapshot;
        {
          std::lock_guard<std::mutex> lock(state->mutex);
          for (const auto &entry : state->sharedValues) {
            snapshot.emplace(entry.first, entry.second.value);
          }
        }
        applyStyleMapper(runtime, state, mapper, snapshot);

        return Value(static_cast<double>(mapper.id));
      });

  auto updateStyleMapper = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "updateStyleMapper"), 2,
      [weakState](Runtime &runtime, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state || count < 2 || !args[0].isNumber() || !args[1].isObject()) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "animate: updateStyleMapper invalid args/state");
          return Value::undefined();
        }
        int mapperId = static_cast<int>(args[0].asNumber());
        auto styleObj = args[1].getObject(runtime);

        RuneStyleMapper mapper;
        {
          std::lock_guard<std::mutex> lock(state->mutex);
          auto it = state->styleMappers.find(mapperId);
          if (it == state->styleMappers.end()) {
            BRIDGE_LOG(ANDROID_LOG_WARN, "animate: updateStyleMapper missing id=%d", mapperId);
            return Value::undefined();
          }
          mapper = it->second;
        }

        mapper.opacity = RuneMappedValue();
        mapper.translateX = RuneMappedValue();
        mapper.translateY = RuneMappedValue();
        mapper.scale = RuneMappedValue();
        mapper.scaleX = RuneMappedValue();
        mapper.scaleY = RuneMappedValue();
        mapper.rotate = RuneMappedValue();
        mapper.rotateX = RuneMappedValue();
        mapper.rotateY = RuneMappedValue();
        mapper.skewX = RuneMappedValue();
        mapper.skewY = RuneMappedValue();
        mapper.perspective = RuneMappedValue();

        if (styleObj.hasProperty(runtime, "opacity")) {
          parseMappedValue(runtime, styleObj.getProperty(runtime, "opacity"), mapper.opacity);
        }
        if (styleObj.hasProperty(runtime, "transform")) {
          auto transformValue = styleObj.getProperty(runtime, "transform");
          if (transformValue.isObject() && transformValue.getObject(runtime).isArray(runtime)) {
            auto array = transformValue.getObject(runtime).getArray(runtime);
            size_t length = array.size(runtime);
            for (size_t i = 0; i < length; ++i) {
              auto entryValue = array.getValueAtIndex(runtime, i);
              if (!entryValue.isObject()) continue;
              auto entry = entryValue.getObject(runtime);
              auto keys = entry.getPropertyNames(runtime);
              size_t keyCount = keys.size(runtime);
              for (size_t k = 0; k < keyCount; ++k) {
                auto keyValue = keys.getValueAtIndex(runtime, k);
                if (!keyValue.isString()) continue;
                std::string key = keyValue.getString(runtime).utf8(runtime);
                auto propValue = entry.getProperty(runtime, key.c_str());
                if (key == "translateX") parseMappedValue(runtime, propValue, mapper.translateX);
                else if (key == "translateY") parseMappedValue(runtime, propValue, mapper.translateY);
                else if (key == "scale") parseMappedValue(runtime, propValue, mapper.scale);
                else if (key == "scaleX") parseMappedValue(runtime, propValue, mapper.scaleX);
                else if (key == "scaleY") parseMappedValue(runtime, propValue, mapper.scaleY);
                else if (key == "rotate" || key == "rotateZ") parseMappedValue(runtime, propValue, mapper.rotate, true);
                else if (key == "rotateX") parseMappedValue(runtime, propValue, mapper.rotateX, true);
                else if (key == "rotateY") parseMappedValue(runtime, propValue, mapper.rotateY, true);
                else if (key == "skewX") parseMappedValue(runtime, propValue, mapper.skewX, true);
                else if (key == "skewY") parseMappedValue(runtime, propValue, mapper.skewY, true);
                else if (key == "perspective") parseMappedValue(runtime, propValue, mapper.perspective);
              }
            }
          }
        }

        {
          std::lock_guard<std::mutex> lock(state->mutex);
          state->styleMappers[mapperId] = mapper;
        }
        BRIDGE_LOG(ANDROID_LOG_INFO, "animate: updateStyleMapper id=%d", mapperId);

        std::unordered_map<int, double> snapshot;
        {
          std::lock_guard<std::mutex> lock(state->mutex);
          for (const auto &entry : state->sharedValues) {
            snapshot.emplace(entry.first, entry.second.value);
          }
        }
        applyStyleMapper(runtime, state, mapper, snapshot);

        return Value::undefined();
      });

  auto removeStyleMapper = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "removeStyleMapper"), 1,
      [weakState](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state || count < 1 || !args[0].isNumber()) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "animate: removeStyleMapper invalid args/state");
          return Value::undefined();
        }
        int mapperId = static_cast<int>(args[0].asNumber());
        std::lock_guard<std::mutex> lock(state->mutex);
        state->styleMappers.erase(mapperId);
        BRIDGE_LOG(ANDROID_LOG_INFO, "animate: removeStyleMapper id=%d", mapperId);
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
  rt.global().setProperty(rt, "__rune_animate", animate);
}

jobject jsiValueToJObject(facebook::jsi::Runtime &rt, JNIEnv *env, const facebook::jsi::Value &value);

jobjectArray jsiArrayToJObjectArray(facebook::jsi::Runtime &rt, JNIEnv *env, const facebook::jsi::Array &array) {
    jsize size = array.size(rt);
    jclass objectClass = env->FindClass("java/lang/Object");
    jobjectArray objArray = env->NewObjectArray(size, objectClass, nullptr);
    for (jsize i = 0; i < size; ++i) {
        jobject element = jsiValueToJObject(rt, env, array.getValueAtIndex(rt, i));
        env->SetObjectArrayElement(objArray, i, element);
        env->DeleteLocalRef(element);
    }
    return objArray;
}

jobject jsiObjectToJObjectMap(facebook::jsi::Runtime &rt, JNIEnv *env, const facebook::jsi::Object &obj) {
    jclass mapClass = env->FindClass("java/util/HashMap");
    jmethodID mapConstructor = env->GetMethodID(mapClass, "<init>", "()V");
    jobject map = env->NewObject(mapClass, mapConstructor);
    jmethodID putMethod = env->GetMethodID(mapClass, "put", "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;");

    facebook::jsi::Array propertyNames = obj.getPropertyNames(rt);
    size_t size = propertyNames.size(rt);
    for (size_t i = 0; i < size; ++i) {
        facebook::jsi::String propName = propertyNames.getValueAtIndex(rt, i).toString(rt);
        jstring key = env->NewStringUTF(propName.utf8(rt).c_str());
        jobject value = jsiValueToJObject(rt, env, obj.getProperty(rt, propName));
        env->CallObjectMethod(map, putMethod, key, value);
        env->DeleteLocalRef(key);
        env->DeleteLocalRef(value);
    }
    return map;
}

jobject jsiValueToJObject(facebook::jsi::Runtime &rt, JNIEnv *env, const facebook::jsi::Value &value) {
    if (value.isUndefined() || value.isNull()) {
        return nullptr;
    }
    if (value.isBool()) {
        jclass booleanClass = env->FindClass("java/lang/Boolean");
        jmethodID constructor = env->GetMethodID(booleanClass, "<init>", "(Z)V");
        return env->NewObject(booleanClass, constructor, value.getBool());
    }
    if (value.isNumber()) {
        jclass doubleClass = env->FindClass("java/lang/Double");
        jmethodID constructor = env->GetMethodID(doubleClass, "<init>", "(D)V");
        return env->NewObject(doubleClass, constructor, value.getNumber());
    }
    if (value.isString()) {
        return env->NewStringUTF(value.getString(rt).utf8(rt).c_str());
    }
    if (value.isObject()) {
        auto obj = value.getObject(rt);
        if (obj.isArrayBuffer(rt)) {
            auto arrayBuffer = obj.getArrayBuffer(rt);
            return env->NewDirectByteBuffer(const_cast<uint8_t*>(arrayBuffer.data(rt)), arrayBuffer.size(rt));
        }
        if (obj.isArray(rt)) {
            return jsiArrayToJObjectArray(rt, env, obj.getArray(rt));
        }
        if (obj.isFunction(rt)) {
            // Functions are not supported
            return nullptr;
        }
        return jsiObjectToJObjectMap(rt, env, obj);
    }
    return nullptr;
}

void installModules(std::shared_ptr<RuntimeState> state) {
  using namespace facebook::jsi;
  auto weakState = std::weak_ptr<RuntimeState>(state);
  auto &rt = *state->runtime;

  auto callFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "call"), 3,
      [weakState](Runtime &runtime, const Value &, const Value *args, size_t count) -> Value {
        auto state = weakState.lock();
        if (!state) return Value::undefined();
        if (count < 2 || !args[0].isString() || !args[1].isString()) {
          BRIDGE_LOG(ANDROID_LOG_WARN, "__modules.call expects (module, method, args)");
          return Value::undefined();
        }
        std::string moduleName = args[0].getString(runtime).utf8(runtime);
        std::string methodName = args[1].getString(runtime).utf8(runtime);

        auto capturedArgs = std::make_shared<std::vector<Value>>();
        if (count > 2) {
            capturedArgs->reserve(count - 2);
            for (size_t i = 2; i < count; ++i) {
                capturedArgs->emplace_back(runtime, args[i]);
            }
        }

        return makePromise(runtime, [weakState, moduleName, methodName, capturedArgs](Function &&resolve, Function &&reject) {
          if (auto state = weakState.lock()) {
            int promiseId;
            {
              std::lock_guard<std::mutex> lock(state->mutex);
              promiseId = state->nextPromiseId++;
              PromiseEntry entry;
              entry.resolve = std::make_shared<Function>(std::move(resolve));
              entry.reject = std::make_shared<Function>(std::move(reject));
              state->promises.emplace(promiseId, std::move(entry));
            }
            // BRIDGE_LOG(ANDROID_LOG_INFO, "ModulesShim.invoke -> promiseId=%d", promiseId);
            JniEnv env;
            if (!env.valid()) return;
            jstring jModule = makeJString(env.get(), moduleName);
            jstring jMethod = makeJString(env.get(), methodName);
            jclass objectClass = env->FindClass("java/lang/Object");

            jobjectArray argsArray = env->NewObjectArray(capturedArgs->size(), objectClass, nullptr);
            for (size_t i = 0; i < capturedArgs->size(); ++i) {
                jobject jniArg = jsiValueToJObject(*state->runtime, env.get(), (*capturedArgs)[i]);
                env->SetObjectArrayElement(argsArray, i, jniArg);
                env->DeleteLocalRef(jniArg);
            }

            env->CallVoidMethod(state->modulesShim, state->moduleMethods.invoke, jModule, jMethod, argsArray, promiseId);
            env->DeleteLocalRef(argsArray);
            env->DeleteLocalRef(jModule);
            env->DeleteLocalRef(jMethod);
            logJniException(env.get(), "ModulesShim.invoke");
          }
        });
      });

    facebook::jsi::Object modules(rt);
    modules.setProperty(rt, "call", callFn);
    auto callSyncFn = Function::createFromHostFunction(
        rt, PropNameID::forAscii(rt, "callSync"), 3,
        [weakState](Runtime &runtime, const Value &, const Value *args, size_t count) -> Value {
            try {
                auto state = weakState.lock();
                if (!state) {
                    return Value::undefined();
                }
                if (count < 2 || !args[0].isString() || !args[1].isString()) {
                    throw facebook::jsi::JSError(runtime, "__modules.callSync requires module and method strings");
                }

                std::string moduleName = args[0].getString(runtime).utf8(runtime);
                std::string methodName = args[1].getString(runtime).utf8(runtime);

                JniEnv env;
                if (!env.valid()) {
                    throw facebook::jsi::JSError(runtime, "JNI environment unavailable for callSync");
                }

                jstring jModule = makeJString(env.get(), moduleName);
                jstring jMethod = makeJString(env.get(), methodName);

                jclass objectClass = env->FindClass("java/lang/Object");
                const size_t argCount = count > 2 ? (count - 2) : 0;
                jobjectArray argsArray = env->NewObjectArray(static_cast<jsize>(argCount), objectClass, nullptr);
                for (size_t i = 0; i < argCount; ++i) {
                    jobject jniArg = jsiValueToJObject(runtime, env.get(), args[i + 2]);
                    env->SetObjectArrayElement(argsArray, static_cast<jsize>(i), jniArg);
                    env->DeleteLocalRef(jniArg);
                }

                jobject result = env->CallObjectMethod(
                    state->modulesShim,
                    state->moduleMethods.callSync,
                    jModule,
                    jMethod,
                    argsArray);

                env->DeleteLocalRef(argsArray);

                if (env->ExceptionCheck()) {
                    jthrowable throwable = env->ExceptionOccurred();
                    env->ExceptionClear();
                    std::string message = getThrowableMessage(env.get(), throwable);
                    if (throwable) {
                        env->DeleteLocalRef(throwable);
                    }
                    env->DeleteLocalRef(jModule);
                    env->DeleteLocalRef(jMethod);
                    throw facebook::jsi::JSError(runtime, message.empty() ? "Native sync call failed" : message);
                }

                return javaObjectToJsValue(runtime, env.get(), result, 
                    env->FindClass("java/lang/Integer"), env->GetMethodID(env->FindClass("java/lang/Integer"), "intValue", "()I"),
                    env->FindClass("java/lang/Double"), env->GetMethodID(env->FindClass("java/lang/Double"), "doubleValue", "()D"),
                    env->FindClass("java/lang/Boolean"), env->GetMethodID(env->FindClass("java/lang/Boolean"), "booleanValue", "()Z"),
                    env->FindClass("java/lang/String"));

            } catch (const facebook::jsi::JSError &error) {
                RuneReportJSIError(runtime, error, "__modules.callSync");
                throw;
            } catch (const std::exception &ex) {
                auto message = ex.what() ? ex.what() : "callSync failed";
                throw facebook::jsi::JSError(runtime, message);
            }
        });

    modules.setProperty(rt, "callSync", callSyncFn);
    rt.global().setProperty(rt, "__modules", modules);
    rt.global().setProperty(rt, "__runeCallSync", callSyncFn);
}

void cleanupState(std::shared_ptr<RuntimeState> state) {
  if (!state) return;
  JniEnv env;
  if (!env.valid()) return;
  if (state->uiShim) env->DeleteGlobalRef(state->uiShim);
  if (state->modulesShim) env->DeleteGlobalRef(state->modulesShim);
  if (state->timerShim) env->DeleteGlobalRef(state->timerShim);
  if (state->errorHandler) env->DeleteGlobalRef(state->errorHandler);
  if (state->uiClass) env->DeleteGlobalRef(state->uiClass);
  if (state->modulesClass) env->DeleteGlobalRef(state->modulesClass);
  if (state->timerClass) env->DeleteGlobalRef(state->timerClass);
  if (state->errorHandlerClass) env->DeleteGlobalRef(state->errorHandlerClass);
}

} // namespace

void installUnhandledPromiseReporting(std::shared_ptr<RuntimeState> state) {
  using namespace facebook::jsi;
  auto &rt = *state->runtime;
  
  auto reportUnhandled = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostReportUnhandled"), 2,
      [](Runtime &rt, const Value &, const Value *a, size_t count) -> Value {
        std::string message = (count > 0 && a[0].isString()) ? a[0].getString(rt).utf8(rt) : "";
        std::string stack = (count > 1 && a[1].isString()) ? a[1].getString(rt).utf8(rt) : "";
        if (message.empty()) {
          message = "Unhandled promise rejection";
        }
        
        JniEnv env;
        if (!env.valid()) {
          BRIDGE_LOG(ANDROID_LOG_ERROR, "[unhandled] %s", message.c_str());
          return Value::undefined();
        }
        
        jstring jPhase = env->NewStringUTF("unhandled");
        jstring jMessage = env->NewStringUTF(message.c_str());
        jstring jStack = env->NewStringUTF(stack.c_str());
        
        // Call the JNI bridge to RuneDiagnostics
        jclass runeDiagClass = env->FindClass("com/rune/kit/dev/RuneDiagnosticsKt");
        if (runeDiagClass) {
          jmethodID reportMethod = env->GetStaticMethodID(
              runeDiagClass, 
              "runeDiagnosticsReportJNI", 
              "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V");
          if (reportMethod) {
            env->CallStaticVoidMethod(runeDiagClass, reportMethod, jPhase, jMessage, jStack);
          }
          env->DeleteLocalRef(runeDiagClass);
        }
        
        if (jPhase) env->DeleteLocalRef(jPhase);
        if (jMessage) env->DeleteLocalRef(jMessage);
        if (jStack) env->DeleteLocalRef(jStack);
        
        return Value::undefined();
      });

  rt.global().setProperty(rt, "__hostReportUnhandled", reportUnhandled);

  // Install the Promise rejection shim based on iOS implementation
  const char *js = R"JS(
    (function(){
      if (globalThis.__rune && __rune._uh_installed) return;
      globalThis.__rune = globalThis.__rune || {};
      __rune._uh_installed = true;
      const _then = Promise.prototype.then;
      const _catch = Promise.prototype.catch;
      const _seen = new WeakSet();
      Promise.prototype.then = function(onFulfilled, onRejected){
        const p = _then.call(this, onFulfilled, onRejected);
        try {
          if (!_seen.has(p)) {
            _seen.add(p);
            _catch.call(p, function(e){
              try {
                __hostReportUnhandled(String(e?.message || e), String(e?.stack || ""));
              } catch (_) {}
            });
          }
        } catch (_) {}
        return p;
      };
    })();
  )JS";

  auto buffer = std::make_shared<StringBuffer>(js);
  rt.evaluateJavaScript(buffer, "rune-unhandled.js");
}

void setJavaVm(JavaVM *vm) {
  gJavaVm = vm;
}

void installBindings(
    facebook::hermes::HermesRuntime *runtime,
    JNIEnv *env,
    jobject uiShim,
    jobject modulesShim,
    jobject timerShim,
    jobject errorHandler) {
  if (!runtime || !env || !uiShim || !modulesShim || !timerShim || !errorHandler) {
    BRIDGE_LOG(ANDROID_LOG_ERROR, "installBindings received null arguments");
    return;
  }

  auto state = std::make_shared<RuntimeState>();
  state->runtime = runtime;
  state->uiShim = env->NewGlobalRef(uiShim);
  state->modulesShim = env->NewGlobalRef(modulesShim);
  state->timerShim = env->NewGlobalRef(timerShim);
  state->errorHandler = env->NewGlobalRef(errorHandler);
  state->uiClass = static_cast<jclass>(env->NewGlobalRef(env->GetObjectClass(uiShim)));
  state->modulesClass = static_cast<jclass>(env->NewGlobalRef(env->GetObjectClass(modulesShim)));
  state->timerClass = static_cast<jclass>(env->NewGlobalRef(env->GetObjectClass(timerShim)));
  state->errorHandlerClass = static_cast<jclass>(env->NewGlobalRef(env->GetObjectClass(errorHandler)));

  state->uiMethods.createNode = env->GetMethodID(state->uiClass, "createNode", "(Ljava/lang/String;)I");
  state->uiMethods.setProp = env->GetMethodID(state->uiClass, "setProp", "(ILjava/lang/String;Ljava/lang/String;)V");
  state->uiMethods.setText = env->GetMethodID(state->uiClass, "setText", "(ILjava/lang/String;)V");
  state->uiMethods.insertChild = env->GetMethodID(state->uiClass, "insertChild", "(III)V");
  state->uiMethods.removeChild = env->GetMethodID(state->uiClass, "removeChild", "(II)V");
  state->uiMethods.removeNode = env->GetMethodID(state->uiClass, "removeNode", "(I)V");
  state->uiMethods.setHandler = env->GetMethodID(state->uiClass, "setHandler", "(ILjava/lang/String;J)V");
  state->uiMethods.flush = env->GetMethodID(state->uiClass, "flush", "()V");
  state->uiMethods.dequeueEventPayload = env->GetMethodID(state->uiClass, "dequeueEventPayload", "(ILjava/lang/String;)Ljava/lang/String;");
  state->uiMethods.setSurface = env->GetMethodID(state->uiClass, "setSurface", "(I)V");
  state->uiMethods.applyBatch = env->GetMethodID(state->uiClass, "applyBatch", "(Ljava/lang/String;)V");
  state->uiMethods.applyAnimatedStyle = env->GetMethodID(state->uiClass, "applyAnimatedStyle", "(IFFFFFFFFFFF)V");

  state->moduleMethods.getConstants = env->GetMethodID(state->modulesClass, "getConstants", "()Ljava/lang/String;");
  state->moduleMethods.invoke = env->GetMethodID(state->modulesClass, "invoke", "(Ljava/lang/String;Ljava/lang/String;[Ljava/lang/Object;I)V");
  state->moduleMethods.callSync = env->GetMethodID(state->modulesClass, "callSync", "(Ljava/lang/String;Ljava/lang/String;[Ljava/lang/Object;)Ljava/lang/Object;");

  state->timerMethods.scheduleTimeout = env->GetMethodID(state->timerClass, "scheduleTimeout", "(IJ)V");
  state->timerMethods.clearTimeout = env->GetMethodID(state->timerClass, "clearTimeout", "(I)V");
  state->timerMethods.scheduleInterval = env->GetMethodID(state->timerClass, "scheduleInterval", "(IJ)V");
  state->timerMethods.clearInterval = env->GetMethodID(state->timerClass, "clearInterval", "(I)V");
  state->timerMethods.requestAnimationFrame = env->GetMethodID(state->timerClass, "requestAnimationFrame", "(I)V");
  state->timerMethods.cancelAnimationFrame = env->GetMethodID(state->timerClass, "cancelAnimationFrame", "(I)V");

  state->reportError = env->GetMethodID(state->errorHandlerClass, "report", "(Ljava/lang/String;Ljava/lang/String;)V");

  storeState(runtime, state);

  if (state->moduleMethods.getConstants) {
    jstring constantsJson = (jstring)env->CallObjectMethod(state->modulesShim, state->moduleMethods.getConstants);
    std::string constantsStr = getUtfString(env, constantsJson);
    if (!constantsStr.empty() && constantsStr != "{}") {
        try {
            runtime->global().setProperty(*runtime, "NativeConstants", parseJson(*runtime, constantsStr));
        } catch (const std::exception& e) {
            BRIDGE_LOG(ANDROID_LOG_ERROR, "Failed to parse and set NativeConstants: %s", e.what());
        }
    }
  }

  installConsole(state);
  installPlatformFlag(state);
  installUIBindings(state);
  installModules(state);
  installAnimateBindings(state);
  installTimers(state);
  installUnhandledPromiseReporting(state);

  BRIDGE_LOG(ANDROID_LOG_INFO, "Hermes bindings installed");
}

void evaluateString(
    facebook::hermes::HermesRuntime *runtime,
    const std::string &code,
    const std::string &sourceUrl) {
  if (!runtime) return;
  auto buffer = std::make_shared<facebook::jsi::StringBuffer>(code);
  try {
    runtime->evaluateJavaScript(buffer, sourceUrl);
  } catch (const facebook::jsi::JSError &err) {
    RuneReportJSIError(*runtime, err, "Evaluate");
    throw;
  } catch (const std::exception &ex) {
    JniEnv env;
    if (env.valid()) {
      jstring jPhase = env->NewStringUTF("Evaluate");
      jstring jMessage = env->NewStringUTF(ex.what());
      jstring jStack = env->NewStringUTF("");
      
      jclass runeDiagClass = env->FindClass("com/rune/kit/dev/RuneDiagnosticsKt");
      if (runeDiagClass) {
        jmethodID reportMethod = env->GetStaticMethodID(
            runeDiagClass, 
            "runeDiagnosticsReportJNI", 
            "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V");
        if (reportMethod) {
          env->CallStaticVoidMethod(runeDiagClass, reportMethod, jPhase, jMessage, jStack);
        }
        env->DeleteLocalRef(runeDiagClass);
      }
      
      if (jPhase) env->DeleteLocalRef(jPhase);
      if (jMessage) env->DeleteLocalRef(jMessage);
      if (jStack) env->DeleteLocalRef(jStack);
    }
    throw;
  }
}

void evaluateBytecode(
    facebook::hermes::HermesRuntime *runtime,
    const uint8_t *data,
    size_t length,
    const std::string &sourceUrl) {
  if (!runtime || !data || length == 0) return;
  const std::string url = sourceUrl.empty() ? "<unknown>" : sourceUrl;
  if (!facebook::hermes::HermesRuntime::isHermesBytecode(data, length)) {
    std::string code(reinterpret_cast<const char *>(data), length);
    evaluateString(runtime, code, url);
    return;
  }

  facebook::hermes::HermesRuntime::prefetchHermesBytecode(data, length);
  auto buffer = std::make_shared<BytecodeBuffer>(data, length);
  try {
    runtime->evaluateJavaScript(buffer, url);
  } catch (const facebook::jsi::JSError &err) {
    BRIDGE_LOG(ANDROID_LOG_ERROR, "Hermes evaluateBytecode error: %s", err.getMessage().c_str());
    auto state = getState(runtime);
    if (state) {
      BRIDGE_LOG(ANDROID_LOG_ERROR, "Hermes stack: %s", err.getStack().c_str());
      reportJsError(state, err.getMessage(), err.getStack());
    }
    throw;
  } catch (const std::exception &ex) {
    BRIDGE_LOG(ANDROID_LOG_ERROR, "Hermes evaluateBytecode std::exception: %s", ex.what());
    auto state = getState(runtime);
    if (state) {
      reportJsError(state, ex.what(), "");
    }
    throw;
  }
}

void callGlobal(
    facebook::hermes::HermesRuntime *runtime,
    JNIEnv *env,
    const std::string &name,
    jobjectArray args) {
  if (!runtime) return;
  
  // THREAD-SAFE FIX: When called via JNI (from callGlobalAsync), the env parameter
  // is VALID for the current thread (the JS HandlerThread). Use it directly.
  // Do NOT create a JniEnv wrapper as that will try to attach a thread that's
  // already attached, which can fail with "fbjni is uninitialized" errors.
  if (!env) {
    BRIDGE_LOG(ANDROID_LOG_ERROR, "callGlobal: JNIEnv is null!");
    return;
  }
  
  // Uncomment for debugging:
  // jsize argsLength = args ? env->GetArrayLength(args) : 0;
  // BRIDGE_LOG(ANDROID_LOG_INFO, "callGlobal: %s with %d arguments", name.c_str(), argsLength);
  
  using namespace facebook::jsi;
  auto global = runtime->global();
  auto globalValue = global.getProperty(*runtime, name.c_str());
  if (!globalValue.isObject()) {
    BRIDGE_LOG(ANDROID_LOG_WARN, "Global %s not found", name.c_str());
    return;
  }
  auto fn = globalValue.asObject(*runtime).asFunction(*runtime);

  jclass classInteger = env->FindClass("java/lang/Integer");
  jclass classDouble = env->FindClass("java/lang/Double");
  jclass classBoolean = env->FindClass("java/lang/Boolean");
  jclass classString = env->FindClass("java/lang/String");
  jmethodID integerValue = env->GetMethodID(classInteger, "intValue", "()I");
  jmethodID doubleValue = env->GetMethodID(classDouble, "doubleValue", "()D");
  jmethodID booleanValue = env->GetMethodID(classBoolean, "booleanValue", "()Z");

  std::vector<Value> argv;
  jsize length = args ? env->GetArrayLength(args) : 0;
  argv.reserve(length);
  for (jsize i = 0; i < length; ++i) {
    jobject element = env->GetObjectArrayElement(args, i);
    // BRIDGE_LOG(ANDROID_LOG_INFO, "Processing argument %d: %s", i, element ? "non-null" : "null");
    if (element) {
      jclass cls = env->GetObjectClass(element);
      jstring className = (jstring)env->CallObjectMethod(cls, env->GetMethodID(env->GetObjectClass(cls), "getName", "()Ljava/lang/String;"));
      if (className) {
        std::string classNameStr = getUtfString(env, className);
        // BRIDGE_LOG(ANDROID_LOG_INFO, "Argument %d class: %s", i, classNameStr.c_str());
        env->DeleteLocalRef(className);
      }
      env->DeleteLocalRef(cls);
    }
    Value jsValue = javaObjectToJsValue(*runtime, env, element, classInteger, integerValue, classDouble, doubleValue, classBoolean, booleanValue, classString);
    // BRIDGE_LOG(ANDROID_LOG_INFO, "Converted argument %d: isNumber=%s, isNull=%s, isUndefined=%s", 
    //            i, jsValue.isNumber() ? "true" : "false", 
    //            jsValue.isNull() ? "true" : "false", 
    //            jsValue.isUndefined() ? "true" : "false");
    if (jsValue.isNumber()) {
      // BRIDGE_LOG(ANDROID_LOG_INFO, "Argument %d number value: %f", i, jsValue.getNumber());
    }
    argv.push_back(std::move(jsValue));
    env->DeleteLocalRef(element);
  }
  // BRIDGE_LOG(ANDROID_LOG_INFO, "Calling JavaScript function with %zu arguments", argv.size());
  // BRIDGE_LOG(ANDROID_LOG_INFO, "About to call fn.call() with argv.data()=%p, argv.size()=%zu", argv.data(), argv.size());
  for (size_t i = 0; i < argv.size(); ++i) {
    // BRIDGE_LOG(ANDROID_LOG_INFO, "argv[%zu]: isNumber=%s, value=%f", i, 
    //            argv[i].isNumber() ? "true" : "false",
    //            argv[i].isNumber() ? argv[i].getNumber() : 0.0);
  }
  try {
    fn.call(*runtime, static_cast<const Value *>(argv.data()), argv.size());
    // BRIDGE_LOG(ANDROID_LOG_INFO, "fn.call() completed successfully");
  } catch (const facebook::jsi::JSError &err) {
    BRIDGE_LOG(ANDROID_LOG_ERROR, "JSI Error calling function: %s", err.getMessage().c_str());
    auto state = getState(runtime);
    if (state) {
      reportJsError(state, err.getMessage(), err.getStack());
    }
  } catch (const std::exception &ex) {
    BRIDGE_LOG(ANDROID_LOG_ERROR, "Exception calling function: %s", ex.what());
    auto state = getState(runtime);
    if (state) {
      reportJsError(state, ex.what(), "");
    }
  }
}

void onTimerFired(facebook::hermes::HermesRuntime *runtime, int timerId) {
  using namespace facebook::jsi;
  auto state = getState(runtime);
  if (!state) return;
  
  std::shared_ptr<Function> callback;
  std::vector<Value> args;
  
  {
    std::lock_guard<std::mutex> lock(state->mutex);
    auto it = state->timers.find(timerId);
    if (it == state->timers.end()) return;
    
    if (it->second.isInterval) {
      callback = it->second.callback;
      args.reserve(it->second.args.size());
      for (const auto &arg : it->second.args) {
        args.emplace_back(*runtime, arg);
      }
    } else {
      TimerEntry entry = std::move(it->second);
      state->timers.erase(it);
      callback = std::move(entry.callback);
      args = std::move(entry.args);
    }
  }
  
  try {
    if (callback) {
      callback->call(*runtime, static_cast<const facebook::jsi::Value *>(args.data()), args.size());
    }
  } catch (const facebook::jsi::JSError &err) {
    BRIDGE_LOG(ANDROID_LOG_ERROR, "Timer callback error: %s", err.getMessage().c_str());
    auto state = getState(runtime);
    if (state) {
      reportJsError(state, err.getMessage(), err.getStack());
    }
  } catch (const std::exception &ex) {
    BRIDGE_LOG(ANDROID_LOG_ERROR, "Timer callback exception: %s", ex.what());
    auto state = getState(runtime);
    if (state) {
      reportJsError(state, ex.what(), "");
    }
  }
}

void onAnimationFrame(
    facebook::hermes::HermesRuntime *runtime,
    int frameId,
    double frameTimeMs) {
  using namespace facebook::jsi;
  
  // Verify runtime is still valid before proceeding
  if (!runtime) {
    BRIDGE_LOG(ANDROID_LOG_WARN, "onAnimationFrame called with null runtime");
    return;
  }
  
  auto state = getState(runtime);
  if (!state) {
    BRIDGE_LOG(ANDROID_LOG_WARN, "onAnimationFrame: state not found for runtime");
    return;
  }

  if (frameId == state->nativeAnimationFrameId) {
    BRIDGE_LOG(ANDROID_LOG_INFO, "animate: onAnimationFrame native id=%d time=%.2f", frameId, frameTimeMs);
    state->nativeAnimationScheduled = false;
    stepNativeAnimations(*runtime, state, frameTimeMs);
    return;
  }
  
  // Verify runtime pointer matches state's runtime
  if (state->runtime != runtime) {
    BRIDGE_LOG(ANDROID_LOG_WARN, "onAnimationFrame: runtime mismatch");
    return;
  }
  
  std::shared_ptr<Function> callback;
  {
    std::lock_guard<std::mutex> lock(state->mutex);
    auto it = state->animationFrames.find(frameId);
    if (it == state->animationFrames.end()) {
      // Callback was already cancelled, this is normal
      return;
    }
    // Copy the shared_ptr instead of moving it to avoid invalidation issues
    callback = it->second;
    state->animationFrames.erase(it);
  }
  
  if (!callback) {
    BRIDGE_LOG(ANDROID_LOG_WARN, "onAnimationFrame: null callback for frameId %d", frameId);
    return;
  }

  // Verify the callback is actually a function before calling
  try {
    // Extra validation - check if the Function object is still valid
    if (!callback) {
      BRIDGE_LOG(ANDROID_LOG_ERROR, "onAnimationFrame: callback became null");
      return;
    }
    
    Value timestamp(frameTimeMs);
    callback->call(*runtime, timestamp);
  } catch (const facebook::jsi::JSIException &err) {
    BRIDGE_LOG(ANDROID_LOG_ERROR, "requestAnimationFrame JSI error: %s", err.what());
    auto freshState = getState(runtime);
    if (freshState) {
      reportJsError(freshState, err.what(), "");
    }
  } catch (const facebook::jsi::JSError &err) {
    BRIDGE_LOG(ANDROID_LOG_ERROR, "requestAnimationFrame error: %s", err.getMessage().c_str());
    auto freshState = getState(runtime);
    if (freshState) {
      reportJsError(freshState, err.getMessage(), err.getStack());
    }
  } catch (const std::exception &ex) {
    BRIDGE_LOG(ANDROID_LOG_ERROR, "requestAnimationFrame exception: %s", ex.what());
    auto freshState = getState(runtime);
    if (freshState) {
      reportJsError(freshState, ex.what(), "");
    }
  }
}

void resolvePromise(facebook::hermes::HermesRuntime *runtime, int promiseId, const std::string &payloadJson) {
  auto state = getState(runtime);
  if (!state) return;
  PromiseEntry entry;
  {
    std::lock_guard<std::mutex> lock(state->mutex);
    auto it = state->promises.find(promiseId);
    if (it == state->promises.end()) return;
    entry = it->second;
    state->promises.erase(it);
  }
  using namespace facebook::jsi;
  Value result = payloadJson.empty() ? Value::undefined() : parseJson(*runtime, payloadJson);
  std::vector<Value> args;
  args.emplace_back(std::move(result));
  try {
    entry.resolve->call(*runtime, static_cast<const facebook::jsi::Value *>(args.data()), args.size());
  } catch (const facebook::jsi::JSError &err) {
    BRIDGE_LOG(ANDROID_LOG_ERROR, "resolvePromise error (id=%d): %s", promiseId, err.getMessage().c_str());
    auto state = getState(runtime);
    if (state) {
      reportJsError(state, err.getMessage(), err.getStack());
    }
  } catch (const std::exception &ex) {
    BRIDGE_LOG(ANDROID_LOG_ERROR, "resolvePromise exception (id=%d): %s", promiseId, ex.what());
    auto state = getState(runtime);
    if (state) {
      reportJsError(state, ex.what(), "");
    }
  }
}

void rejectPromise(facebook::hermes::HermesRuntime *runtime, int promiseId, const std::string &message) {
  auto state = getState(runtime);
  if (!state) return;
  PromiseEntry entry;
  {
    std::lock_guard<std::mutex> lock(state->mutex);
    auto it = state->promises.find(promiseId);
    if (it == state->promises.end()) return;
    entry = it->second;
    state->promises.erase(it);
  }
  using namespace facebook::jsi;
  auto &rt = *runtime;
  Value errorValue = message.empty() ? Value::undefined() : Value(String::createFromUtf8(rt, message));
  std::vector<Value> args;
  args.emplace_back(std::move(errorValue));
  try {
    entry.reject->call(rt, static_cast<const facebook::jsi::Value *>(args.data()), args.size());
  } catch (const facebook::jsi::JSError &err) {
    BRIDGE_LOG(ANDROID_LOG_ERROR, "rejectPromise error (id=%d): %s", promiseId, err.getMessage().c_str());
    auto state = getState(runtime);
    if (state) {
      reportJsError(state, err.getMessage(), err.getStack());
    }
  } catch (const std::exception &ex) {
    BRIDGE_LOG(ANDROID_LOG_ERROR, "rejectPromise exception (id=%d): %s", promiseId, ex.what());
    auto state = getState(runtime);
    if (state) {
      reportJsError(state, ex.what(), "");
    }
  }
}

void emitEvent(
    facebook::hermes::HermesRuntime *runtime,
    const std::string &eventName,
    const std::string &payloadJson) {
  if (!runtime) {
    return;
  }

  auto state = getState(runtime);
  if (!state) {
    BRIDGE_LOG(ANDROID_LOG_WARN, "emitEvent called with missing state");
    return;
  }

  using namespace facebook::jsi;
  auto &rt = *runtime;

  try {
    auto global = rt.global();
    if (!global.hasProperty(rt, "RuneNativeEmitter")) {
      BRIDGE_LOG(ANDROID_LOG_WARN, "RuneNativeEmitter missing when emitting %s", eventName.c_str());
      return;
    }

    auto emitterValue = global.getProperty(rt, "RuneNativeEmitter");
    if (!emitterValue.isObject()) {
      BRIDGE_LOG(ANDROID_LOG_WARN, "RuneNativeEmitter is not an object for event %s", eventName.c_str());
      return;
    }

    auto emitterObj = emitterValue.asObject(rt);
    if (!emitterObj.hasProperty(rt, "emit")) {
      BRIDGE_LOG(ANDROID_LOG_WARN, "RuneNativeEmitter.emit missing for event %s", eventName.c_str());
      return;
    }

    auto emitValue = emitterObj.getProperty(rt, "emit");
    if (!emitValue.isObject()) {
      BRIDGE_LOG(ANDROID_LOG_WARN, "RuneNativeEmitter.emit is not callable for event %s", eventName.c_str());
      return;
    }

    auto emitFn = emitValue.asObject(rt).asFunction(rt);
    Value args[2];
    args[0] = Value(rt, String::createFromUtf8(rt, eventName));
    if (payloadJson.empty()) {
      args[1] = Value::undefined();
    } else {
      args[1] = parseJson(rt, payloadJson);
    }

  CallJSFunction(emitFn, rt, args, 2);
  } catch (const facebook::jsi::JSError &err) {
    BRIDGE_LOG(ANDROID_LOG_ERROR, "emitEvent JSI error: %s", err.getMessage().c_str());
    reportJsError(state, err.getMessage(), err.getStack());
  } catch (const std::exception &ex) {
    BRIDGE_LOG(ANDROID_LOG_ERROR, "emitEvent exception: %s", ex.what());
    reportJsError(state, ex.what(), "");
  }
}

void invokeHandler(facebook::hermes::HermesRuntime *runtime, long handlerId, int nodeId, const std::string &event) {
  auto state = getState(runtime);
  if (!state) return;
  HandlerEntry entry;
  {
    std::lock_guard<std::mutex> lock(state->mutex);
    auto it = state->handlers.find(handlerId);
    if (it == state->handlers.end()) return;
    entry = it->second;
  }
  using namespace facebook::jsi;
  auto &rt = *runtime;
  Object evt(rt);
  evt.setProperty(rt, "target", Value(static_cast<double>(nodeId)));
  evt.setProperty(rt, "type", String::createFromUtf8(rt, event));

  if (state->uiMethods.dequeueEventPayload) {
    JniEnv env;
    if (env.valid()) {
      jstring jEvent = makeJString(env.get(), event);
      jstring jPayload = static_cast<jstring>(env->CallObjectMethod(state->uiShim, state->uiMethods.dequeueEventPayload, nodeId, jEvent));
      logJniException(env.get(), "UIShim.dequeueEventPayload");
      if (jPayload) {
        std::string payloadJson = getUtfString(env.get(), jPayload);
        env->DeleteLocalRef(jPayload);
        if (!payloadJson.empty()) {
          try {
            Value payloadValue = parseJson(rt, payloadJson);
            if (payloadValue.isObject()) {
              auto payloadObj = payloadValue.getObject(rt);
              auto keys = payloadObj.getPropertyNames(rt);
              size_t len = keys.size(rt);
              for (size_t i = 0; i < len; ++i) {
                auto keyValue = keys.getValueAtIndex(rt, i);
                if (!keyValue.isString()) continue;
                std::string key = keyValue.getString(rt).utf8(rt);
                auto propId = facebook::jsi::PropNameID::forUtf8(rt, key);
                auto propValue = payloadObj.getProperty(rt, propId);
                evt.setProperty(rt, propId, propValue);
              }
            }
          } catch (const std::exception &ex) {
            BRIDGE_LOG(ANDROID_LOG_WARN, "Failed to merge event payload for %s: %s", event.c_str(), ex.what());
          }
        }
      }
      if (jEvent) {
        env->DeleteLocalRef(jEvent);
      }
    }
  }
  std::vector<Value> handlerArgs;
  handlerArgs.emplace_back(std::move(evt));
  try {
    entry.function->call(rt, static_cast<const facebook::jsi::Value *>(handlerArgs.data()), handlerArgs.size());
    runtime->drainMicrotasks();
  } catch (const facebook::jsi::JSError &err) {
    BRIDGE_LOG(ANDROID_LOG_ERROR, "invokeHandler error: %s", err.getMessage().c_str());
    auto state = getState(runtime);
    if (state) {
      reportJsError(state, err.getMessage(), err.getStack());
    }
  } catch (const std::exception &ex) {
    BRIDGE_LOG(ANDROID_LOG_ERROR, "invokeHandler exception: %s", ex.what());
    auto state = getState(runtime);
    if (state) {
      reportJsError(state, ex.what(), "");
    }
  }
}

void destroyRuntime(facebook::hermes::HermesRuntime *runtime) {
  auto state = removeState(runtime);
  cleanupState(state);
}

} // namespace rune::kit

extern "C" JNIEXPORT void JNICALL
Java_com_rune_kit_runtime_RuneBridge_nativeInstallBindings(JNIEnv *, jclass, jobject, jobject) {
  __android_log_print(ANDROID_LOG_INFO, "RuneHermesBridge", "Fallback RuneBridge installBindings invoked (no-op)");
}
