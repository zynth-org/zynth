#include <jni.h>
#include <android/log.h>
#include <fbjni/fbjni.h>
#include <hermes/hermes.h>
#include <jsi/jsi.h>

#include "UICommandsRegistry.h"

#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <atomic>
#include <cstring>
#include <signal.h>
#include <thread>
#include <unistd.h>
#include <vector>

using namespace facebook::jsi;

namespace {
JavaVM *gVm = nullptr;
int gCrashPipe[2] = {-1, -1};
std::atomic<bool> gCrashHandlerInstalled{false};
std::atomic<bool> gCrashThreadStarted{false};
jclass gDevtoolsClass = nullptr;
jmethodID gDevtoolsEmitMethod = nullptr;

struct TimerEntry {
  std::shared_ptr<Function> callback;
  std::vector<Value> args;
  bool repeat;
};

struct TimerContext {
  std::atomic<int> nextTimerId{1};
  std::mutex mutex;
  std::unordered_map<int, TimerEntry> timers;
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

struct ZynthWorkletDefinition {
  std::string code;
  std::string location;
  std::vector<ZynthWorkletClosureValue> closure;
};

struct RuntimeState {
  facebook::hermes::HermesRuntime *runtime = nullptr;
  jobject uiManager = nullptr;
  jclass uiClass = nullptr;
  jclass jsBridgeClass = nullptr;
  jclass devtoolsClass = nullptr;
  jmethodID createNode = nullptr;
  jmethodID setProp = nullptr;
  jmethodID setText = nullptr;
  jmethodID insertChild = nullptr;
  jmethodID removeChild = nullptr;
  jmethodID setHandler = nullptr;
  jmethodID applyBatch = nullptr;
  jmethodID applyBatchTypedPacked = nullptr;
  jmethodID applyBatchTypedBuffer = nullptr;
  jmethodID setSurface = nullptr;
  jmethodID flush = nullptr;
  jmethodID scheduleTimer = nullptr;
  jmethodID cancelTimer = nullptr;
  jmethodID scheduleAnimationFrame = nullptr;
  jmethodID cancelAnimationFrame = nullptr;
  jmethodID postRegisterWorklet = nullptr;
  jmethodID postRunWorklet = nullptr;
  jmethodID devtoolsEmit = nullptr;
  jmethodID devtoolsIsConnected = nullptr;
  std::shared_ptr<TimerContext> timerContext = std::make_shared<TimerContext>();
  std::shared_ptr<facebook::hermes::HermesRuntime> uiRuntime;
  std::atomic<int> nextWorkletId{1};
  std::unordered_map<int, std::shared_ptr<Function>> uiWorklets;
  std::unordered_map<int, std::vector<struct ZynthWorkletClosureValue>> uiWorkletClosures;
  std::unordered_map<int, struct ZynthWorkletDefinition> pendingWorklets;
  std::mutex workletMutex;
  std::atomic<int> nextSharedSignalId{1};
  std::unordered_map<int, double> sharedSignals;
  std::mutex sharedSignalsMutex;
};

std::mutex gStateMutex;
std::unordered_map<facebook::hermes::HermesRuntime *, std::shared_ptr<RuntimeState>> gStates;

struct HandlerKey {
  int nodeId;
  std::string name;

  bool operator==(const HandlerKey &other) const {
    return nodeId == other.nodeId && name == other.name;
  }
};

struct HandlerKeyHash {
  size_t operator()(const HandlerKey &key) const {
    size_t h1 = std::hash<int>()(key.nodeId);
    size_t h2 = std::hash<std::string>()(key.name);
    return h1 ^ (h2 << 1);
  }
};

struct HandlerEntry {
  facebook::hermes::HermesRuntime *runtime = nullptr;
  std::shared_ptr<Function> handler;
};

std::mutex gHandlerMutex;
std::unordered_map<HandlerKey, HandlerEntry, HandlerKeyHash> gHandlers;

void removeHandlersForNode(int nodeId) {
  std::lock_guard<std::mutex> lock(gHandlerMutex);
  for (auto it = gHandlers.begin(); it != gHandlers.end();) {
    if (it->first.nodeId == nodeId) {
      it = gHandlers.erase(it);
    } else {
      ++it;
    }
  }
}

JNIEnv *getEnv() {
  return facebook::jni::Environment::current();
}

void callSetProp(JNIEnv *env, RuntimeState *state, jint nodeId, const std::string &name,
                 const std::string &value) {
  jstring jName = env->NewStringUTF(name.c_str());
  jstring jValue = env->NewStringUTF(value.c_str());
  env->CallVoidMethod(state->uiManager, state->setProp, nodeId, jName, jValue);
  env->DeleteLocalRef(jName);
  env->DeleteLocalRef(jValue);
}

void applyStyle(Runtime &rt, RuntimeState *state, JNIEnv *env, jint nodeId, const Object &style) {
  static const char *numericKeys[] = {
      "width", "height", "flex", "flexGrow", "flexShrink", "flexBasis",
      "padding", "paddingHorizontal", "paddingVertical", "paddingTop", "paddingRight",
      "paddingBottom", "paddingLeft", "margin", "marginHorizontal", "marginVertical",
      "marginTop", "marginRight", "marginBottom", "marginLeft", "borderRadius",
      "borderWidth", "fontSize", "top", "right", "bottom", "left", "opacity",
      "shadowOpacity", "shadowRadius", "elevation", "zIndex", "gap", "rowGap",
      "columnGap", "minWidth", "minHeight", "maxWidth", "maxHeight", "aspectRatio",
      "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
      "borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius",
      "borderBottomLeftRadius", "lineHeight", "lineSpacing", "paragraphSpacing",
      "letterSpacing", "baselineShift", "minimumFontScale"
  };

  static const char *stringKeys[] = {
      "flexDirection", "justifyContent", "alignItems", "alignSelf", "alignContent",
      "flexWrap", "background", "backgroundImage", "backgroundColor", "borderColor",
      "borderStyle", "fontWeight", "color", "position", "display", "overflow",
      "pointerEvents", "borderTopColor", "borderRightColor", "borderBottomColor",
      "borderLeftColor", "shadowColor", "boxShadow", "fontFamily", "fontStyle",
      "textAlign", "textDecorationLine", "textTransform", "hyphenation"
  };

  static const char *objectKeys[] = {
      "transform", "transformOrigin", "shadowOffset", "boxShadow",
      "background", "backgroundImage"
  };

  auto stringifyValue = [&rt](const Value &value) -> std::optional<std::string> {
    if (value.isString()) {
      return value.asString(rt).utf8(rt);
    }
    if (!value.isObject()) return std::nullopt;
    try {
      Object json = rt.global().getPropertyAsObject(rt, "JSON");
      Function stringify = json.getPropertyAsFunction(rt, "stringify");
      Value result = stringify.call(rt, value);
      if (result.isString()) {
        return result.asString(rt).utf8(rt);
      }
    } catch (...) {
      return std::nullopt;
    }
    return std::nullopt;
  };

  for (const char *key : numericKeys) {
    if (!style.hasProperty(rt, key)) continue;
    Value v = style.getProperty(rt, key);
    if (v.isNumber()) {
      callSetProp(env, state, nodeId, key, std::to_string(v.asNumber()));
    } else if (v.isString()) {
      callSetProp(env, state, nodeId, key, v.asString(rt).utf8(rt));
    }
  }

  for (const char *key : stringKeys) {
    if (!style.hasProperty(rt, key)) continue;
    Value v = style.getProperty(rt, key);
    if (v.isString()) {
      callSetProp(env, state, nodeId, key, v.asString(rt).utf8(rt));
    }
  }

  for (const char *key : objectKeys) {
    if (!style.hasProperty(rt, key)) continue;
    Value v = style.getProperty(rt, key);
    auto value = stringifyValue(v);
    if (value) {
      callSetProp(env, state, nodeId, key, *value);
    }
  }
}

void applyProp(Runtime &rt, RuntimeState *state, JNIEnv *env, jint nodeId, const std::string &name,
               const Value &value) {
  if (name == "style" && value.isObject()) {
    applyStyle(rt, state, env, nodeId, value.asObject(rt));
    return;
  }
  if (value.isString()) {
    callSetProp(env, state, nodeId, name, value.asString(rt).utf8(rt));
    return;
  }
  if (value.isNumber()) {
    callSetProp(env, state, nodeId, name, std::to_string(value.asNumber()));
    return;
  }
  if (value.isBool()) {
    callSetProp(env, state, nodeId, name, value.getBool() ? "true" : "false");
  }
}

static std::string valueToString(Runtime &rt, const Value &value) {
  if (value.isString()) {
    return value.asString(rt).utf8(rt);
  }
  if (value.isNumber()) {
    // Remove trailing zeros/dot if integer-like
    std::string s = std::to_string(value.asNumber());
    s.erase(s.find_last_not_of('0') + 1, std::string::npos); 
    if(s.back() == '.') s.pop_back();
    return s;
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
      Object json = rt.global().getPropertyAsObject(rt, "JSON");
      Function stringify = json.getPropertyAsFunction(rt, "stringify");
      Value result = stringify.call(rt, value);
      if (result.isString()) {
        return result.asString(rt).utf8(rt);
      }
    } catch (...) {
      // ignore
    }
    return "[object Object]";
  }
  return "";
}

std::string jsonEscape(const std::string &value) {
  std::string out;
  out.reserve(value.size() + 8);
  for (unsigned char ch : value) {
    switch (ch) {
      case '\"':
        out += "\\\"";
        break;
      case '\\':
        out += "\\\\";
        break;
      case '\b':
        out += "\\b";
        break;
      case '\f':
        out += "\\f";
        break;
      case '\n':
        out += "\\n";
        break;
      case '\r':
        out += "\\r";
        break;
      case '\t':
        out += "\\t";
        break;
      default:
        if (ch < 0x20) {
          char buf[7];
          snprintf(buf, sizeof(buf), "\\u%04x", ch);
          out += buf;
        } else {
          out.push_back(static_cast<char>(ch));
        }
        break;
    }
  }
  return out;
}

void emitDevtoolsEvent(RuntimeState *state,
                       const std::string &topic,
                       const std::string &level,
                       const std::string &tag,
                       const std::string &data) {
  if (!state || !state->devtoolsClass || !state->devtoolsEmit) return;
  JNIEnv *env = getEnv();
  if (!env) return;
  std::string payload = std::string("{\"topic\":\"") + jsonEscape(topic) +
                        "\",\"level\":\"" + jsonEscape(level) +
                        "\",\"tag\":\"" + jsonEscape(tag) +
                        "\",\"data\":\"" + jsonEscape(data) + "\"}";
  jstring jPayload = env->NewStringUTF(payload.c_str());
  env->CallStaticVoidMethod(state->devtoolsClass, state->devtoolsEmit, jPayload);
  env->DeleteLocalRef(jPayload);

  // Also forward devtools events into JS so in-app overlays can react without
  // relying on networked devtools.
  if (!state->runtime) return;
  try {
    Runtime &rt = *state->runtime;
    if (!rt.global().hasProperty(rt, "__zynth_onDevtoolsEventRaw")) return;
    Value handlerVal = rt.global().getProperty(rt, "__zynth_onDevtoolsEventRaw");
    if (!handlerVal.isObject()) return;
    Object handlerObj = handlerVal.asObject(rt);
    if (!handlerObj.isFunction(rt)) return;
    Function handlerFn = handlerObj.asFunction(rt);
    handlerFn.call(rt, String::createFromUtf8(rt, payload));
  } catch (...) {
    // Never allow diagnostics forwarding to crash the runtime.
    return;
  }
}

const char *signalName(int sig) {
  switch (sig) {
    case SIGSEGV:
      return "SIGSEGV";
    case SIGABRT:
      return "SIGABRT";
    case SIGBUS:
      return "SIGBUS";
    case SIGILL:
      return "SIGILL";
    case SIGFPE:
      return "SIGFPE";
    default:
      return "SIGNAL";
  }
}

void crashSignalHandler(int sig, siginfo_t *, void *) {
  if (gCrashPipe[1] != -1) {
    char buf[64];
    int len = snprintf(buf, sizeof(buf), "%s(%d)\n", signalName(sig), sig);
    if (len > 0) {
      write(gCrashPipe[1], buf, static_cast<size_t>(len));
    }
  }
  signal(sig, SIG_DFL);
  raise(sig);
}

void startCrashWatcherThread() {
  if (gCrashThreadStarted.exchange(true)) return;
  std::thread([]() {
    if (gVm == nullptr) return;
    JNIEnv *env = nullptr;
    if (gVm->AttachCurrentThread(&env, nullptr) != JNI_OK || !env) return;
    char buf[128];
    while (true) {
      ssize_t readBytes = read(gCrashPipe[0], buf, sizeof(buf) - 1);
      if (readBytes <= 0) {
        break;
      }
      buf[readBytes] = '\0';
      if (!gDevtoolsClass || !gDevtoolsEmitMethod) {
        continue;
      }
      std::string data(buf);
      std::string payload =
          std::string("{\"topic\":\"crash/native\",\"level\":\"error\",\"tag\":\"crash\",\"data\":\"") +
          jsonEscape(data) + "\"}";
      jstring jPayload = env->NewStringUTF(payload.c_str());
      env->CallStaticVoidMethod(gDevtoolsClass, gDevtoolsEmitMethod, jPayload);
      env->DeleteLocalRef(jPayload);
    }
    gVm->DetachCurrentThread();
  }).detach();
}

void installCrashSignalHandlers() {
  if (gCrashHandlerInstalled.exchange(true)) return;
  if (pipe(gCrashPipe) != 0) {
    return;
  }
  startCrashWatcherThread();
  struct sigaction action;
  memset(&action, 0, sizeof(action));
  action.sa_sigaction = crashSignalHandler;
  sigemptyset(&action.sa_mask);
  action.sa_flags = SA_SIGINFO | SA_ONSTACK;
  sigaction(SIGSEGV, &action, nullptr);
  sigaction(SIGABRT, &action, nullptr);
  sigaction(SIGBUS, &action, nullptr);
  sigaction(SIGILL, &action, nullptr);
  sigaction(SIGFPE, &action, nullptr);
}

void installConsole(Runtime &rt, RuntimeState *state) {
  auto logFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "log"), 1,
      [state](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        std::string message;
        for (size_t i = 0; i < count; i++) {
          if (i > 0) message += " ";
          message += valueToString(rt, args[i]);
        }
        __android_log_print(ANDROID_LOG_DEBUG, "ZynthJS", "%s", message.c_str());
        emitDevtoolsEvent(state, "log/console", "log", "console", message);
        return Value::undefined();
      });

  auto warnFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "warn"), 1,
      [state](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        std::string message;
        for (size_t i = 0; i < count; i++) {
          if (i > 0) message += " ";
          message += valueToString(rt, args[i]);
        }
        __android_log_print(ANDROID_LOG_WARN, "ZynthJS", "%s", message.c_str());
        emitDevtoolsEvent(state, "log/console", "warn", "console", message);
        return Value::undefined();
      });

  auto errorFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "error"), 1,
      [state](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        std::string message;
        for (size_t i = 0; i < count; i++) {
          if (i > 0) message += " ";
          message += valueToString(rt, args[i]);
        }
        __android_log_print(ANDROID_LOG_ERROR, "ZynthJS", "%s", message.c_str());
        emitDevtoolsEvent(state, "log/console", "error", "console", message);
        return Value::undefined();
      });

  Object console(rt);
  console.setProperty(rt, "log", logFn);
  console.setProperty(rt, "info", logFn);
  console.setProperty(rt, "debug", logFn);
  console.setProperty(rt, "warn", warnFn);
  console.setProperty(rt, "error", errorFn);
  rt.global().setProperty(rt, "console", console);
}

void installModulesStub(Runtime &rt) {
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

void installGlobals(Runtime &rt) {
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

std::optional<std::string> stringifyDevtoolsPayload(Runtime &rt, const Value &value) {
  if (value.isString()) return value.asString(rt).utf8(rt);
  if (value.isNumber()) return std::to_string(value.asNumber());
  if (value.isBool()) return value.getBool() ? "true" : "false";
  if (value.isNull()) return "null";
  if (value.isUndefined()) return std::nullopt;
  if (value.isObject()) {
    try {
      Object json = rt.global().getPropertyAsObject(rt, "JSON");
      Function stringify = json.getPropertyAsFunction(rt, "stringify");
      Value jsonStr = stringify.call(rt, value);
      if (jsonStr.isString()) {
        return jsonStr.asString(rt).utf8(rt);
      }
    } catch (...) {
      return std::nullopt;
    }
  }
  return std::nullopt;
}

void installDevtoolsBridge(Runtime &rt, RuntimeState *state) {
  if (!state) return;
  Object globalThis = rt.global();

  auto emitFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__zynth_devtools_emit"), 1,
      [state](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (!state || !state->devtoolsClass || !state->devtoolsEmit || count < 1) {
          __android_log_print(ANDROID_LOG_WARN, "ZynthDevtools", "emit skipped (no class/method or args)");
          return Value::undefined();
        }
        auto payload = stringifyDevtoolsPayload(rt, args[0]);
        if (!payload || payload->empty()) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        jstring jPayload = env->NewStringUTF(payload->c_str());
        __android_log_print(ANDROID_LOG_DEBUG, "ZynthDevtools", "emit payload=%s", payload->c_str());
        env->CallStaticVoidMethod(state->devtoolsClass, state->devtoolsEmit, jPayload);
        env->DeleteLocalRef(jPayload);
        return Value::undefined();
      });

  auto isConnectedFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__zynth_devtools_isConnected"), 0,
      [state](Runtime &, const Value &, const Value *, size_t) -> Value {
        if (!state || !state->devtoolsClass || !state->devtoolsIsConnected) {
          return Value(false);
        }
        JNIEnv *env = getEnv();
        if (!env) return Value(false);
        jboolean connected =
            env->CallStaticBooleanMethod(state->devtoolsClass, state->devtoolsIsConnected);
        return Value(static_cast<bool>(connected));
      });

  globalThis.setProperty(rt, "__zynth_devtools_emit", emitFn);
  globalThis.setProperty(rt, "__zynth_devtools_isConnected", isConnectedFn);
}

std::shared_ptr<RuntimeState> sharedStateFor(facebook::hermes::HermesRuntime *runtime) {
  std::lock_guard<std::mutex> lock(gStateMutex);
  auto it = gStates.find(runtime);
  if (it == gStates.end()) return nullptr;
  return it->second;
}

RuntimeState *stateFor(facebook::hermes::HermesRuntime *runtime) {
  auto shared = sharedStateFor(runtime);
  return shared ? shared.get() : nullptr;
}

void installTimers(Runtime &rt, facebook::hermes::HermesRuntime *runtime) {
  auto hostSetTimeout = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostSetTimeout"), 3,
      [runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isObject()) return Value::undefined();
        Object fnObject = args[0].asObject(rt);
        if (!fnObject.isFunction(rt)) return Value::undefined();

        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();

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

        int timerId = state->timerContext->nextTimerId.fetch_add(1);
        {
          std::lock_guard<std::mutex> lock(state->timerContext->mutex);
          state->timerContext->timers[timerId] = {
              std::make_shared<Function>(fnObject.asFunction(rt)),
              std::move(callArgs),
              false
          };
        }

        env->CallVoidMethod(state->uiManager, state->scheduleTimer,
                            reinterpret_cast<jlong>(runtime), timerId, delayMs, false);
        return Value(static_cast<double>(timerId));
      });

  auto hostSetInterval = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostSetInterval"), 3,
      [runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isObject()) return Value::undefined();
        Object fnObject = args[0].asObject(rt);
        if (!fnObject.isFunction(rt)) return Value::undefined();

        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();

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

        int timerId = state->timerContext->nextTimerId.fetch_add(1);
        {
          std::lock_guard<std::mutex> lock(state->timerContext->mutex);
          state->timerContext->timers[timerId] = {
              std::make_shared<Function>(fnObject.asFunction(rt)),
              std::move(callArgs),
              true
          };
        }

        env->CallVoidMethod(state->uiManager, state->scheduleTimer,
                            reinterpret_cast<jlong>(runtime), timerId, delayMs, true);
        return Value(static_cast<double>(timerId));
      });

  auto hostClearTimeout = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostClearTimeout"), 1,
      [runtime](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value::undefined();
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        
        int timerId = static_cast<int>(args[0].asNumber());
        {
          std::lock_guard<std::mutex> lock(state->timerContext->mutex);
          state->timerContext->timers.erase(timerId);
        }
        
                env->CallVoidMethod(state->uiManager, state->cancelTimer, timerId);
                return Value::undefined();
              });
        
          auto hostClearInterval = Function::createFromHostFunction(
              rt, PropNameID::forAscii(rt, "__hostClearInterval"), 1,
              [runtime](Runtime &, const Value &, const Value *args, size_t count) -> Value {
                if (count < 1 || !args[0].isNumber()) return Value::undefined();
                RuntimeState *state = stateFor(runtime);
                if (!state) return Value::undefined();
                JNIEnv *env = getEnv();
                if (!env) return Value::undefined();
                
                int timerId = static_cast<int>(args[0].asNumber());
                {
                  std::lock_guard<std::mutex> lock(state->timerContext->mutex);
                  state->timerContext->timers.erase(timerId);
                }
                
                env->CallVoidMethod(state->uiManager, state->cancelTimer, timerId);
                return Value::undefined();
              });
        
          auto hostRequestAnimationFrame = Function::createFromHostFunction(
              rt, PropNameID::forAscii(rt, "__hostRequestAnimationFrame"), 1,
              [runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
                if (count < 1 || !args[0].isObject()) return Value::undefined();
                Object fnObject = args[0].asObject(rt);
                if (!fnObject.isFunction(rt)) return Value::undefined();
        
                RuntimeState *state = stateFor(runtime);
                if (!state) return Value::undefined();
                JNIEnv *env = getEnv();
                if (!env) return Value::undefined();
        
                int timerId = state->timerContext->nextTimerId.fetch_add(1);
                {
                  std::lock_guard<std::mutex> lock(state->timerContext->mutex);
                  state->timerContext->timers[timerId] = {
                      std::make_shared<Function>(fnObject.asFunction(rt)),
                      {}, 
                      false
                  };
                }
        
                env->CallVoidMethod(state->uiManager, state->scheduleAnimationFrame,
                                    reinterpret_cast<jlong>(runtime), timerId);
                return Value(static_cast<double>(timerId));
              });
        
          auto hostCancelAnimationFrame = Function::createFromHostFunction(
              rt, PropNameID::forAscii(rt, "__hostCancelAnimationFrame"), 1,
              [runtime](Runtime &, const Value &, const Value *args, size_t count) -> Value {
                if (count < 1 || !args[0].isNumber()) return Value::undefined();
                RuntimeState *state = stateFor(runtime);
                if (!state) return Value::undefined();
                JNIEnv *env = getEnv();
                if (!env) return Value::undefined();
                
                int timerId = static_cast<int>(args[0].asNumber());
                {
                  std::lock_guard<std::mutex> lock(state->timerContext->mutex);
                  state->timerContext->timers.erase(timerId);
                }
                
                env->CallVoidMethod(state->uiManager, state->cancelAnimationFrame, timerId);
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
          runtime->evaluateJavaScript(buffer, "timers.js");
        }
        
        static const char *kZynthSharedValueKey = "__zynth_shared_value";
        
        void installSharedSignals(Runtime &rt, RuntimeState *state) {  if (!state) return;
  auto createSharedSignal = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "createSharedSignal"), 1,
      [state](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value::undefined();
        int id = state->nextSharedSignalId.fetch_add(1);
        double initial = args[0].asNumber();
        {
          std::lock_guard<std::mutex> lock(state->sharedSignalsMutex);
          state->sharedSignals[id] = initial;
        }
        __android_log_print(ANDROID_LOG_DEBUG, "ZynthWorklets",
                            "createSharedSignal id=%d value=%.3f", id, initial);
        return Value(static_cast<double>(id));
      });

  auto getSharedSignal = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "getSharedSignal"), 1,
      [state](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value::undefined();
        int id = static_cast<int>(args[0].asNumber());
        std::lock_guard<std::mutex> lock(state->sharedSignalsMutex);
        auto it = state->sharedSignals.find(id);
        if (it == state->sharedSignals.end()) return Value::undefined();
        return Value(it->second);
      });

  auto setSharedSignal = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setSharedSignal"), 2,
      [state](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isNumber()) {
          return Value::undefined();
        }
        int id = static_cast<int>(args[0].asNumber());
        double value = args[1].asNumber();
        {
          std::lock_guard<std::mutex> lock(state->sharedSignalsMutex);
          auto it = state->sharedSignals.find(id);
          if (it == state->sharedSignals.end()) return Value::undefined();
          it->second = value;
        }
        __android_log_print(ANDROID_LOG_DEBUG, "ZynthWorklets",
                            "setSharedSignal id=%d value=%.3f", id, value);
        return Value::undefined();
      });

  auto removeSharedSignal = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "removeSharedSignal"), 1,
      [state](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value::undefined();
        int id = static_cast<int>(args[0].asNumber());
        {
          std::lock_guard<std::mutex> lock(state->sharedSignalsMutex);
          state->sharedSignals.erase(id);
        }
        return Value::undefined();
      });

  Object shared(rt);
  shared.setProperty(rt, "createSharedSignal", createSharedSignal);
  shared.setProperty(rt, "getSharedSignal", getSharedSignal);
  shared.setProperty(rt, "setSharedSignal", setSharedSignal);
  shared.setProperty(rt, "removeSharedSignal", removeSharedSignal);
  rt.global().setProperty(rt, "__zynth_shared_signals", shared);
}

void ensureUIRuntime(const std::shared_ptr<RuntimeState> &state) {
  if (!state) return;
  if (state->uiRuntime) return;
  state->uiRuntime = facebook::hermes::makeHermesRuntime();
  installConsole(*state->uiRuntime, state.get());
  installGlobals(*state->uiRuntime);
  installSharedSignals(*state->uiRuntime, state.get());
  zynth::kit::installUICommandsRegistry(state, *state->uiRuntime);
  __android_log_print(ANDROID_LOG_DEBUG, "ZynthWorklets", "UI runtime created");
}

void registerWorkletOnUIRuntime(const std::shared_ptr<RuntimeState> &state, int workletId) {
  if (!state) return;
  ensureUIRuntime(state);
  if (!state->uiRuntime) return;
  ZynthWorkletDefinition definition;
  {
    std::lock_guard<std::mutex> lock(state->workletMutex);
    auto it = state->pendingWorklets.find(workletId);
    if (it == state->pendingWorklets.end()) {
      __android_log_print(ANDROID_LOG_WARN, "ZynthWorklets", "register missing id=%d", workletId);
      return;
    }
    definition = std::move(it->second);
    state->pendingWorklets.erase(it);
  }
  auto &rt = *state->uiRuntime;
  try {
    std::string source = "(" + definition.code + ")";
    source.append("\n//# sourceURL=zynth-worklet.js");
    auto buffer = std::make_shared<StringBuffer>(source);
    auto result = rt.evaluateJavaScript(buffer, "zynth-worklet.js");
    if (!result.isObject() || !result.getObject(rt).isFunction(rt)) {
      __android_log_print(ANDROID_LOG_WARN, "ZynthWorklets",
                          "register id=%d failed (not function)", workletId);
      return;
    }
    auto fn = std::make_shared<Function>(result.getObject(rt).getFunction(rt));
    {
      std::lock_guard<std::mutex> lock(state->workletMutex);
      state->uiWorklets[workletId] = fn;
      state->uiWorkletClosures[workletId] = std::move(definition.closure);
    }
    __android_log_print(ANDROID_LOG_DEBUG, "ZynthWorklets",
                        "registered id=%d location=%s", workletId, definition.location.c_str());
  } catch (const std::exception &ex) {
    __android_log_print(ANDROID_LOG_ERROR, "ZynthWorklets",
                        "register exception id=%d %s", workletId, ex.what());
  }
}

void runWorkletOnUIRuntime(const std::shared_ptr<RuntimeState> &state, int workletId) {
  if (!state) return;
  ensureUIRuntime(state);
  if (!state->uiRuntime) return;
  std::shared_ptr<Function> fn;
  std::vector<ZynthWorkletClosureValue> closure;
  {
    std::lock_guard<std::mutex> lock(state->workletMutex);
    auto it = state->uiWorklets.find(workletId);
    if (it == state->uiWorklets.end()) {
      __android_log_print(ANDROID_LOG_WARN, "ZynthWorklets", "run missing id=%d", workletId);
      return;
    }
    fn = it->second;
    auto closureIt = state->uiWorkletClosures.find(workletId);
    if (closureIt != state->uiWorkletClosures.end()) {
      closure = closureIt->second;
    }
  }
  auto &rt = *state->uiRuntime;
  Object global = rt.global();
  for (const auto &entry : closure) {
    auto propId = PropNameID::forUtf8(rt, entry.name);
    switch (entry.kind) {
      case ZynthWorkletClosureValue::Kind::Shared: {
        int sharedId = entry.sharedId;
        auto getter = Function::createFromHostFunction(
            rt, propId, 0,
            [state, sharedId](Runtime &, const Value &, const Value *, size_t) -> Value {
              std::lock_guard<std::mutex> lock(state->sharedSignalsMutex);
              auto it = state->sharedSignals.find(sharedId);
              if (it == state->sharedSignals.end()) return Value::undefined();
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
    __android_log_print(ANDROID_LOG_DEBUG, "ZynthWorklets", "run execute id=%d", workletId);
    fn->call(rt);
  } catch (const std::exception &ex) {
    __android_log_print(ANDROID_LOG_ERROR, "ZynthWorklets",
                        "run exception id=%d %s", workletId, ex.what());
  }
}

void installWorkletsBridge(Runtime &rt, facebook::hermes::HermesRuntime *runtime) {
  auto state = sharedStateFor(runtime);
  if (!state) return;
  auto registerWorklet = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "register"), 1,
      [state, runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (!state || count < 1 || !args[0].isObject()) return Value::undefined();
        Object payload = args[0].asObject(rt);
        if (!payload.hasProperty(rt, "code")) return Value::undefined();
        Value codeVal = payload.getProperty(rt, "code");
        if (!codeVal.isString()) return Value::undefined();
        ZynthWorkletDefinition definition;
        definition.code = codeVal.asString(rt).utf8(rt);
        if (payload.hasProperty(rt, "location")) {
          Value locVal = payload.getProperty(rt, "location");
          if (locVal.isString()) {
            definition.location = locVal.asString(rt).utf8(rt);
          }
        }
        if (payload.hasProperty(rt, "closure")) {
          Value closureVal = payload.getProperty(rt, "closure");
          if (closureVal.isObject()) {
            Object closureObj = closureVal.asObject(rt);
            Array keys = closureObj.getPropertyNames(rt);
            size_t keyCount = keys.size(rt);
            for (size_t i = 0; i < keyCount; i++) {
              Value keyVal = keys.getValueAtIndex(rt, i);
              if (!keyVal.isString()) continue;
              std::string name = keyVal.asString(rt).utf8(rt);
              Value entryVal = closureObj.getProperty(rt, name.c_str());
              if (entryVal.isObject()) {
                Object entryObj = entryVal.asObject(rt);
                if (entryObj.hasProperty(rt, kZynthSharedValueKey)) {
                  Value idVal = entryObj.getProperty(rt, kZynthSharedValueKey);
                  if (idVal.isNumber()) {
                    ZynthWorkletClosureValue entry;
                    entry.name = name;
                    entry.kind = ZynthWorkletClosureValue::Kind::Shared;
                    entry.sharedId = static_cast<int>(idVal.asNumber());
                    definition.closure.push_back(entry);
                  }
                }
                continue;
              }
              if (entryVal.isNumber()) {
                ZynthWorkletClosureValue entry;
                entry.name = name;
                entry.kind = ZynthWorkletClosureValue::Kind::Number;
                entry.numberValue = entryVal.asNumber();
                definition.closure.push_back(entry);
              } else if (entryVal.isBool()) {
                ZynthWorkletClosureValue entry;
                entry.name = name;
                entry.kind = ZynthWorkletClosureValue::Kind::Bool;
                entry.boolValue = entryVal.getBool();
                definition.closure.push_back(entry);
              } else if (entryVal.isString()) {
                ZynthWorkletClosureValue entry;
                entry.name = name;
                entry.kind = ZynthWorkletClosureValue::Kind::String;
                entry.stringValue = entryVal.asString(rt).utf8(rt);
                definition.closure.push_back(entry);
              }
            }
          }
        }
        int workletId = state->nextWorkletId.fetch_add(1);
        {
          std::lock_guard<std::mutex> lock(state->workletMutex);
          state->pendingWorklets[workletId] = std::move(definition);
        }
        JNIEnv *env = getEnv();
        if (env && state->jsBridgeClass && state->postRegisterWorklet) {
          env->CallStaticVoidMethod(state->jsBridgeClass, state->postRegisterWorklet,
                                    reinterpret_cast<jlong>(runtime), static_cast<jint>(workletId));
        }
        __android_log_print(ANDROID_LOG_DEBUG, "ZynthWorklets", "register id=%d", workletId);
        return Value(static_cast<double>(workletId));
      });

  auto runWorklet = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "run"), 1,
      [state, runtime](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (!state || count < 1 || !args[0].isNumber()) return Value::undefined();
        int workletId = static_cast<int>(args[0].asNumber());
        JNIEnv *env = getEnv();
        if (env && state->jsBridgeClass && state->postRunWorklet) {
          env->CallStaticVoidMethod(state->jsBridgeClass, state->postRunWorklet,
                                    reinterpret_cast<jlong>(runtime), static_cast<jint>(workletId),
                                    static_cast<jlong>(0));
        }
        return Value::undefined();
      });

  auto runAfter = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "runAfter"), 2,
      [state, runtime](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (!state || count < 2 || !args[0].isNumber() || !args[1].isNumber()) {
          return Value::undefined();
        }
        int workletId = static_cast<int>(args[0].asNumber());
        long delayMs = static_cast<long>(args[1].asNumber());
        JNIEnv *env = getEnv();
        if (env && state->jsBridgeClass && state->postRunWorklet) {
          env->CallStaticVoidMethod(state->jsBridgeClass, state->postRunWorklet,
                                    reinterpret_cast<jlong>(runtime), static_cast<jint>(workletId),
                                    static_cast<jlong>(delayMs));
        }
        return Value::undefined();
      });

  Object worklets(rt);
  worklets.setProperty(rt, "register", registerWorklet);
  worklets.setProperty(rt, "run", runWorklet);
  worklets.setProperty(rt, "runAfter", runAfter);
  rt.global().setProperty(rt, "__zynth_worklets", worklets);
}

void installUIBindings(Runtime &rt, facebook::hermes::HermesRuntime *runtime) {
  auto createNode = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "createNode"), 1,
      [runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isString()) return Value::undefined();
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        std::string type = args[0].asString(rt).utf8(rt);
        jstring jType = env->NewStringUTF(type.c_str());
        jint nodeId = env->CallIntMethod(state->uiManager, state->createNode, jType);
        env->DeleteLocalRef(jType);
        return Value(static_cast<double>(nodeId));
      });

  auto setProp = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setProp"), 3,
      [runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 3 || !args[0].isNumber() || !args[1].isString()) return Value::undefined();
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        jint nodeId = static_cast<jint>(args[0].asNumber());
        std::string name = args[1].asString(rt).utf8(rt);
        applyProp(rt, state, env, nodeId, name, args[2]);
        return Value::undefined();
      });

  auto setText = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setText"), 2,
      [runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber()) return Value::undefined();
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        jint nodeId = static_cast<jint>(args[0].asNumber());
        std::string text = args[1].isString() ? args[1].asString(rt).utf8(rt) : "";
        jstring jText = env->NewStringUTF(text.c_str());
        env->CallVoidMethod(state->uiManager, state->setText, nodeId, jText);
        env->DeleteLocalRef(jText);
        return Value::undefined();
      });

  auto insertChild = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "insertChild"), 3,
      [runtime](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 3 || !args[0].isNumber() || !args[1].isNumber() || !args[2].isNumber()) {
          return Value::undefined();
        }
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        env->CallVoidMethod(state->uiManager, state->insertChild,
                            static_cast<jint>(args[0].asNumber()),
                            static_cast<jint>(args[1].asNumber()),
                            static_cast<jint>(args[2].asNumber()));
        return Value::undefined();
      });

  auto removeChild = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "removeChild"), 2,
      [runtime](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isNumber()) return Value::undefined();
        removeHandlersForNode(static_cast<int>(args[1].asNumber()));
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        env->CallVoidMethod(state->uiManager, state->removeChild,
                            static_cast<jint>(args[0].asNumber()),
                            static_cast<jint>(args[1].asNumber()));
        return Value::undefined();
      });

  auto setHandler = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setHandler"), 3,
      [runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isString()) {
          return Value::undefined();
        }
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        jint nodeId = static_cast<jint>(args[0].asNumber());
        std::string name = args[1].asString(rt).utf8(rt);
        jstring jName = env->NewStringUTF(name.c_str());
        if (count >= 3 && args[2].isObject() && args[2].asObject(rt).isFunction(rt)) {
          Function fn = args[2].asObject(rt).asFunction(rt);
          std::lock_guard<std::mutex> lock(gHandlerMutex);
          gHandlers[HandlerKey{nodeId, name}] = HandlerEntry{
              runtime, std::make_shared<Function>(std::move(fn))};
        }
        env->CallVoidMethod(state->uiManager, state->setHandler, nodeId, jName);
        env->DeleteLocalRef(jName);
        return Value::undefined();
      });

  auto applyBatch = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "applyBatch"), 1,
      [runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1) return Value::undefined();
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        std::string json = args[0].isString() ? args[0].asString(rt).utf8(rt) : "";
        jstring jJson = env->NewStringUTF(json.c_str());
        env->CallVoidMethod(state->uiManager, state->applyBatch, jJson);
        env->DeleteLocalRef(jJson);
        return Value::undefined();
      });

  auto applyBatchTyped = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "applyBatchTyped"), 1,
      [runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isObject()) return Value::undefined();
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        Object payload = args[0].asObject(rt);
        Value opsPackedVal = payload.getProperty(rt, "ops");
        Value stringTableVal = payload.getProperty(rt, "stringTable");
        if (opsPackedVal.isObject() && stringTableVal.isObject()) {
          Object opsObject = opsPackedVal.asObject(rt);
          Object stringTableObject = stringTableVal.asObject(rt);
          if (!stringTableObject.isArray(rt)) return Value::undefined();
          Array stringTable = stringTableObject.asArray(rt);
          const size_t stringCount = stringTable.length(rt);
          jdoubleArray jOps = nullptr;
          if (opsObject.isArrayBuffer(rt)) {
            ArrayBuffer buffer = opsObject.getArrayBuffer(rt);
            const size_t byteLength = buffer.size(rt);
            const size_t opCount = byteLength / sizeof(double);
            if (state->applyBatchTypedBuffer) {
              jobject jBuffer = env->NewDirectByteBuffer(buffer.data(rt), static_cast<jlong>(byteLength));
              if (!jBuffer) return Value::undefined();

              jclass stringClass = env->FindClass("java/lang/String");
              jobjectArray jStrings = env->NewObjectArray(static_cast<jsize>(stringCount), stringClass, nullptr);
              env->DeleteLocalRef(stringClass);
              for (size_t i = 0; i < stringCount; i++) {
                Value entry = stringTable.getValueAtIndex(rt, i);
                if (entry.isString()) {
                  std::string utf8 = entry.asString(rt).utf8(rt);
                  jstring jStr = env->NewStringUTF(utf8.c_str());
                  env->SetObjectArrayElement(jStrings, static_cast<jsize>(i), jStr);
                  env->DeleteLocalRef(jStr);
                }
              }

              env->CallVoidMethod(state->uiManager, state->applyBatchTypedBuffer, jBuffer,
                                  static_cast<jint>(opCount), jStrings);
              env->DeleteLocalRef(jBuffer);
              env->DeleteLocalRef(jStrings);
              return Value::undefined();
            }

            if (!state->applyBatchTypedPacked) return Value::undefined();
            jOps = env->NewDoubleArray(static_cast<jsize>(opCount));
            if (!jOps) return Value::undefined();
            if (opCount > 0) {
              const auto *data = reinterpret_cast<const uint8_t *>(buffer.data(rt));
              std::vector<jdouble> opsBuffer(opCount);
              std::memcpy(opsBuffer.data(), data, opCount * sizeof(double));
              env->SetDoubleArrayRegion(jOps, 0, static_cast<jsize>(opCount), opsBuffer.data());
            }
          } else if (opsObject.isArray(rt)) {
            if (!state->applyBatchTypedPacked) return Value::undefined();
            Array opsPacked = opsObject.asArray(rt);
            const size_t opCount = opsPacked.length(rt);
            jOps = env->NewDoubleArray(static_cast<jsize>(opCount));
            if (!jOps) return Value::undefined();
            std::vector<jdouble> opsBuffer(opCount);
            for (size_t i = 0; i < opCount; i++) {
              Value opVal = opsPacked.getValueAtIndex(rt, i);
              opsBuffer[i] = opVal.isNumber() ? opVal.asNumber() : 0.0;
            }
            env->SetDoubleArrayRegion(jOps, 0, static_cast<jsize>(opCount), opsBuffer.data());
          } else {
            return Value::undefined();
          }

          jclass stringClass = env->FindClass("java/lang/String");
          jobjectArray jStrings = env->NewObjectArray(static_cast<jsize>(stringCount), stringClass, nullptr);
          env->DeleteLocalRef(stringClass);
          for (size_t i = 0; i < stringCount; i++) {
            Value entry = stringTable.getValueAtIndex(rt, i);
            if (entry.isString()) {
              std::string utf8 = entry.asString(rt).utf8(rt);
              jstring jStr = env->NewStringUTF(utf8.c_str());
              env->SetObjectArrayElement(jStrings, static_cast<jsize>(i), jStr);
              env->DeleteLocalRef(jStr);
            }
          }

          env->CallVoidMethod(state->uiManager, state->applyBatchTypedPacked, jOps, jStrings);
          env->DeleteLocalRef(jOps);
          env->DeleteLocalRef(jStrings);
          return Value::undefined();
        }
        Value opsVal = payload.getProperty(rt, "operations");
        if (!opsVal.isObject()) return Value::undefined();
        Array ops = opsVal.asObject(rt).asArray(rt);
        const size_t opCount = ops.length(rt);
        for (size_t i = 0; i < opCount; i++) {
          Value opVal = ops.getValueAtIndex(rt, i);
          if (!opVal.isObject()) continue;
          Object op = opVal.asObject(rt);
          Value typeVal = op.getProperty(rt, "type");
          if (!typeVal.isString()) continue;
          std::string type = typeVal.asString(rt).utf8(rt);
          if (type == "createNode") {
            Value tagVal = op.getProperty(rt, "tag");
            if (tagVal.isString()) {
              __android_log_print(ANDROID_LOG_WARN, "ZynthUI",
                                  "applyBatchTyped createNode op is unsupported on Android");
            }
            continue;
          }
          if (type == "setProp") {
            Value idVal = op.getProperty(rt, "nodeId");
            Value nameVal = op.getProperty(rt, "name");
            Value valueVal = op.getProperty(rt, "value");
            if (!idVal.isNumber() || !nameVal.isString()) continue;
            applyProp(rt, state, env, static_cast<jint>(idVal.asNumber()),
                      nameVal.asString(rt).utf8(rt), valueVal);
            continue;
          }
          if (type == "setText") {
            Value idVal = op.getProperty(rt, "nodeId");
            Value valueVal = op.getProperty(rt, "value");
            if (!idVal.isNumber()) continue;
            std::string text;
            if (valueVal.isString()) {
              text = valueVal.asString(rt).utf8(rt);
            } else if (valueVal.isNumber()) {
              text = std::to_string(valueVal.asNumber());
            }
            jstring jText = env->NewStringUTF(text.c_str());
            env->CallVoidMethod(state->uiManager, state->setText, static_cast<jint>(idVal.asNumber()), jText);
            env->DeleteLocalRef(jText);
            continue;
          }
          if (type == "insertChild") {
            Value parentVal = op.getProperty(rt, "parentId");
            Value childVal = op.getProperty(rt, "childId");
            Value indexVal = op.getProperty(rt, "index");
            if (!parentVal.isNumber() || !childVal.isNumber() || !indexVal.isNumber()) continue;
            env->CallVoidMethod(state->uiManager, state->insertChild,
                                static_cast<jint>(parentVal.asNumber()),
                                static_cast<jint>(childVal.asNumber()),
                                static_cast<jint>(indexVal.asNumber()));
            continue;
          }
          if (type == "removeChild") {
            Value parentVal = op.getProperty(rt, "parentId");
            Value childVal = op.getProperty(rt, "childId");
            if (!parentVal.isNumber() || !childVal.isNumber()) continue;
            removeHandlersForNode(static_cast<int>(childVal.asNumber()));
            env->CallVoidMethod(state->uiManager, state->removeChild,
                                static_cast<jint>(parentVal.asNumber()),
                                static_cast<jint>(childVal.asNumber()));
            continue;
          }
        }
        return Value::undefined();
      });

  auto setSurface = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setSurface"), 1,
      [runtime](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value::undefined();
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        env->CallVoidMethod(state->uiManager, state->setSurface, static_cast<jint>(args[0].asNumber()));
        return Value::undefined();
      });

  auto flush = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "flush"), 0,
      [runtime](Runtime &, const Value &, const Value *, size_t) -> Value {
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        env->CallVoidMethod(state->uiManager, state->flush);
        return Value::undefined();
      });

  Object ui(rt);
  ui.setProperty(rt, "createNode", createNode);
  ui.setProperty(rt, "setProp", setProp);
  ui.setProperty(rt, "setText", setText);
  ui.setProperty(rt, "insertChild", insertChild);
  ui.setProperty(rt, "removeChild", removeChild);
  ui.setProperty(rt, "setHandler", setHandler);
  ui.setProperty(rt, "applyBatch", applyBatch);
  ui.setProperty(rt, "applyBatchTyped", applyBatchTyped);
  ui.setProperty(rt, "setSurface", setSurface);
  ui.setProperty(rt, "flush", flush);
  ui.setProperty(rt, "__supportsTypedProps", true);
  ui.setProperty(rt, "__supportsTypedBatch", true);
  rt.global().setProperty(rt, "__ui", ui);
}

} // namespace

namespace zynth::kit {

void uiCommandSetProp(
    const UICommandsState &state,
    int nodeId,
    const std::string &name,
    const std::string &value) {
  if (!state) return;
  auto resolved = std::static_pointer_cast<RuntimeState>(state);
  if (!resolved) return;
  JNIEnv *env = getEnv();
  if (!env) return;
  jstring jName = env->NewStringUTF(name.c_str());
  jstring jValue = env->NewStringUTF(value.c_str());
  env->CallVoidMethod(resolved->uiManager, resolved->setProp, static_cast<jint>(nodeId), jName, jValue);
  env->DeleteLocalRef(jName);
  env->DeleteLocalRef(jValue);
}

} // namespace zynth::kit

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_invokeAnimationFrame(JNIEnv *,
                                                jobject,
                                                jlong ptr,
                                                jint callbackId,
                                                jdouble timestampMs) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return;
  
  std::shared_ptr<Function> callback;

  {
    std::shared_ptr<TimerContext> ctx;
    {
      std::lock_guard<std::mutex> lock(gStateMutex);
      auto it = gStates.find(runtime);
      if (it != gStates.end() && it->second) {
        ctx = it->second->timerContext;
      }
    }
    
    if (ctx) {
      std::lock_guard<std::mutex> lock(ctx->mutex);
      auto &timers = ctx->timers;
      auto tit = timers.find(callbackId);
      if (tit != timers.end()) {
        callback = tit->second.callback;
        timers.erase(tit); // RAF is one-shot
      }
    }
  }

  if (callback) {
    Runtime &rt = *runtime;
    Value arg(timestampMs);
    try {
      callback->call(rt, arg);
    } catch (const JSError &error) {
       __android_log_print(ANDROID_LOG_ERROR, "ZynthJS", "RAF error: %s", error.getMessage().c_str());
       auto state = sharedStateFor(runtime);
       std::string message = error.getMessage();
       std::string stack = error.getStack();
       std::string combined = stack.empty() ? message : (message + "\n" + stack);
       emitDevtoolsEvent(state.get(), "error/js", "error", "js", combined);
    } catch (...) {
       __android_log_print(ANDROID_LOG_ERROR, "ZynthJS", "RAF exception");
    }
  }
}

extern "C" jint JNI_OnLoad(JavaVM *vm, void *) {
  gVm = vm;
  return facebook::jni::initialize(vm, [] {});
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_zynth_kit_runtime_JSBridge_createHermesRuntime(JNIEnv *, jobject) {
  auto runtime = facebook::hermes::makeHermesRuntime();
  return reinterpret_cast<jlong>(runtime.release());
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_destroyHermesRuntime(JNIEnv *, jobject, jlong ptr) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return;
  {
    std::lock_guard<std::mutex> lock(gStateMutex);
    auto it = gStates.find(runtime);
    if (it != gStates.end()) {
      JNIEnv *env = getEnv();
      if (env && it->second) {
        if (it->second->uiManager) env->DeleteGlobalRef(it->second->uiManager);
        if (it->second->uiClass) env->DeleteGlobalRef(it->second->uiClass);
        if (it->second->jsBridgeClass) env->DeleteGlobalRef(it->second->jsBridgeClass);
        if (it->second->devtoolsClass) env->DeleteGlobalRef(it->second->devtoolsClass);
      }
      gStates.erase(it);
    }
  }
  delete runtime;
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_installUIBindings(JNIEnv *env, jobject, jlong ptr, jobject uiManager) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime || !uiManager) return;

  auto state = std::make_shared<RuntimeState>();
  state->runtime = runtime;
  state->uiManager = env->NewGlobalRef(uiManager);
  state->uiClass = static_cast<jclass>(env->NewGlobalRef(env->GetObjectClass(uiManager)));
  state->createNode = env->GetMethodID(state->uiClass, "createNode", "(Ljava/lang/String;)I");
  state->setProp = env->GetMethodID(state->uiClass, "setProp", "(ILjava/lang/String;Ljava/lang/String;)V");
  state->setText = env->GetMethodID(state->uiClass, "setText", "(ILjava/lang/String;)V");
  state->insertChild = env->GetMethodID(state->uiClass, "insertChild", "(III)V");
  state->removeChild = env->GetMethodID(state->uiClass, "removeChild", "(II)V");
  state->setHandler = env->GetMethodID(state->uiClass, "setHandler", "(ILjava/lang/String;)V");
  state->applyBatch = env->GetMethodID(state->uiClass, "applyBatch", "(Ljava/lang/String;)V");
  state->applyBatchTypedPacked =
      env->GetMethodID(state->uiClass, "applyBatchTypedPacked", "([D[Ljava/lang/String;)V");
  state->applyBatchTypedBuffer =
      env->GetMethodID(state->uiClass, "applyBatchTypedBuffer", "(Ljava/nio/ByteBuffer;I[Ljava/lang/String;)V");
  state->setSurface = env->GetMethodID(state->uiClass, "setSurface", "(I)V");
  state->flush = env->GetMethodID(state->uiClass, "flush", "()V");
  state->scheduleTimer = env->GetMethodID(state->uiClass, "scheduleTimer", "(JIIZ)V");
  state->cancelTimer = env->GetMethodID(state->uiClass, "cancelTimer", "(I)V");
  state->scheduleAnimationFrame = env->GetMethodID(state->uiClass, "scheduleAnimationFrame", "(JI)V");
  state->cancelAnimationFrame = env->GetMethodID(state->uiClass, "cancelAnimationFrame", "(I)V");
  jclass bridgeClass = env->FindClass("com/zynth/kit/runtime/JSBridge");
  if (bridgeClass) {
    state->jsBridgeClass = static_cast<jclass>(env->NewGlobalRef(bridgeClass));
    env->DeleteLocalRef(bridgeClass);
    state->postRegisterWorklet = env->GetStaticMethodID(state->jsBridgeClass, "postRegisterWorklet", "(JI)V");
    state->postRunWorklet = env->GetStaticMethodID(state->jsBridgeClass, "postRunWorklet", "(JIJ)V");
  }
  jclass devtoolsClass = env->FindClass("com/zynth/kit/runtime/modules/DevtoolsModule");
  if (devtoolsClass) {
    state->devtoolsClass = static_cast<jclass>(env->NewGlobalRef(devtoolsClass));
    env->DeleteLocalRef(devtoolsClass);
    state->devtoolsEmit = env->GetStaticMethodID(state->devtoolsClass, "emitNativeEvent", "(Ljava/lang/String;)V");
    state->devtoolsIsConnected = env->GetStaticMethodID(state->devtoolsClass, "isConnected", "()Z");
    if (!gDevtoolsClass) {
      gDevtoolsClass = static_cast<jclass>(env->NewGlobalRef(state->devtoolsClass));
      gDevtoolsEmitMethod = state->devtoolsEmit;
    }
  }

  {
    std::lock_guard<std::mutex> lock(gStateMutex);
    gStates[runtime] = state;
  }

  installConsole(*runtime, state.get());
  installGlobals(*runtime);
  installDevtoolsBridge(*runtime, state.get());
  installCrashSignalHandlers();
  installModulesStub(*runtime);
  installTimers(*runtime, runtime);
  installUIBindings(*runtime, runtime);
  installSharedSignals(*runtime, state.get());
  installWorkletsBridge(*runtime, runtime);
  auto shared = sharedStateFor(runtime);
  if (shared) {
    zynth::kit::installUICommandsRegistry(shared, *runtime);
  }
  runtime->global().setProperty(
      *runtime, "__ZYNTH_PLATFORM", String::createFromUtf8(*runtime, "android"));
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_evaluateScript(JNIEnv *env, jobject, jlong ptr, jstring code, jstring sourceUrl) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime || !code) return;
  const char *utf8 = env->GetStringUTFChars(code, nullptr);
  std::string script = utf8 ? utf8 : "";
  env->ReleaseStringUTFChars(code, utf8);
  const char *source = sourceUrl ? env->GetStringUTFChars(sourceUrl, nullptr) : nullptr;
  auto buffer = std::make_shared<StringBuffer>(script);
  try {
    runtime->evaluateJavaScript(buffer, source ? source : "<android>");
  } catch (...) {
    return;
  }
  if (sourceUrl && source) env->ReleaseStringUTFChars(sourceUrl, source);
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_callGlobalDouble(JNIEnv *env, jobject, jlong ptr, jstring name, jdouble value) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime || !name) return;
  const char *utf8 = env->GetStringUTFChars(name, nullptr);
  std::string propName = utf8 ? utf8 : "";
  env->ReleaseStringUTFChars(name, utf8);
  Runtime &rt = *runtime;
  auto propId = PropNameID::forAscii(rt, propName.c_str());
  if (!rt.global().hasProperty(rt, propId)) return;
  Value fnVal = rt.global().getProperty(rt, propId);
  if (!fnVal.isObject() || !fnVal.asObject(rt).isFunction(rt)) return;
  Function fn = fnVal.asObject(rt).asFunction(rt);
  Value arg(static_cast<double>(value));
  auto callFn = static_cast<Value (Function::*)(Runtime&, const Value*, size_t) const>(&Function::call);
  try {
    (fn.*callFn)(rt, &arg, 1);
  } catch (...) {
    return;
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_callGlobalFrame(JNIEnv *env,
                                                    jobject,
                                                    jlong ptr,
                                                    jstring name,
                                                    jdouble frameMs,
                                                    jdouble layoutMs,
                                                    jboolean overBudget,
                                                    jint nodeCount) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime || !name) return;
  const char *utf8 = env->GetStringUTFChars(name, nullptr);
  std::string propName = utf8 ? utf8 : "";
  env->ReleaseStringUTFChars(name, utf8);
  Runtime &rt = *runtime;
  auto propId = PropNameID::forAscii(rt, propName.c_str());
  if (!rt.global().hasProperty(rt, propId)) return;
  Value fnVal = rt.global().getProperty(rt, propId);
  if (!fnVal.isObject() || !fnVal.asObject(rt).isFunction(rt)) return;
  Function fn = fnVal.asObject(rt).asFunction(rt);
  Value args[] = {
    Value((double)frameMs),
    Value((double)layoutMs),
    Value((bool)(overBudget == JNI_TRUE)),
    Value((double)nodeCount),
  };
  auto callFn = static_cast<Value (Function::*)(Runtime&, const Value*, size_t) const>(&Function::call);
  try {
    (fn.*callFn)(rt, args, 4);
  } catch (...) {
    return;
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_emitEvent(JNIEnv *env,
                                              jobject,
                                              jlong ptr,
                                              jstring name,
                                              jstring payloadJson) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime || !name) return;
  const char *utf8 = env->GetStringUTFChars(name, nullptr);
  std::string eventName = utf8 ? utf8 : "";
  env->ReleaseStringUTFChars(name, utf8);
  if (eventName.empty()) return;
  Runtime &rt = *runtime;
  if (!rt.global().hasProperty(rt, "ZynthNativeEmitter")) return;
  Object emitter = rt.global().getPropertyAsObject(rt, "ZynthNativeEmitter");
  if (!emitter.hasProperty(rt, "emit")) return;
  Function emitFn = emitter.getPropertyAsFunction(rt, "emit");
  Value payload = Value::undefined();
  if (payloadJson) {
    const char *payloadUtf8 = env->GetStringUTFChars(payloadJson, nullptr);
    std::string payloadStr = payloadUtf8 ? payloadUtf8 : "";
    env->ReleaseStringUTFChars(payloadJson, payloadUtf8);
    if (!payloadStr.empty()) {
      try {
        Object json = rt.global().getPropertyAsObject(rt, "JSON");
        Function parse = json.getPropertyAsFunction(rt, "parse");
        String jsonStr = String::createFromUtf8(rt, payloadStr);
        payload = parse.call(rt, jsonStr);
      } catch (...) {
        payload = Value::undefined();
      }
    }
  }
  try {
    emitFn.call(rt, String::createFromUtf8(rt, eventName), payload);
  } catch (...) {
    return;
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_invokePressEvent(JNIEnv *env,
                                                     jobject,
                                                     jint nodeId,
                                                     jstring name,
                                                     jdouble x,
                                                     jdouble y,
                                                     jdouble screenX,
                                                     jdouble screenY,
                                                     jdouble durationMs,
                                                     jdouble timestampMs,
                                                     jboolean cancelled) {
  if (!name) return;
  const char *utf8 = env->GetStringUTFChars(name, nullptr);
  std::string eventName = utf8 ? utf8 : "";
  env->ReleaseStringUTFChars(name, utf8);
  if (eventName.empty()) return;
  facebook::hermes::HermesRuntime *runtime = nullptr;
  std::shared_ptr<Function> handler;
  {
    std::lock_guard<std::mutex> lock(gHandlerMutex);
    auto it = gHandlers.find(HandlerKey{static_cast<int>(nodeId), eventName});
    if (it == gHandlers.end()) return;
    runtime = it->second.runtime;
    handler = it->second.handler;
  }
  if (!runtime || !handler) return;
  Runtime &rt = *runtime;
  Object payload(rt);
  payload.setProperty(rt, "x", static_cast<double>(x));
  payload.setProperty(rt, "y", static_cast<double>(y));
  payload.setProperty(rt, "screenX", static_cast<double>(screenX));
  payload.setProperty(rt, "screenY", static_cast<double>(screenY));
  if (durationMs >= 0) {
    payload.setProperty(rt, "durationMs", static_cast<double>(durationMs));
  }
  payload.setProperty(rt, "timestamp", static_cast<double>(timestampMs));
  payload.setProperty(rt, "pointerType", String::createFromUtf8(rt, "touch"));
  payload.setProperty(rt, "canceled", cancelled == JNI_TRUE);
  try {
    handler->call(rt, payload);
  } catch (const JSError &error) {
    auto state = sharedStateFor(runtime);
    std::string message = error.getMessage();
    std::string stack = error.getStack();
    std::string combined = stack.empty() ? message : (message + "\n" + stack);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", combined);
  } catch (...) {
    return;
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_invokeEvent(JNIEnv *env,
                                                jobject,
                                                jint nodeId,
                                                jstring name,
                                                jstring payloadJson) {
  if (!name) return;
  const char *utf8 = env->GetStringUTFChars(name, nullptr);
  std::string eventName = utf8 ? utf8 : "";
  env->ReleaseStringUTFChars(name, utf8);
  if (eventName.empty()) return;
  facebook::hermes::HermesRuntime *runtime = nullptr;
  std::shared_ptr<Function> handler;
  {
    std::lock_guard<std::mutex> lock(gHandlerMutex);
    auto it = gHandlers.find(HandlerKey{static_cast<int>(nodeId), eventName});
    if (it == gHandlers.end()) return;
    runtime = it->second.runtime;
    handler = it->second.handler;
  }
  if (!runtime || !handler) return;
  Runtime &rt = *runtime;
  Value arg = Value::undefined();
  if (payloadJson) {
    const char *payloadUtf8 = env->GetStringUTFChars(payloadJson, nullptr);
    std::string payload = payloadUtf8 ? payloadUtf8 : "";
    env->ReleaseStringUTFChars(payloadJson, payloadUtf8);
    if (!payload.empty()) {
      try {
        Object json = rt.global().getPropertyAsObject(rt, "JSON");
        Function parse = json.getPropertyAsFunction(rt, "parse");
        String jsonStr = String::createFromUtf8(rt, payload);
        arg = parse.call(rt, jsonStr);
      } catch (...) {
        arg = Value::undefined();
      }
    }
  }
  try {
    handler->call(rt, arg);
  } catch (const JSError &error) {
    auto state = sharedStateFor(runtime);
    std::string message = error.getMessage();
    std::string stack = error.getStack();
    std::string combined = stack.empty() ? message : (message + "\n" + stack);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", combined);
  } catch (...) {
    return;
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_invokeTimer(JNIEnv *,
                                                jobject,
                                                jlong ptr,
                                                jint timerId) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return;
  
  std::shared_ptr<Function> callback;
  std::vector<Value> args;
  bool isInterval = false;

  {
    std::shared_ptr<TimerContext> ctx;
    {
      std::lock_guard<std::mutex> lock(gStateMutex);
      auto it = gStates.find(runtime);
      if (it != gStates.end() && it->second) {
        ctx = it->second->timerContext;
      }
    }
    
    if (ctx) {
      std::lock_guard<std::mutex> lock(ctx->mutex);
      auto &timers = ctx->timers;
      auto tit = timers.find(timerId);
      if (tit != timers.end()) {
        callback = tit->second.callback;
        Runtime &rt = *runtime;
        for (const auto &v : tit->second.args) {
          args.emplace_back(Value(rt, v));
        }
        isInterval = tit->second.repeat;
        
        if (!isInterval) {
          timers.erase(tit);
        }
      }
    }
  }

  if (callback) {
    Runtime &rt = *runtime;
    const Value *argsPtr = args.empty() ? nullptr : args.data();
    try {
      callback->call(rt, argsPtr, args.size());
    } catch (const JSError &error) {
      __android_log_print(ANDROID_LOG_ERROR, "ZynthJS", "Timer error: %s", error.getMessage().c_str());
      auto state = sharedStateFor(runtime);
      std::string message = error.getMessage();
      std::string stack = error.getStack();
      std::string combined = stack.empty() ? message : (message + "\n" + stack);
      emitDevtoolsEvent(state.get(), "error/js", "error", "js", combined);
    } catch (...) {
      __android_log_print(ANDROID_LOG_ERROR, "ZynthJS", "Timer exception");
    }
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_registerWorkletOnUiRuntime(JNIEnv *,
                                                               jobject,
                                                               jlong ptr,
                                                               jint workletId) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return;
  auto state = sharedStateFor(runtime);
  if (!state) return;
  registerWorkletOnUIRuntime(state, workletId);
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_runWorkletOnUiRuntime(JNIEnv *,
                                                          jobject,
                                                          jlong ptr,
                                                          jint workletId) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return;
  auto state = sharedStateFor(runtime);
  if (!state) return;
  runWorkletOnUIRuntime(state, workletId);
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_invokeLayoutEvent(JNIEnv *,
                                                      jobject,
                                                      jint nodeId,
                                                      jdouble x,
                                                      jdouble y,
                                                      jdouble width,
                                                      jdouble height) {
  facebook::hermes::HermesRuntime *runtime = nullptr;
  std::shared_ptr<Function> handler;
  {
    std::lock_guard<std::mutex> lock(gHandlerMutex);
    auto it = gHandlers.find(HandlerKey{static_cast<int>(nodeId), "onLayout"});
    if (it == gHandlers.end()) return;
    runtime = it->second.runtime;
    handler = it->second.handler;
  }
  if (!runtime || !handler) return;
  Runtime &rt = *runtime;
  Object payload(rt);
  Object nativeEvent(rt);
  Object layout(rt);
  layout.setProperty(rt, "x", static_cast<double>(x));
  layout.setProperty(rt, "y", static_cast<double>(y));
  layout.setProperty(rt, "width", static_cast<double>(width));
  layout.setProperty(rt, "height", static_cast<double>(height));
  nativeEvent.setProperty(rt, "layout", layout);
  payload.setProperty(rt, "nativeEvent", nativeEvent);
  try {
    handler->call(rt, payload);
  } catch (const JSError &error) {
    auto state = sharedStateFor(runtime);
    std::string message = error.getMessage();
    std::string stack = error.getStack();
    std::string combined = stack.empty() ? message : (message + "\n" + stack);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", combined);
  } catch (...) {
    return;
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_invokeLayoutEventsBatch(JNIEnv *env,
                                                            jobject,
                                                            jdoubleArray payload) {
  if (!payload) return;
  jsize length = env->GetArrayLength(payload);
  if (length < 5) return;
  jdouble *data = env->GetDoubleArrayElements(payload, nullptr);
  if (!data) return;
  for (jsize i = 0; i + 4 < length; i += 5) {
    int nodeId = static_cast<int>(data[i]);
    double x = data[i + 1];
    double y = data[i + 2];
    double width = data[i + 3];
    double height = data[i + 4];

    facebook::hermes::HermesRuntime *runtime = nullptr;
    std::shared_ptr<Function> handler;
    {
      std::lock_guard<std::mutex> lock(gHandlerMutex);
      auto it = gHandlers.find(HandlerKey{nodeId, "onLayout"});
      if (it == gHandlers.end()) continue;
      runtime = it->second.runtime;
      handler = it->second.handler;
    }
    if (!runtime || !handler) continue;
    Runtime &rt = *runtime;
    Object payloadObj(rt);
    Object nativeEvent(rt);
    Object layout(rt);
    layout.setProperty(rt, "x", x);
    layout.setProperty(rt, "y", y);
    layout.setProperty(rt, "width", width);
    layout.setProperty(rt, "height", height);
    nativeEvent.setProperty(rt, "layout", layout);
    payloadObj.setProperty(rt, "nativeEvent", nativeEvent);
    try {
      handler->call(rt, payloadObj);
    } catch (const JSError &error) {
      auto state = sharedStateFor(runtime);
      std::string message = error.getMessage();
      std::string stack = error.getStack();
      std::string combined = stack.empty() ? message : (message + "\n" + stack);
      emitDevtoolsEvent(state.get(), "error/js", "error", "js", combined);
    } catch (...) {
      continue;
    }
  }
  env->ReleaseDoubleArrayElements(payload, data, JNI_ABORT);
}
