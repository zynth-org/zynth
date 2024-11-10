#include <jni.h>

#include <android/log.h>
#include <hermes/Public/RuntimeConfig.h>
#include <hermes/hermes.h>
#include <jsi/jsi.h>

#include <cmath>
#include <memory>
#include <mutex>
#include <optional>
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

struct UIShimMethods {
  jmethodID createNode = nullptr;
  jmethodID setProp = nullptr;
  jmethodID setText = nullptr;
  jmethodID insertChild = nullptr;
  jmethodID removeChild = nullptr;
  jmethodID removeNode = nullptr;
  jmethodID setHandler = nullptr;
  jmethodID flush = nullptr;
};

struct ModulesShimMethods {
  jmethodID invoke = nullptr;
};

struct TimerShimMethods {
  jmethodID scheduleTimeout = nullptr;
  jmethodID clearTimeout = nullptr;
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
};

struct PromiseEntry {
  std::shared_ptr<facebook::jsi::Function> resolve;
  std::shared_ptr<facebook::jsi::Function> reject;
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
  int nextPromiseId = 1;
  std::unordered_map<long, HandlerEntry> handlers;
  std::unordered_map<int, TimerEntry> timers;
  std::unordered_map<int, PromiseEntry> promises;
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

std::string toJsonString(facebook::jsi::Runtime &rt, const facebook::jsi::Value &value) {
  using namespace facebook::jsi;
  auto global = rt.global();
  auto jsonObj = global.getPropertyAsObject(rt, "JSON");
  auto stringify = jsonObj.getPropertyAsFunction(rt, "stringify");
  Value tmp = stringify.call(rt, value);
  if (tmp.isString()) {
    return tmp.getString(rt).utf8(rt);
  }
  return "{}";
}

facebook::jsi::Value parseJson(facebook::jsi::Runtime &rt, const std::string &json) {
  using namespace facebook::jsi;
  auto global = rt.global();
  auto jsonObj = global.getPropertyAsObject(rt, "JSON");
  auto parse = jsonObj.getPropertyAsFunction(rt, "parse");
  auto arg = String::createFromUtf8(rt, json);
  return parse.call(rt, arg);
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
    BRIDGE_LOG(ANDROID_LOG_INFO, "javaObjectToJsValue: null object");
    return Value::null();
  }
  if (env->IsInstanceOf(value, classInteger)) {
    BRIDGE_LOG(ANDROID_LOG_INFO, "javaObjectToJsValue: Converting Integer");
    jint v = env->CallIntMethod(value, integerValue);
    logJniException(env, "Integer.intValue");
    BRIDGE_LOG(ANDROID_LOG_INFO, "javaObjectToJsValue: Integer value = %d", v);
    Value result = Value(static_cast<double>(v));
    BRIDGE_LOG(ANDROID_LOG_INFO, "javaObjectToJsValue: Created JS Value, isNumber = %s", result.isNumber() ? "true" : "false");
    return result;
  }
  if (env->IsInstanceOf(value, classDouble)) {
    jdouble v = env->CallDoubleMethod(value, doubleValue);
    logJniException(env, "Double.doubleValue");
    return Value(static_cast<double>(v));
  }
  if (env->IsInstanceOf(value, classBoolean)) {
    jboolean v = env->CallBooleanMethod(value, booleanValue);
    logJniException(env, "Boolean.booleanValue");
    return Value(static_cast<bool>(v == JNI_TRUE));
  }
  if (env->IsInstanceOf(value, classString)) {
    auto js = static_cast<jstring>(value);
    std::string utf = getUtfString(env, js);
    return Value(facebook::jsi::String::createFromUtf8(rt, utf));
  }
  BRIDGE_LOG(ANDROID_LOG_WARN, "javaObjectToJsValue: Unknown type, returning undefined");
  return Value::undefined();
}

void installConsole(std::shared_ptr<RuntimeState> state) {
  using namespace facebook::jsi;
  auto &rt = *state->runtime;
  auto logFunction = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "log"), 1,
      [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        std::string message;
        if (count > 0) {
          if (args[0].isString()) {
            message = args[0].getString(rt).utf8(rt);
          } else if (args[0].isNumber()) {
            message = std::to_string(args[0].getNumber());
          }
        }
        BRIDGE_LOG(ANDROID_LOG_INFO, "%s", message.c_str());
        return Value::undefined();
      });
  auto warnFunction = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "warn"), 1,
      [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        std::string message;
        if (count > 0 && args[0].isString()) {
          message = args[0].getString(rt).utf8(rt);
        }
        BRIDGE_LOG(ANDROID_LOG_WARN, "%s", message.c_str());
        return Value::undefined();
      });
  auto errorFunction = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "error"), 1,
      [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        std::string message;
        if (count > 0 && args[0].isString()) {
          message = args[0].getString(rt).utf8(rt);
        }
        BRIDGE_LOG(ANDROID_LOG_ERROR, "%s", message.c_str());
        return Value::undefined();
      });

  Object console(rt);
  console.setProperty(rt, "log", logFunction);
  console.setProperty(rt, "warn", warnFunction);
  console.setProperty(rt, "error", errorFunction);
  rt.global().setProperty(rt, "console", console);
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
        {
          std::lock_guard<std::mutex> lock(state->mutex);
          for (auto it = state->handlers.begin(); it != state->handlers.end();) {
            if (it->second.nodeId == nodeId) {
              it = state->handlers.erase(it);
            } else {
              ++it;
            }
          }
        }
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

  facebook::jsi::Object ui(rt);
  ui.setProperty(rt, "createNode", createNode);
  ui.setProperty(rt, "setProp", setProp);
  ui.setProperty(rt, "setText", setText);
  ui.setProperty(rt, "insertChild", insertChild);
  ui.setProperty(rt, "removeChild", removeChild);
  ui.setProperty(rt, "removeNode", removeNode);
  ui.setProperty(rt, "setHandler", setHandler);
  ui.setProperty(rt, "flush", flush);

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

  rt.global().setProperty(rt, "setTimeout", setTimeoutFn);
  rt.global().setProperty(rt, "clearTimeout", clearTimeoutFn);
  rt.global().setProperty(rt, "setImmediate", setTimeoutFn);
  rt.global().setProperty(rt, "clearImmediate", clearTimeoutFn);
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
        facebook::jsi::Value payload = count >= 3 ? facebook::jsi::Value(runtime, args[2]) : facebook::jsi::Value::undefined();
        std::string jsonPayload = toJsonString(runtime, payload);

        return makePromise(runtime, [weakState, moduleName, methodName, jsonPayload](Function &&resolve, Function &&reject) {
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
            JniEnv env;
            if (!env.valid()) return;
            jstring jModule = makeJString(env.get(), moduleName);
            jstring jMethod = makeJString(env.get(), methodName);
            jclass objectClass = env->FindClass("java/lang/Object");
            if (!objectClass) {
              logJniException(env.get(), "FindClass java/lang/Object");
              env->DeleteLocalRef(jModule);
              env->DeleteLocalRef(jMethod);
              return;
            }
            jobjectArray argsArray = env->NewObjectArray(1, objectClass, nullptr);
            env->DeleteLocalRef(objectClass);
            if (!argsArray) {
              logJniException(env.get(), "NewObjectArray args");
              env->DeleteLocalRef(jModule);
              env->DeleteLocalRef(jMethod);
              return;
            }
            jstring jPayload = makeJString(env.get(), jsonPayload);
            env->SetObjectArrayElement(argsArray, 0, jPayload);
            env->CallVoidMethod(state->modulesShim, state->moduleMethods.invoke, jModule, jMethod, argsArray, promiseId);
            env->DeleteLocalRef(jPayload);
            env->DeleteLocalRef(argsArray);
            env->DeleteLocalRef(jModule);
            env->DeleteLocalRef(jMethod);
            logJniException(env.get(), "ModulesShim.invoke");
          }
        });
      });

  facebook::jsi::Object modules(rt);
  modules.setProperty(rt, "call", callFn);
  rt.global().setProperty(rt, "__modules", modules);
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

  state->moduleMethods.invoke = env->GetMethodID(state->modulesClass, "invoke", "(Ljava/lang/String;Ljava/lang/String;[Ljava/lang/Object;I)V");

  state->timerMethods.scheduleTimeout = env->GetMethodID(state->timerClass, "scheduleTimeout", "(IJ)V");
  state->timerMethods.clearTimeout = env->GetMethodID(state->timerClass, "clearTimeout", "(I)V");

  state->reportError = env->GetMethodID(state->errorHandlerClass, "report", "(Ljava/lang/String;Ljava/lang/String;)V");

  storeState(runtime, state);

  installConsole(state);
  installPlatformFlag(state);
  installUIBindings(state);
  installModules(state);
  installTimers(state);

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
    BRIDGE_LOG(ANDROID_LOG_ERROR, "Hermes evaluateString error: %s", err.getMessage().c_str());
    auto state = getState(runtime);
    if (state) {
      BRIDGE_LOG(ANDROID_LOG_ERROR, "Hermes stack: %s", err.getStack().c_str());
      reportJsError(state, err.getMessage(), err.getStack());
    }
    throw;
  } catch (const std::exception &ex) {
    BRIDGE_LOG(ANDROID_LOG_ERROR, "Hermes evaluateString std::exception: %s", ex.what());
    auto state = getState(runtime);
    if (state) {
      reportJsError(state, ex.what(), "");
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
  // TODO: Support Hermes bytecode evaluation (HBC).
  auto buffer = std::make_shared<facebook::jsi::StringBuffer>(std::string(reinterpret_cast<const char *>(data), length));
  try {
    runtime->evaluateJavaScript(buffer, sourceUrl);
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
  
  jsize argsLength = args ? env->GetArrayLength(args) : 0;
  BRIDGE_LOG(ANDROID_LOG_INFO, "callGlobal: %s with %d arguments", name.c_str(), argsLength);
  
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
    BRIDGE_LOG(ANDROID_LOG_INFO, "Processing argument %d: %s", i, element ? "non-null" : "null");
    if (element) {
      jclass cls = env->GetObjectClass(element);
      jstring className = (jstring)env->CallObjectMethod(cls, env->GetMethodID(env->GetObjectClass(cls), "getName", "()Ljava/lang/String;"));
      if (className) {
        std::string classNameStr = getUtfString(env, className);
        BRIDGE_LOG(ANDROID_LOG_INFO, "Argument %d class: %s", i, classNameStr.c_str());
        env->DeleteLocalRef(className);
      }
      env->DeleteLocalRef(cls);
    }
    Value jsValue = javaObjectToJsValue(*runtime, env, element, classInteger, integerValue, classDouble, doubleValue, classBoolean, booleanValue, classString);
    BRIDGE_LOG(ANDROID_LOG_INFO, "Converted argument %d: isNumber=%s, isNull=%s, isUndefined=%s", 
               i, jsValue.isNumber() ? "true" : "false", 
               jsValue.isNull() ? "true" : "false", 
               jsValue.isUndefined() ? "true" : "false");
    if (jsValue.isNumber()) {
      BRIDGE_LOG(ANDROID_LOG_INFO, "Argument %d number value: %f", i, jsValue.getNumber());
    }
    argv.push_back(std::move(jsValue));
    env->DeleteLocalRef(element);
  }
  BRIDGE_LOG(ANDROID_LOG_INFO, "Calling JavaScript function with %zu arguments", argv.size());
  BRIDGE_LOG(ANDROID_LOG_INFO, "About to call fn.call() with argv.data()=%p, argv.size()=%zu", argv.data(), argv.size());
  for (size_t i = 0; i < argv.size(); ++i) {
    BRIDGE_LOG(ANDROID_LOG_INFO, "argv[%zu]: isNumber=%s, value=%f", i, 
               argv[i].isNumber() ? "true" : "false",
               argv[i].isNumber() ? argv[i].getNumber() : 0.0);
  }
  try {
    fn.call(*runtime, static_cast<const Value *>(argv.data()), argv.size());
    BRIDGE_LOG(ANDROID_LOG_INFO, "fn.call() completed successfully");
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
  TimerEntry entry;
  {
    std::lock_guard<std::mutex> lock(state->mutex);
    auto it = state->timers.find(timerId);
    if (it == state->timers.end()) return;
    entry = std::move(it->second);
    state->timers.erase(it);
  }
  try {
    entry.callback->call(*runtime, static_cast<const facebook::jsi::Value *>(entry.args.data()), entry.args.size());
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
    BRIDGE_LOG(ANDROID_LOG_ERROR, "resolvePromise error: %s", err.getMessage().c_str());
    auto state = getState(runtime);
    if (state) {
      reportJsError(state, err.getMessage(), err.getStack());
    }
  } catch (const std::exception &ex) {
    BRIDGE_LOG(ANDROID_LOG_ERROR, "resolvePromise exception: %s", ex.what());
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
    BRIDGE_LOG(ANDROID_LOG_ERROR, "rejectPromise error: %s", err.getMessage().c_str());
    auto state = getState(runtime);
    if (state) {
      reportJsError(state, err.getMessage(), err.getStack());
    }
  } catch (const std::exception &ex) {
    BRIDGE_LOG(ANDROID_LOG_ERROR, "rejectPromise exception: %s", ex.what());
    auto state = getState(runtime);
    if (state) {
      reportJsError(state, ex.what(), "");
    }
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
  std::vector<Value> handlerArgs;
  handlerArgs.emplace_back(std::move(evt));
  try {
    entry.function->call(rt, static_cast<const facebook::jsi::Value *>(handlerArgs.data()), handlerArgs.size());
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
