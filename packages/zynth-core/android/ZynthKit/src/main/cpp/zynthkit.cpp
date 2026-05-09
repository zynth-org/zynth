#include <jni.h>
#include <android/log.h>
#include <fbjni/fbjni.h>
#include <hermes/hermes.h>
#include <jsi/jsi.h>

#include "UICommandsRegistry.h"
#include "ZynthJSIPluginRegistry.h"
#include "ZynthRendererTelemetry.h"
#include "ZynthProp.h"
#include "ZynthCommit.h"
#include "ZynthCommitDecoder.h"
#include "ZynthRendererHost.h"
#include "ZynthYogaTree.h"
#include "ZynthMeasureRegistry.h"

#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <atomic>
#include <cstring>
#include <cstdint>
#include <vector>
#include <limits>
#include <algorithm>
#include <cctype>

using namespace facebook::jsi;

namespace {
JavaVM *gVm = nullptr;
std::atomic<bool> gCrashHandlerInstalled{false};
jclass gDevtoolsClass = nullptr;
jmethodID gDevtoolsEmitMethod = nullptr;
jclass gNativeOverlayClass = nullptr;
jmethodID gNativeOverlayHandleRawMethod = nullptr;
std::mutex gPluginMutex;
std::vector<ZynthJSIPluginInstaller> gPluginInstallers;
std::vector<ZynthSharedSignalChangedCallback> gSharedSignalCallbacks;

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
  jclass nativeOverlayClass = nullptr;
  jclass performanceOverlayClass = nullptr;
  jmethodID createNode = nullptr;
  jmethodID createNodeWithId = nullptr;
  jmethodID dropNode = nullptr;
  jmethodID setProp = nullptr;
  jmethodID setText = nullptr;
  jmethodID measureNode = nullptr;
  jmethodID syncTextInputState = nullptr;
  jmethodID insertChild = nullptr;
  jmethodID removeChild = nullptr;
  jmethodID setHandler = nullptr;
  jmethodID setInputHandler = nullptr;
  jmethodID clearInputHandler = nullptr;
  jmethodID applyBatch = nullptr;
  jmethodID applyBatchTypedPacked = nullptr;
  jmethodID applyBatchTypedBuffer = nullptr;
  jmethodID applyMountTransaction = nullptr;
  jmethodID applyMountTransactionSync = nullptr;
  jmethodID setNativeCommitEnabled = nullptr;
  jmethodID beginAtomicCommit = nullptr;
  jmethodID endAtomicCommit = nullptr;
  jmethodID setSurface = nullptr;
  jmethodID flush = nullptr;
  jmethodID scheduleTimer = nullptr;
  jmethodID cancelTimer = nullptr;
  jmethodID scheduleAnimationFrame = nullptr;
  jmethodID cancelAnimationFrame = nullptr;
  jmethodID applyAnimatedStyle = nullptr;
  jmethodID applyAnimatedLayoutStyle = nullptr;
  jmethodID postRegisterWorklet = nullptr;
  jmethodID postRunWorklet = nullptr;
  jmethodID devtoolsEmit = nullptr;
  jmethodID devtoolsIsConnected = nullptr;
  jmethodID nativeOverlayHandleRaw = nullptr;
  jmethodID performanceOverlayRecordYoga = nullptr;
  jobject moduleRegistry = nullptr;
  jclass moduleRegistryClass = nullptr;
  jmethodID moduleCall = nullptr;
  jmethodID moduleCallSync = nullptr;
  jclass jsonObjectClass = nullptr;
  jmethodID jsonObjectConstructor = nullptr;
  jclass doubleClass = nullptr;
  jmethodID doubleConstructor = nullptr;
  jclass booleanClass = nullptr;
  jmethodID booleanConstructor = nullptr;
  jclass stringClass = nullptr;
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
  std::atomic<int> nextSyncSignalId{1};
  std::unordered_map<int, std::string> syncSignals;
  std::mutex syncSignalsMutex;
  std::unordered_map<int, int> syncSignalBindings; // nodeId -> signalId
  std::mutex syncSignalBindingsMutex;

  // Phase 0-2: Native renderer commit pipeline
  bool useNativeCommit = true; ///< Runtime flag: true = native decode, false = legacy Kotlin decode
  zynth::ZynthCommit nativeCommit; ///< Reusable commit buffer to avoid per-batch allocation
  zynth::ZynthRendererHost rendererHost; ///< Phase 2: authoritative native node/surface state
  
  // Phase 3: Native Yoga Ownership
  std::unique_ptr<zynth::ZynthYogaTree> yogaTree;
  
  // Phase 5: Text Measurement Cache
  zynth::ZynthMeasureRegistry measureRegistry;
  zynth::ZynthCommitTelemetry* currentTelemetry = nullptr;
  
  RuntimeState() : yogaTree(std::make_unique<zynth::ZynthYogaTree>(&rendererHost)) {
    // We will set measureFunc_ and callback after JNI is initialized
  }
};

thread_local RuntimeState* g_currentLayoutState = nullptr;

static YGSize zynthYogaMeasureFunc(YGNodeConstRef node, float width, YGMeasureMode widthMode, float height, YGMeasureMode heightMode) {
  if (!g_currentLayoutState) return {0, 0};
  int32_t nodeId = static_cast<int32_t>(reinterpret_cast<intptr_t>(YGNodeGetContext(node)));
  
  auto* record = g_currentLayoutState->rendererHost.getNode(nodeId);
  if (!record) return {0, 0};
  
  uint32_t hits = 0;
  uint32_t misses = 0;
  int64_t dummy = 0;
  zynth::ZynthPhaseTimer timer(g_currentLayoutState->currentTelemetry ? g_currentLayoutState->currentTelemetry->measureCallbackUs : dummy);
  
  YGSize res = g_currentLayoutState->measureRegistry.measure(
      nodeId, record->contentRevision, width, widthMode, height, heightMode, hits, misses);
      
  if (g_currentLayoutState->currentTelemetry) {
      g_currentLayoutState->currentTelemetry->measureCacheHits += hits;
      g_currentLayoutState->currentTelemetry->measureCacheMisses += misses;
  }
  return res;
}

std::mutex gStateMutex;
std::unordered_map<facebook::hermes::HermesRuntime *, std::shared_ptr<RuntimeState>> gStates;

struct HandlerKey {
  facebook::hermes::HermesRuntime *runtime;
  int nodeId;
  std::string name;

  bool operator==(const HandlerKey &other) const {
    return runtime == other.runtime && nodeId == other.nodeId && name == other.name;
  }
};

struct HandlerKeyHash {
  size_t operator()(const HandlerKey &key) const {
    size_t h0 = std::hash<uintptr_t>()(reinterpret_cast<uintptr_t>(key.runtime));
    size_t h1 = std::hash<int>()(key.nodeId);
    size_t h2 = std::hash<std::string>()(key.name);
    return h0 ^ (h1 << 1) ^ (h2 << 2);
  }
};

struct HandlerEntry {
  facebook::hermes::HermesRuntime *runtime = nullptr;
  std::shared_ptr<Function> handler;
};

std::mutex gHandlerMutex;
std::unordered_map<HandlerKey, HandlerEntry, HandlerKeyHash> gHandlers;

void removeHandlersForNode(facebook::hermes::HermesRuntime *runtime, int nodeId) {
  std::lock_guard<std::mutex> lock(gHandlerMutex);
  for (auto it = gHandlers.begin(); it != gHandlers.end();) {
    if (it->first.runtime == runtime && it->first.nodeId == nodeId) {
      it = gHandlers.erase(it);
    } else {
      ++it;
    }
  }
}

JNIEnv *getEnv() {
  if (!gVm) return facebook::jni::Environment::current();
  JNIEnv *env = nullptr;
  if (gVm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) == JNI_OK) {
    return env;
  }
  // Do not pair this with ThreadScope/DetachCurrentThread: the JS runtime runs
  // on a Java HandlerThread, and ART aborts if a Java-owned thread is detached.
  if (gVm->AttachCurrentThread(&env, nullptr) != JNI_OK) {
    return nullptr;
  }
  return env;
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
      case '"':
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
  if (!state) return;
  JNIEnv *env = getEnv();
  if (!env) return;
  std::string payload = std::string("{\"topic\":\"") + jsonEscape(topic) +
                        "\",\"level\":\"" + jsonEscape(level) +
                        "\",\"tag\":\"" + jsonEscape(tag) +
                        "\",\"data\":\"" + jsonEscape(data) + "\"}";


  if (state->nativeOverlayClass && state->nativeOverlayHandleRaw) {
    jstring jPayload = env->NewStringUTF(payload.c_str());
    env->CallStaticVoidMethod(state->nativeOverlayClass, state->nativeOverlayHandleRaw, jPayload);
    env->DeleteLocalRef(jPayload);
  }

  if (state->devtoolsClass && state->devtoolsEmit) {
    jstring jPayload = env->NewStringUTF(payload.c_str());
    env->CallStaticVoidMethod(state->devtoolsClass, state->devtoolsEmit, jPayload);
    env->DeleteLocalRef(jPayload);
  }

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

void recordNativeYogaTelemetry(RuntimeState *state, const zynth::ZynthCommitTelemetry &telemetry) {
  if (!state) return;
  if (!state->performanceOverlayClass || !state->performanceOverlayRecordYoga) return;
  JNIEnv *env = getEnv();
  if (!env) return;
  const double yogaMs = (telemetry.yogaMutateUs + telemetry.yogaCalculateUs) / 1000.0;
  const double yogaCalculateMs = telemetry.yogaCalculateUs / 1000.0;
  const double measureMs = telemetry.measureCallbackUs / 1000.0;
  env->CallStaticVoidMethod(
      state->performanceOverlayClass,
      state->performanceOverlayRecordYoga,
      static_cast<jdouble>(yogaMs),
      static_cast<jdouble>(yogaCalculateMs),
      static_cast<jdouble>(measureMs));
}

void installCrashSignalHandlers() {
  // Let ART/debuggerd own fatal signal handling. Zynth's previous crash
  // watcher used JNI from crash-adjacent paths and could mask the real fault
  // behind recursive ART/Binder aborts during scroll stress.
  gCrashHandlerInstalled.store(true);
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
  rt.global().setProperty(
      rt, "__ZYNTH_NATIVE_CONSOLE_DEVTOOLS__", Value(true));
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

static void installJSIPlugins(Runtime &rt, RuntimeState *state) {
  std::vector<ZynthJSIPluginInstaller> installers;
  {
    std::lock_guard<std::mutex> lock(gPluginMutex);
    installers = gPluginInstallers;
  }
  for (auto installer : installers) {
    if (!installer) continue;
    installer(rt, state);
  }
}

extern "C" JNIEXPORT void ZynthRegisterJSIPluginInstaller(ZynthJSIPluginInstaller installer) {
  if (!installer) return;
  std::lock_guard<std::mutex> lock(gPluginMutex);
  gPluginInstallers.push_back(installer);
}

extern "C" JNIEXPORT void ZynthRegisterSharedSignalChangedCallback(ZynthSharedSignalChangedCallback callback) {
  if (!callback) return;
  __android_log_print(ANDROID_LOG_DEBUG, "ZynthKit", "Registering shared signal callback: %p", callback);
  std::lock_guard<std::mutex> lock(gPluginMutex);
  gSharedSignalCallbacks.push_back(callback);
}

extern "C" JNIEXPORT int ZynthCreateSharedSignal(void *state, double initialValue) {
  auto *runtimeState = reinterpret_cast<RuntimeState *>(state);
  if (!runtimeState) return 0;
  int id = runtimeState->nextSharedSignalId.fetch_add(1);
  {
    std::lock_guard<std::mutex> lock(runtimeState->sharedSignalsMutex);
    runtimeState->sharedSignals[id] = initialValue;
  }
  return id;
}

extern "C" JNIEXPORT double ZynthGetSharedSignal(void *state, int signalId, bool *found) {
  auto *runtimeState = reinterpret_cast<RuntimeState *>(state);
  if (!runtimeState) {
    if (found) *found = false;
    return std::numeric_limits<double>::quiet_NaN();
  }
  std::lock_guard<std::mutex> lock(runtimeState->sharedSignalsMutex);
  auto it = runtimeState->sharedSignals.find(signalId);
  if (it == runtimeState->sharedSignals.end()) {
    if (found) *found = false;
    return std::numeric_limits<double>::quiet_NaN();
  }
  if (found) *found = true;
  return it->second;
}

extern "C" JNIEXPORT bool ZynthSetSharedSignal(void *state, int signalId, double value) {
  auto *runtimeState = reinterpret_cast<RuntimeState *>(state);
  if (!runtimeState) return false;
  {
    std::lock_guard<std::mutex> lock(runtimeState->sharedSignalsMutex);
    auto it = runtimeState->sharedSignals.find(signalId);
    if (it == runtimeState->sharedSignals.end()) return false;
    it->second = value;
  }

  std::vector<ZynthSharedSignalChangedCallback> callbacks;
  {
    std::lock_guard<std::mutex> lock(gPluginMutex);
    callbacks = gSharedSignalCallbacks;
  }
  for (auto callback : callbacks) {
    callback(state, signalId);
  }

  return true;
}

extern "C" JNIEXPORT int ZynthCreateSyncSignal(void *state, const char *initialValue) {
  auto *runtimeState = reinterpret_cast<RuntimeState *>(state);
  if (!runtimeState) return 0;
  int id = runtimeState->nextSyncSignalId.fetch_add(1);
  {
    std::lock_guard<std::mutex> lock(runtimeState->syncSignalsMutex);
    runtimeState->syncSignals[id] = initialValue ? std::string(initialValue) : std::string();
  }
  return id;
}

extern "C" JNIEXPORT bool ZynthGetSyncSignal(
    void *state,
    int signalId,
    std::string &outValue) {
  auto *runtimeState = reinterpret_cast<RuntimeState *>(state);
  if (!runtimeState) return false;
  std::lock_guard<std::mutex> lock(runtimeState->syncSignalsMutex);
  auto it = runtimeState->syncSignals.find(signalId);
  if (it == runtimeState->syncSignals.end()) {
    return false;
  }
  outValue = it->second;
  return true;
}

extern "C" JNIEXPORT bool JNICALL
Java_com_zynth_kit_runtime_JSBridge_getSyncSignal(JNIEnv *env, jobject, jlong ptr, jint signalId, jobject value) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return false;
  auto *state = stateFor(runtime);
  if (!state) return false;
  std::string str;
  if (!ZynthGetSyncSignal(state, signalId, str)) return false;
  
  jclass sbClass = env->GetObjectClass(value);
  jmethodID appendMethod = env->GetMethodID(sbClass, "append", "(Ljava/lang/String;)Ljava/lang/StringBuilder;");
  jstring jStr = env->NewStringUTF(str.c_str());
  env->CallObjectMethod(value, appendMethod, jStr);
  env->DeleteLocalRef(jStr);
  return true;
}

extern "C" JNIEXPORT bool ZynthSetSyncSignal(void *state, int signalId, const char *value) {
  auto *runtimeState = reinterpret_cast<RuntimeState *>(state);
  if (!runtimeState) return false;
  std::lock_guard<std::mutex> lock(runtimeState->syncSignalsMutex);
  auto it = runtimeState->syncSignals.find(signalId);
  if (it == runtimeState->syncSignals.end()) return false;
  it->second = value ? std::string(value) : std::string();
  return true;
}

extern "C" JNIEXPORT bool JNICALL
Java_com_zynth_kit_runtime_JSBridge_setSyncSignal(JNIEnv *env, jobject, jlong ptr, jint signalId, jstring value) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return false;
  auto *state = stateFor(runtime);
  if (!state) return false;
  const char *chars = env->GetStringUTFChars(value, nullptr);
  bool result = ZynthSetSyncSignal(state, signalId, chars);
  env->ReleaseStringUTFChars(value, chars);
  return result;
}

extern "C" JNIEXPORT void ZynthApplyAnimatedStyle(
    void *state,
    int nodeId,
    float opacity,
    float translateX,
    float translateY,
    float scaleX,
    float scaleY,
    float rotate,
    float rotateX,
    float rotateY,
    float skewX,
    float skewY,
    float perspective) {
  auto *runtimeState = reinterpret_cast<RuntimeState *>(state);
  if (!runtimeState || !runtimeState->uiManager || !runtimeState->applyAnimatedStyle) {
    return;
  }
  JNIEnv *env = getEnv();
  if (!env) return;
  env->CallVoidMethod(
      runtimeState->uiManager,
      runtimeState->applyAnimatedStyle,
      nodeId,
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
}

extern "C" JNIEXPORT void ZynthApplyAnimatedLayoutStyle(
    void *state,
    int nodeId,
    const ZynthAnimatedLayoutProps* props) {
  auto *runtimeState = reinterpret_cast<RuntimeState *>(state);
  if (!runtimeState || !props) {
    return;
  }

  // 1. Update Native Yoga Styles immediately for high-performance UI thread animations
  auto* nodeRecord = runtimeState->rendererHost.getNode(nodeId);
  if (nodeRecord && nodeRecord->yoga) {
    bool changed = false;
    auto update = [&](zynth::ZynthPropId prop, float val) {
      if (!std::isnan(val)) {
        zynth::ZynthPropValue v;
        v.kind = zynth::ZynthValueKind::Number;
        v.number = val;
        
        zynth::ZynthPropMutation mut;
        mut.nodeId = nodeId;
        mut.prop = prop;
        mut.value = v;
        
        if (runtimeState->yogaTree->applyProp(nodeRecord->yoga, mut)) {
          changed = true;
        }
      }
    };
    
    update(zynth::ZynthPropId::Width, props->width);
    update(zynth::ZynthPropId::Height, props->height);
    update(zynth::ZynthPropId::MinWidth, props->minWidth);
    update(zynth::ZynthPropId::MinHeight, props->minHeight);
    update(zynth::ZynthPropId::MaxWidth, props->maxWidth);
    update(zynth::ZynthPropId::MaxHeight, props->maxHeight);
    update(zynth::ZynthPropId::Flex, props->flex);
    update(zynth::ZynthPropId::FlexGrow, props->flexGrow);
    update(zynth::ZynthPropId::FlexShrink, props->flexShrink);
    update(zynth::ZynthPropId::FlexBasis, props->flexBasis);
    update(zynth::ZynthPropId::Top, props->top);
    update(zynth::ZynthPropId::Right, props->right);
    update(zynth::ZynthPropId::Bottom, props->bottom);
    update(zynth::ZynthPropId::Left, props->left);

    // Padding shorthands
    if (!std::isnan(props->padding)) {
      update(zynth::ZynthPropId::PaddingTop, props->padding);
      update(zynth::ZynthPropId::PaddingRight, props->padding);
      update(zynth::ZynthPropId::PaddingBottom, props->padding);
      update(zynth::ZynthPropId::PaddingLeft, props->padding);
    }
    if (!std::isnan(props->paddingHorizontal)) {
      update(zynth::ZynthPropId::PaddingRight, props->paddingHorizontal);
      update(zynth::ZynthPropId::PaddingLeft, props->paddingHorizontal);
    }
    if (!std::isnan(props->paddingVertical)) {
      update(zynth::ZynthPropId::PaddingTop, props->paddingVertical);
      update(zynth::ZynthPropId::PaddingBottom, props->paddingVertical);
    }
    update(zynth::ZynthPropId::PaddingTop, props->paddingTop);
    update(zynth::ZynthPropId::PaddingRight, props->paddingRight);
    update(zynth::ZynthPropId::PaddingBottom, props->paddingBottom);
    update(zynth::ZynthPropId::PaddingLeft, props->paddingLeft);

    // Margin shorthands
    if (!std::isnan(props->margin)) {
      update(zynth::ZynthPropId::MarginTop, props->margin);
      update(zynth::ZynthPropId::MarginRight, props->margin);
      update(zynth::ZynthPropId::MarginBottom, props->margin);
      update(zynth::ZynthPropId::MarginLeft, props->margin);
    }
    if (!std::isnan(props->marginHorizontal)) {
      update(zynth::ZynthPropId::MarginRight, props->marginHorizontal);
      update(zynth::ZynthPropId::MarginLeft, props->marginHorizontal);
    }
    if (!std::isnan(props->marginVertical)) {
      update(zynth::ZynthPropId::MarginTop, props->marginVertical);
      update(zynth::ZynthPropId::MarginBottom, props->marginVertical);
    }
    update(zynth::ZynthPropId::MarginTop, props->marginTop);
    update(zynth::ZynthPropId::MarginRight, props->marginRight);
    update(zynth::ZynthPropId::MarginBottom, props->marginBottom);
    update(zynth::ZynthPropId::MarginLeft, props->marginLeft);
    
    if (changed) {
      runtimeState->rendererHost.markSurfaceDirty(nodeRecord->surfaceId);
    }
  }

  // Layout updates are committed to Android views exclusively through
  // ZynthPerformNativeLayout → applyMountTransaction.  Calling the Kotlin
  // applyAnimatedLayoutStyle callback here would cause a redundant, conflicting
  // view-level update (view.setPadding / layoutParams / requestLayout) that
  // races with the authoritative Yoga-driven mount transaction.
}

extern "C" JNIEXPORT void ZynthPerformNativeLayout(void *state) {
  auto *runtimeState = reinterpret_cast<RuntimeState *>(state);
  if (!runtimeState || !runtimeState->useNativeCommit) {
    return;
  }

  // 1. Calculate Layout for all surfaces marked dirty by animated style changes
  zynth::ZynthCommit commit;
  zynth::ZynthCommitTelemetry telemetry;
  
  // calculateLayoutForDirtySurfaces may throw if Yoga encounters invalid
  // constraints (e.g. indefinite availableHeight with incompatible sizing
  // mode).  Catch and log rather than crashing the entire layout pass.
  try {
    g_currentLayoutState = runtimeState;
    runtimeState->currentTelemetry = &telemetry;
    runtimeState->yogaTree->calculateLayoutForDirtySurfaces(telemetry, commit);
    runtimeState->currentTelemetry = nullptr;
    g_currentLayoutState = nullptr;
  } catch (const std::exception &e) {
    runtimeState->currentTelemetry = nullptr;
    g_currentLayoutState = nullptr;
    __android_log_print(ANDROID_LOG_ERROR, "ZynthAnimate",
                        "Yoga layout failed: %s", e.what());
    return;
  } catch (...) {
    runtimeState->currentTelemetry = nullptr;
    g_currentLayoutState = nullptr;
    __android_log_print(ANDROID_LOG_ERROR, "ZynthAnimate",
                        "Yoga layout failed (unknown exception)");
    return;
  }

  // 2. If layout changed, send the new frames to Kotlin
  if (!commit.layoutFrames.empty()) {
    JNIEnv *env = getEnv();
    if (!env || !runtimeState->uiManager || !runtimeState->applyMountTransaction) {
      return;
    }

    std::vector<double> postLayoutOps;
    postLayoutOps.reserve(commit.layoutFrames.size() * 6);
    
    // OPCODE 6: frame (nodeId, left, top, width, height)
    for (const auto& op : commit.layoutFrames) {
      postLayoutOps.push_back(6);
      postLayoutOps.push_back(static_cast<double>(op.nodeId));
      postLayoutOps.push_back(static_cast<double>(op.left));
      postLayoutOps.push_back(static_cast<double>(op.top));
      postLayoutOps.push_back(static_cast<double>(op.width));
      postLayoutOps.push_back(static_cast<double>(op.height));
    }

    jobject jBuffer = env->NewDirectByteBuffer(
        postLayoutOps.data(),
        static_cast<jlong>(postLayoutOps.size() * sizeof(double)));
    
    if (jBuffer) {
      jobjectArray jStrings = env->NewObjectArray(0, runtimeState->stringClass, nullptr);

      env->CallVoidMethod(
          runtimeState->uiManager, 
          runtimeState->applyMountTransaction,
          jBuffer, 
          static_cast<jint>(postLayoutOps.size()), 
          jStrings);

      env->DeleteLocalRef(jBuffer);
      if (jStrings) env->DeleteLocalRef(jStrings);
    }
  }
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
        double initial = args[0].asNumber();
        int id = ZynthCreateSharedSignal(state, initial);
        if (id <= 0) return Value::undefined();
        __android_log_print(ANDROID_LOG_DEBUG, "ZynthWorklets",
                            "createSharedSignal id=%d value=%.3f", id, initial);
        return Value(static_cast<double>(id));
      });

  auto getSharedSignal = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "getSharedSignal"), 1,
      [state](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value::undefined();
        int id = static_cast<int>(args[0].asNumber());
        bool found = false;
        double value = ZynthGetSharedSignal(state, id, &found);
        if (!found) return Value::undefined();
        return Value(value);
      });

  auto setSharedSignal = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setSharedSignal"), 2,
      [state](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isNumber()) {
          return Value::undefined();
        }
        int id = static_cast<int>(args[0].asNumber());
        double value = args[1].asNumber();
        if (!ZynthSetSharedSignal(state, id, value)) return Value::undefined();
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

void installSyncSignals(Runtime &rt, RuntimeState *state) {
  if (!state) return;

  auto createSyncSignal = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "createSyncSignal"), 1,
      [state](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isString()) return Value::undefined();
        std::string initial = args[0].asString(rt).utf8(rt);
        int id = ZynthCreateSyncSignal(state, initial.c_str());
        if (id <= 0) return Value::undefined();
        return Value(static_cast<double>(id));
      });

  auto getSyncSignal = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "getSyncSignal"), 1,
      [state](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value::undefined();
        int id = static_cast<int>(args[0].asNumber());
        std::string value;
        if (!ZynthGetSyncSignal(state, id, value)) return Value::undefined();
        return Value(String::createFromUtf8(rt, value));
      });

  auto setSyncSignal = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setSyncSignal"), 2,
      [state](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isString()) {
          return Value::undefined();
        }
        int id = static_cast<int>(args[0].asNumber());
        std::string value = args[1].asString(rt).utf8(rt);
        if (!ZynthSetSyncSignal(state, id, value.c_str())) return Value::undefined();
        return Value::undefined();
      });

  auto removeSyncSignal = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "removeSyncSignal"), 1,
      [state](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value::undefined();
        int id = static_cast<int>(args[0].asNumber());
        {
          std::lock_guard<std::mutex> lock(state->syncSignalsMutex);
          state->syncSignals.erase(id);
        }
        return Value::undefined();
      });

  Object sync(rt);
  sync.setProperty(rt, "createSyncSignal", createSyncSignal);
  sync.setProperty(rt, "getSyncSignal", getSyncSignal);
  sync.setProperty(rt, "setSyncSignal", setSyncSignal);
  sync.setProperty(rt, "removeSyncSignal", removeSyncSignal);
  rt.global().setProperty(rt, "__zynth_sync_signals", sync);

  auto bindSyncSignalNode = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "bindSyncSignalNode"), 2,
      [state](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isNumber()) return Value::undefined();
        int signalId = static_cast<int>(args[0].asNumber());
        int nodeId = static_cast<int>(args[1].asNumber());
        {
          std::lock_guard<std::mutex> lock(state->syncSignalBindingsMutex);
          state->syncSignalBindings[nodeId] = signalId;
        }
        JNIEnv *env = getEnv();
        if (env && state->uiManager && state->setProp) {
          jstring jName = env->NewStringUTF("syncSignalId");
          jstring jValue = env->NewStringUTF(std::to_string(signalId).c_str());
          env->CallVoidMethod(state->uiManager, state->setProp, nodeId, jName, jValue);
          env->DeleteLocalRef(jName);
          env->DeleteLocalRef(jValue);
        }
        return Value::undefined();
      });

  auto unbindSyncSignalNode = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "unbindSyncSignalNode"), 2,
      [state](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isNumber()) return Value::undefined();
        int nodeId = static_cast<int>(args[1].asNumber());
        {
          std::lock_guard<std::mutex> lock(state->syncSignalBindingsMutex);
          state->syncSignalBindings.erase(nodeId);
        }
        JNIEnv *env = getEnv();
        if (env && state->uiManager && state->setProp) {
          jstring jName = env->NewStringUTF("syncSignalId");
          jstring jValue = env->NewStringUTF("0");
          env->CallVoidMethod(state->uiManager, state->setProp, nodeId, jName, jValue);
          env->DeleteLocalRef(jName);
          env->DeleteLocalRef(jValue);
        }
        return Value::undefined();
      });

  rt.global().setProperty(rt, "__zynth_bindSyncSignalNode", bindSyncSignalNode);
  rt.global().setProperty(rt, "__zynth_unbindSyncSignalNode", unbindSyncSignalNode);
}

void ensureUIRuntime(const std::shared_ptr<RuntimeState> &state) {
  if (!state) return;
  if (state->uiRuntime) return;
  state->uiRuntime = facebook::hermes::makeHermesRuntime();
  installConsole(*state->uiRuntime, state.get());
  installGlobals(*state->uiRuntime);
  installSharedSignals(*state->uiRuntime, state.get());
  installSyncSignals(*state->uiRuntime, state.get());
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
    std::string source = definition.code;
    source.append("\n//# sourceURL=zynth-worklet.js");
    auto buffer = std::make_shared<StringBuffer>(source);
    auto result = rt.evaluateJavaScript(buffer, "zynth-worklet.js");
    if (!result.isObject() || !result.getObject(rt).isFunction(rt)) {
      __android_log_print(ANDROID_LOG_WARN, "ZynthWorklets",
                          "register id=%d failed (evaluated result is NOT a function)", workletId);
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

std::optional<std::string> runInputHandlerWorkletOnUIRuntime(
    const std::shared_ptr<RuntimeState> &state,
    int workletId,
    const std::string &currentText,
    const std::string &newInput,
    const std::string &proposedText) {
  if (!state) return std::nullopt;
  ensureUIRuntime(state);
  if (!state->uiRuntime) return std::nullopt;
  std::shared_ptr<Function> fn;
  std::vector<ZynthWorkletClosureValue> closure;
  {
    std::lock_guard<std::mutex> lock(state->workletMutex);
    auto it = state->uiWorklets.find(workletId);
    if (it == state->uiWorklets.end()) {
      return std::nullopt;
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
    Value result = fn->call(
        rt, {
        Value(rt, String::createFromUtf8(rt, currentText)),
        Value(rt, String::createFromUtf8(rt, newInput)),
        Value(rt, String::createFromUtf8(rt, proposedText))
        });
    if (result.isString()) {
      return result.asString(rt).utf8(rt);
    }
  } catch (const std::exception &ex) {
    __android_log_print(ANDROID_LOG_ERROR, "ZynthWorklets",
                       "run exception id=%d %s", workletId, ex.what());
  } catch (...) {
    __android_log_print(ANDROID_LOG_ERROR, "ZynthWorklets",
                       "run unknown exception id=%d", workletId);
  }
  return std::nullopt;
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
      rt, PropNameID::forAscii(rt, "createNode"), 2,
      [runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isString()) return Value::undefined();
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        std::string type = args[0].asString(rt).utf8(rt);
        jstring jType = env->NewStringUTF(type.c_str());
        jboolean jHasMeasure = (count >= 2 && args[1].isBool() && args[1].getBool()) ? JNI_TRUE : JNI_FALSE;
        jint nodeId = env->CallIntMethod(state->uiManager, state->createNode, jType);
        env->DeleteLocalRef(jType);
        // Phase 2: Register node in native renderer state
        if (state->useNativeCommit && nodeId > 0) {
          state->rendererHost.createNode(
              nodeId, type, state->rendererHost.activeSurfaceId(), jHasMeasure == JNI_TRUE);
        }
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

  auto syncInputState = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "syncInputState"), 5,
      [runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 5 || !args[0].isNumber()) return Value::undefined();
        RuntimeState *state = stateFor(runtime);
        if (!state || !state->syncTextInputState) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();

        jint nodeId = static_cast<jint>(args[0].asNumber());
        std::string newText = args[1].isString() ? args[1].asString(rt).utf8(rt) : "";
        std::string nativeText = args[2].isString() ? args[2].asString(rt).utf8(rt) : "";

        // ==========================================
        // 1) THE NO-OP DIFF CHECK
        // ==========================================
        if (newText == nativeText) {
            // The pipeline text matches the native OS buffer exactly (e.g., autocorrect).
            // We short-circuit and DO NOT overwrite the native view, protecting the OS cursor state.
            return Value(true); 
        }

        // ==========================================
        // 2) SELECTION SYNC WRITE-BACK
        // ==========================================
        jint selStart = static_cast<jint>(args[3].isNumber() ? args[3].asNumber() : -1);
        jint selEnd = static_cast<jint>(args[4].isNumber() ? args[4].asNumber() : -1);

        jstring jNewText = env->NewStringUTF(newText.c_str());
        
        env->CallVoidMethod(
            state->uiManager, 
            state->syncTextInputState, 
            nodeId, 
            jNewText, 
            selStart, 
            selEnd
        );

        env->DeleteLocalRef(jNewText);
        return Value(true);
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
        jint parentId = static_cast<jint>(args[0].asNumber());
        jint childId = static_cast<jint>(args[1].asNumber());
        jint index = static_cast<jint>(args[2].asNumber());
        // Phase 2: Update native tree topology
        if (state->useNativeCommit) {
          state->rendererHost.insertChild(parentId, childId, index);
        } else {
          env->CallVoidMethod(state->uiManager, state->insertChild,
                              parentId, childId, index);
        }
        return Value::undefined();
      });

  auto removeChild = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "removeChild"), 2,
      [runtime](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isNumber()) return Value::undefined();
        removeHandlersForNode(runtime, static_cast<int>(args[1].asNumber()));
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        jint parentId = static_cast<jint>(args[0].asNumber());
        jint childId = static_cast<jint>(args[1].asNumber());
        // Phase 2: Update native tree topology
        if (state->useNativeCommit) {
          state->rendererHost.removeChild(parentId, childId);
        } else {
          env->CallVoidMethod(state->uiManager, state->removeChild,
                              parentId, childId);
        }
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
          Object fnObj = args[2].asObject(rt);
          if (
              name == "handler" &&
              fnObj.hasProperty(rt, "__zynth_worklet_id") &&
              fnObj.getProperty(rt, "__zynth_worklet_id").isNumber() &&
              state->setInputHandler) {
            jint workletId =
                static_cast<jint>(fnObj.getProperty(rt, "__zynth_worklet_id").asNumber());
            env->CallVoidMethod(state->uiManager, state->setInputHandler, nodeId, workletId);
            env->DeleteLocalRef(jName);
            return Value::undefined();
          }
          Function fn = fnObj.asFunction(rt);
          std::lock_guard<std::mutex> lock(gHandlerMutex);
          gHandlers[HandlerKey{runtime, nodeId, name}] = HandlerEntry{
              runtime, std::make_shared<Function>(std::move(fn))};
        }
        env->CallVoidMethod(state->uiManager, state->setHandler, nodeId, jName);
        env->DeleteLocalRef(jName);
        return Value::undefined();
      });

  auto clearInputHandler = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "clearInputHandler"), 1,
      [runtime](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value::undefined();
        RuntimeState *state = stateFor(runtime);
        if (!state || !state->clearInputHandler) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        env->CallVoidMethod(
            state->uiManager,
            state->clearInputHandler,
            static_cast<jint>(args[0].asNumber()));
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
        auto isTruthy = [&rt](const Value &value) -> bool {
          if (value.isBool()) {
            return value.getBool();
          }
          if (value.isNumber()) {
            return value.asNumber() != 0.0;
          }
          if (value.isString()) {
            std::string text = value.asString(rt).utf8(rt);
            std::transform(text.begin(), text.end(), text.begin(),
                           [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
            return text == "true" || text == "1" || text == "yes" || text == "on";
          }
          return false;
        };
        auto isAtomicKind = [](const std::string &kind) -> bool {
          return kind == "transition" || kind == "navigation" || kind == "theme";
        };
        auto shouldUseAtomicCommit = [&]() -> bool {
          Value metaVal = payload.getProperty(rt, "meta");
          if (!metaVal.isObject()) return false;
          Object metaObject = metaVal.asObject(rt);
          Value extrasVal = metaObject.getProperty(rt, "extras");
          if (extrasVal.isObject()) {
            Object extrasObject = extrasVal.asObject(rt);
            if (isTruthy(extrasObject.getProperty(rt, "atomic"))) return true;
            if (isTruthy(extrasObject.getProperty(rt, "syncFrame"))) return true;
          }
          Value kindVal = metaObject.getProperty(rt, "kind");
          if (kindVal.isString() && isAtomicKind(kindVal.asString(rt).utf8(rt))) return true;
          Value scopeVal = metaObject.getProperty(rt, "scope");
          if (scopeVal.isString() && isAtomicKind(scopeVal.asString(rt).utf8(rt))) return true;
          return false;
        };
        struct AtomicCommitScope {
          JNIEnv *env = nullptr;
          RuntimeState *state = nullptr;
          bool active = false;
          AtomicCommitScope(JNIEnv *jniEnv, RuntimeState *runtimeState, bool enabled)
              : env(jniEnv), state(runtimeState) {
            if (!enabled || !env || !state || !state->beginAtomicCommit || !state->endAtomicCommit) {
              return;
            }
            env->CallVoidMethod(state->uiManager, state->beginAtomicCommit);
            active = true;
          }
          ~AtomicCommitScope() {
            if (!active || !env || !state || !state->endAtomicCommit) return;
            env->CallVoidMethod(state->uiManager, state->endAtomicCommit);
          }
        };
        AtomicCommitScope atomicCommitScope(env, state, shouldUseAtomicCommit());
        Value opsPackedVal = payload.getProperty(rt, "ops");
        Value stringTableVal = payload.getProperty(rt, "stringTable");
        if (opsPackedVal.isObject() && stringTableVal.isObject()) {
          Object opsObject = opsPackedVal.asObject(rt);
          Object stringTableObject = stringTableVal.asObject(rt);
          if (!stringTableObject.isArray(rt)) return Value::undefined();
          Array stringTable = stringTableObject.asArray(rt);
          const size_t stringCount = stringTable.length(rt);

          // Phase 0: Generate commit ID and start JSI entry timer
          const uint64_t commitId = zynth::nextCommitId();
          zynth::ZynthCommitTelemetry telemetry;
          telemetry.commitId = commitId;

          // Always extract string table once in C++ (avoids duplicate work)
          std::vector<std::string> nativeStrings;
          nativeStrings.reserve(stringCount);
          for (size_t i = 0; i < stringCount; i++) {
            Value entry = stringTable.getValueAtIndex(rt, i);
            if (entry.isString()) {
              nativeStrings.push_back(entry.asString(rt).utf8(rt));
            } else {
              nativeStrings.push_back("");
            }
          }

          // Extract raw ops into a double vector for native decode
          std::vector<double> opsBuffer;
          size_t opCount = 0;
          const uint8_t *bufferData = nullptr;
          size_t bufferByteLength = 0;

          if (opsObject.isArrayBuffer(rt)) {
            ArrayBuffer buffer = opsObject.getArrayBuffer(rt);
            bufferByteLength = buffer.size(rt);
            bufferData = buffer.data(rt);
            opCount = bufferByteLength / sizeof(double);
          } else if (opsObject.isArray(rt)) {
            Array opsPacked = opsObject.asArray(rt);
            opCount = opsPacked.length(rt);
            opsBuffer.resize(opCount);
            for (size_t i = 0; i < opCount; i++) {
              Value opVal = opsPacked.getValueAtIndex(rt, i);
              opsBuffer[i] = opVal.isNumber() ? opVal.asNumber() : 0.0;
            }
          } else {
            return Value::undefined();
          }

          // Phase 1: Native commit decode path
          if (state->useNativeCommit) {
            zynth::ZynthCommit &commit = state->nativeCommit;
            {
              zynth::ZynthPhaseTimer decodeTimer(telemetry.nativeDecodeUs);
              if (bufferData) {
                zynth::ZynthCommitDecoder::decodeFromBuffer(
                    bufferData, bufferByteLength, nativeStrings, commitId, commit);
              } else {
                zynth::ZynthCommitDecoder::decode(
                    opsBuffer.data(), opCount, nativeStrings, commitId, commit);
              }
            }

            // Phase 2: Apply topology changes to native state
            state->rendererHost.applyCommitTopology(commit, telemetry);

            // Phase 3: Apply layout props to Yoga tree and calculate layout
            {
              zynth::ZynthPhaseTimer timer(telemetry.yogaMutateUs);
              state->yogaTree->applyLayoutMutations(commit.layoutProps);
              
              auto processTextDirty = [&](int32_t nodeId) {
                auto* record = state->rendererHost.getNode(nodeId);
                if (record && record->hasMeasureFunc) {
                  record->contentRevision++;
                  if (record->yoga && YGNodeHasMeasureFunc(record->yoga)) YGNodeMarkDirty(record->yoga);
                  state->rendererHost.markSurfaceDirty(record->surfaceId);
                }
              };
              for (const auto& op : commit.textProps) processTextDirty(op.nodeId);
              for (const auto& op : commit.textMutations) processTextDirty(op.nodeId);
            }
            
            // Phase 3A: Kotlin Pre-Layout Transaction
            // We must dispatch text and properties to Kotlin BEFORE calculating layout,
            // because Kotlin's TextView needs the actual text and font styles to measure correctly!
            jclass stringClass = state->stringClass;
            if (!stringClass) {
              jclass localStringClass = env->FindClass("java/lang/String");
              if (localStringClass) {
                state->stringClass = static_cast<jclass>(env->NewGlobalRef(localStringClass));
                stringClass = state->stringClass;
                env->DeleteLocalRef(localStringClass);
              }
            }

            jobjectArray jStrings = nullptr;
            if (stringClass) {
              jStrings = env->NewObjectArray(
                  static_cast<jsize>(nativeStrings.size()), stringClass, nullptr);
              for (size_t i = 0; i < nativeStrings.size(); i++) {
                jstring jStr = env->NewStringUTF(nativeStrings[i].c_str());
                env->SetObjectArrayElement(jStrings, static_cast<jsize>(i), jStr);
                env->DeleteLocalRef(jStr);
              }
            }

            if (stringClass && state->applyMountTransaction) {
              // Split pre-layout into TWO transactions:
              // 1. SYNC: measurement-critical topology, text props, and measured
              //    component props. Must complete before Yoga layout.
              // 2. ASYNC: visual-only ops (removeChild, dropNode, visual props).
              //    Can be posted to main thread without blocking JS.
              std::vector<double> syncOps;
              std::vector<double> asyncOps;
              syncOps.reserve(commit.surfaces.size() * 2 + commit.creates.size() * 4 +
                              commit.inserts.size() * 4 + commit.textMutations.size() * 3 +
                              commit.textProps.size() * 5 + commit.descriptorProps.size() * 5 +
                              commit.layoutProps.size() * 5);
              asyncOps.reserve(commit.totalOpCount() * 5);
              
              // SYNC: setSurface - createNode must inherit the correct active surface
              for (const auto& op : commit.surfaces) {
                syncOps.push_back(8);
                syncOps.push_back(op.surfaceId);
              }
              // SYNC: createNode - Kotlin must create the View before measurement
              for (const auto& op : commit.creates) {
                syncOps.push_back(7);
                syncOps.push_back(op.nodeId);
                syncOps.push_back(op.typeStringIndex);
                syncOps.push_back(op.hasMeasure ? 1.0 : 0.0);
              }
              // SYNC: insertChild - insertion before createNode is dropped by Kotlin
              for (const auto& op : commit.inserts) {
                syncOps.push_back(3);
                syncOps.push_back(op.parentId);
                syncOps.push_back(op.childId);
                syncOps.push_back(op.index);
              }
              // ASYNC: removeChild
              for (const auto& op : commit.removes) {
                asyncOps.push_back(4);
                asyncOps.push_back(op.parentId);
                asyncOps.push_back(op.childId);
              }
              // ASYNC: dropNode
              for (const auto& op : commit.drops) {
                asyncOps.push_back(5);
                asyncOps.push_back(op.nodeId);
              }
              auto pushPropTo = [&](std::vector<double>& target, const zynth::ZynthPropMutation& op) {
                target.push_back(1); // 1 = setProp
                target.push_back(op.nodeId);
                if (op.prop == zynth::ZynthPropId::Unknown) {
                  target.push_back(static_cast<double>(op.keyToken));
                } else {
                  target.push_back(static_cast<double>(-static_cast<int32_t>(op.prop)));
                }
                target.push_back(static_cast<double>(op.value.kind));
                if (op.value.kind == zynth::ZynthValueKind::Bool) {
                  target.push_back(op.value.number);
                } else if (op.value.kind == zynth::ZynthValueKind::String) {
                  target.push_back(static_cast<double>(op.value.stringIndex));
                } else {
                  target.push_back(op.value.number);
                }
              };
              
              // ASYNC: viewProps (backgroundColor, opacity, transform, etc.)
              for (const auto& op : commit.viewProps) {
                pushPropTo(asyncOps, op);
              }
              // SYNC: textProps (fontSize, fontFamily, fontWeight - affect measurement)
              for (const auto& op : commit.textProps) {
                pushPropTo(syncOps, op);
              }
              // SYNC for measured components: TextInput value/defaultValue/multiline
              // affect native measurement. ASYNC for visual-only descriptor props.
              for (const auto& op : commit.descriptorProps) {
                auto* record = state->rendererHost.getNode(op.nodeId);
                pushPropTo(record && record->hasMeasureFunc ? syncOps : asyncOps, op);
              }
              
              // ASYNC: Dual-routed layout props (display, overflow)
              // SYNC: Dual-routed padding props (padding affects Kotlin text measurement)
              for (const auto& op : commit.layoutProps) {
                if (op.prop == zynth::ZynthPropId::Display || op.prop == zynth::ZynthPropId::Overflow) {
                  pushPropTo(asyncOps, op);
                } else if (op.prop == zynth::ZynthPropId::Padding ||
                           op.prop == zynth::ZynthPropId::PaddingHorizontal ||
                           op.prop == zynth::ZynthPropId::PaddingVertical ||
                           op.prop == zynth::ZynthPropId::PaddingTop ||
                           op.prop == zynth::ZynthPropId::PaddingRight ||
                           op.prop == zynth::ZynthPropId::PaddingBottom ||
                           op.prop == zynth::ZynthPropId::PaddingLeft) {
                  pushPropTo(syncOps, op);
                }
              }
              
              // SYNC: setText - Kotlin TextView needs text content for measurement
              for (const auto& op : commit.textMutations) {
                syncOps.push_back(2);
                syncOps.push_back(op.nodeId);
                syncOps.push_back(op.textStringIndex);
              }

              // Dispatch SYNC measurement-critical ops (blocking)
              if (!syncOps.empty()) {
                jobject jSyncBuffer = env->NewDirectByteBuffer(
                    syncOps.data(),
                    static_cast<jlong>(syncOps.size() * sizeof(double)));
                if (jSyncBuffer) {
                  if (state->applyMountTransactionSync) {
                    env->CallVoidMethod(state->uiManager, state->applyMountTransactionSync,
                                        jSyncBuffer, static_cast<jint>(syncOps.size()), jStrings);
                  } else {
                    env->CallVoidMethod(state->uiManager, state->applyMountTransaction,
                                        jSyncBuffer, static_cast<jint>(syncOps.size()), jStrings);
                  }
                  env->DeleteLocalRef(jSyncBuffer);
                }
              }

              // Dispatch ASYNC visual ops after sync topology exists.
              if (!asyncOps.empty()) {
                jobject jAsyncBuffer = env->NewDirectByteBuffer(
                    asyncOps.data(),
                    static_cast<jlong>(asyncOps.size() * sizeof(double)));
                if (jAsyncBuffer) {
                  env->CallVoidMethod(state->uiManager, state->applyMountTransaction,
                                      jAsyncBuffer, static_cast<jint>(asyncOps.size()), jStrings);
                  env->DeleteLocalRef(jAsyncBuffer);
                }
              }
            }

            // Phase 3B: Yoga Layout Calculation
            g_currentLayoutState = state;
            state->currentTelemetry = &telemetry;
            state->yogaTree->calculateLayoutForDirtySurfaces(telemetry, commit);
            state->currentTelemetry = nullptr;
            g_currentLayoutState = nullptr;
            recordNativeYogaTelemetry(state, telemetry);

            // Phase 4: Kotlin Layout Transaction
            if (stringClass && state->applyMountTransaction) {
              std::vector<double> postLayoutOps;
              postLayoutOps.reserve(commit.layoutFrames.size() * 6);
              
              // 6 = frame
              for (const auto& op : commit.layoutFrames) {
                postLayoutOps.push_back(6);
                postLayoutOps.push_back(op.nodeId);
                postLayoutOps.push_back(op.left);
                postLayoutOps.push_back(op.top);
                postLayoutOps.push_back(op.width);
                postLayoutOps.push_back(op.height);
              }

              if (!postLayoutOps.empty()) {
                jobject jBuffer = env->NewDirectByteBuffer(
                    postLayoutOps.data(),
                    static_cast<jlong>(postLayoutOps.size() * sizeof(double)));
                if (jBuffer) {
                  env->CallVoidMethod(state->uiManager, state->applyMountTransaction,
                                      jBuffer, static_cast<jint>(postLayoutOps.size()), jStrings);
                  env->DeleteLocalRef(jBuffer);
                }
              }
            }
            
            if (jStrings) {
              env->DeleteLocalRef(jStrings);
            }

            // Emit commit summary in debug builds
            // commit.telemetry.logSummary();

            return Value::undefined();
          }

          // Legacy Kotlin decode path (useNativeCommit == false)
          {
            jclass stringClass = state->stringClass;
            if (!stringClass) {
              jclass localStringClass = env->FindClass("java/lang/String");
              if (!localStringClass) return Value::undefined();
              stringClass = localStringClass;
              state->stringClass = static_cast<jclass>(env->NewGlobalRef(localStringClass));
              env->DeleteLocalRef(localStringClass);
            }
            jobjectArray jStrings = env->NewObjectArray(
                static_cast<jsize>(nativeStrings.size()), stringClass, nullptr);
            for (size_t i = 0; i < nativeStrings.size(); i++) {
              jstring jStr = env->NewStringUTF(nativeStrings[i].c_str());
              env->SetObjectArrayElement(jStrings, static_cast<jsize>(i), jStr);
              env->DeleteLocalRef(jStr);
            }

            if (bufferData && state->applyBatchTypedBuffer) {
              jobject jBuffer = env->NewDirectByteBuffer(
                  const_cast<uint8_t *>(bufferData),
                  static_cast<jlong>(bufferByteLength));
              if (jBuffer) {
                env->CallVoidMethod(state->uiManager, state->applyBatchTypedBuffer,
                                    jBuffer, static_cast<jint>(opCount), jStrings);
                env->DeleteLocalRef(jBuffer);
              }
            } else if (state->applyBatchTypedPacked) {
              jdoubleArray jOps = env->NewDoubleArray(static_cast<jsize>(opCount));
              if (jOps) {
                if (!opsBuffer.empty()) {
                  env->SetDoubleArrayRegion(jOps, 0, static_cast<jsize>(opCount), opsBuffer.data());
                } else if (bufferData) {
                  std::vector<jdouble> tempBuf(opCount);
                  std::memcpy(tempBuf.data(), bufferData, opCount * sizeof(double));
                  env->SetDoubleArrayRegion(jOps, 0, static_cast<jsize>(opCount), tempBuf.data());
                }
                env->CallVoidMethod(state->uiManager, state->applyBatchTypedPacked,
                                    jOps, jStrings);
                env->DeleteLocalRef(jOps);
              }
            }
            env->DeleteLocalRef(jStrings);
            return Value::undefined();
          }
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
            Value idVal = op.getProperty(rt, "nodeId");
            Value typeVal = op.getProperty(rt, "typeString");
            Value hasMeasureVal = op.getProperty(rt, "hasMeasureFunc");
            if (idVal.isNumber() && typeVal.isString()) {
              jint nodeId = static_cast<jint>(idVal.asNumber());
              std::string nodeType = typeVal.asString(rt).utf8(rt);
              jstring jType = env->NewStringUTF(nodeType.c_str());
              jboolean jHasMeasure = hasMeasureVal.isBool() && hasMeasureVal.getBool() ? JNI_TRUE : JNI_FALSE;
              env->CallVoidMethod(state->uiManager, state->createNodeWithId, jType, nodeId);
              env->DeleteLocalRef(jType);
              if (state->useNativeCommit) {
                state->rendererHost.createNode(
                    nodeId, nodeType, state->rendererHost.activeSurfaceId(), jHasMeasure == JNI_TRUE);
              }
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
            removeHandlersForNode(runtime, static_cast<int>(childVal.asNumber()));
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
        jint surfaceId = static_cast<jint>(args[0].asNumber());
        // Phase 2: Update native renderer state
        if (state->useNativeCommit) {
          state->rendererHost.setActiveSurface(surfaceId);
        }
        env->CallVoidMethod(state->uiManager, state->setSurface, surfaceId);
        return Value::undefined();
      });

  auto dropNode = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "dropNode"), 1,
      [runtime](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value::undefined();
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        jint nodeId = static_cast<jint>(args[0].asNumber());
        if (state->useNativeCommit) {
          state->rendererHost.dropNode(nodeId);
        } else {
          env->CallVoidMethod(state->uiManager, state->dropNode, nodeId);
        }
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
  ui.setProperty(rt, "syncInputState", syncInputState);
  ui.setProperty(rt, "insertChild", insertChild);
  ui.setProperty(rt, "removeChild", removeChild);
  ui.setProperty(rt, "setHandler", setHandler);
  ui.setProperty(rt, "clearInputHandler", clearInputHandler);
  ui.setProperty(rt, "applyBatch", applyBatch);
  ui.setProperty(rt, "applyBatchTyped", applyBatchTyped);
  ui.setProperty(rt, "setSurface", setSurface);
  ui.setProperty(rt, "flush", flush);
  ui.setProperty(rt, "__supportsTypedProps", true);
  ui.setProperty(rt, "__supportsTypedBatch", true);
  ui.setProperty(rt, "__supportsNativeCommit", true);

  // Runtime toggle for native commit decode (Phase 1).
  // Usage from JS: __ui.__setUseNativeCommit(false) to disable.
  auto setUseNativeCommit = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__setUseNativeCommit"), 1,
      [runtime](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        RuntimeState *state = stateFor(runtime);
        if (!state || count < 1) return Value::undefined();
        state->useNativeCommit = args[0].isBool() ? args[0].getBool() : true;
        __android_log_print(ANDROID_LOG_DEBUG, "ZynthCommit",
                            "useNativeCommit = %s",
                            state->useNativeCommit ? "true" : "false");
        return Value::undefined();
      });
  ui.setProperty(rt, "__setUseNativeCommit", setUseNativeCommit);

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

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_updateSurfaceSize(JNIEnv *, jobject, jlong ptr, jint surfaceId, jfloat width, jfloat height) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return;
  auto state = stateFor(runtime);
  if (!state) return;
  state->rendererHost.registerSurface(surfaceId, width, height);
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_setSharedSignal(JNIEnv *, jobject, jlong ptr, jint id, jdouble value) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return;
  auto state = sharedStateFor(runtime);
  if (!state) return;
  ZynthSetSharedSignal(state.get(), id, value);
}

extern "C" JNIEXPORT jdouble JNICALL
Java_com_zynth_kit_runtime_JSBridge_getSharedSignal(JNIEnv *, jobject, jlong ptr, jint id) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return std::numeric_limits<jdouble>::quiet_NaN();
  auto state = sharedStateFor(runtime);
  if (!state) return std::numeric_limits<jdouble>::quiet_NaN();
  bool found = false;
  double value = ZynthGetSharedSignal(state.get(), id, &found);
  if (!found) return std::numeric_limits<jdouble>::quiet_NaN();
  return value;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_zynth_kit_runtime_JSBridge_cancelSharedSignalAnimation(JNIEnv *, jobject, jlong ptr, jint id) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return JNI_FALSE;
  auto state = sharedStateFor(runtime);
  if (!state) return JNI_FALSE;
  return ZynthCancelSharedSignalAnimation(state.get(), id) ? JNI_TRUE : JNI_FALSE;
}

extern "C" jint ZynthAnimate_JNI_OnLoad(JavaVM *vm, void *);

extern "C" jint JNI_OnLoad(JavaVM *vm, void *reserved) {
  gVm = vm;
  ZynthAnimate_JNI_OnLoad(vm, reserved);
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

  // Cleanup handlers associated with this runtime to avoid crash in ~Function
  {
    std::lock_guard<std::mutex> lock(gHandlerMutex);
    for (auto it = gHandlers.begin(); it != gHandlers.end();) {
      if (it->second.runtime == runtime) {
        it = gHandlers.erase(it);
      } else {
        ++it;
      }
    }
  }

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
        if (it->second->nativeOverlayClass) env->DeleteGlobalRef(it->second->nativeOverlayClass);
      }
      gStates.erase(it);
    }
  }
  delete runtime;
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_installUIBindings(JNIEnv *env, jobject, jlong ptr, jobject uiManager, jfloat density) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime || !uiManager) return;

  auto state = std::make_shared<RuntimeState>();
  state->rendererHost.setDensity(static_cast<float>(density));
  state->runtime = runtime;
  state->uiManager = env->NewGlobalRef(uiManager);
  state->uiClass = static_cast<jclass>(env->NewGlobalRef(env->GetObjectClass(uiManager)));
  state->createNode = env->GetMethodID(state->uiClass, "createNode", "(Ljava/lang/String;)I");
  state->createNodeWithId = env->GetMethodID(state->uiClass, "createNode", "(Ljava/lang/String;I)V");
  state->dropNode = env->GetMethodID(state->uiClass, "dropNode", "(I)V");
  state->setProp = env->GetMethodID(state->uiClass, "setProp", "(ILjava/lang/String;Ljava/lang/String;)V");
  state->setText = env->GetMethodID(state->uiClass, "setText", "(ILjava/lang/String;)V");
  state->measureNode = env->GetMethodID(state->uiClass, "measureNode", "(IFIFI)J");
  state->syncTextInputState = env->GetMethodID(state->uiClass, "syncTextInputState", "(ILjava/lang/String;II)V");
  state->insertChild = env->GetMethodID(state->uiClass, "insertChild", "(III)V");
  state->removeChild = env->GetMethodID(state->uiClass, "removeChild", "(II)V");
  state->setHandler = env->GetMethodID(state->uiClass, "setHandler", "(ILjava/lang/String;)V");
  state->setInputHandler = env->GetMethodID(state->uiClass, "setInputHandler", "(II)V");
  state->clearInputHandler = env->GetMethodID(state->uiClass, "clearInputHandler", "(I)V");
  state->applyBatch = env->GetMethodID(state->uiClass, "applyBatch", "(Ljava/lang/String;)V");
  state->applyBatchTypedPacked =
      env->GetMethodID(state->uiClass, "applyBatchTypedPacked", "([D[Ljava/lang/String;)V");
  state->applyBatchTypedBuffer =
      env->GetMethodID(state->uiClass, "applyBatchTypedBuffer", "(Ljava/nio/ByteBuffer;I[Ljava/lang/String;)V");
  state->applyMountTransaction =
      env->GetMethodID(state->uiClass, "applyMountTransaction", "(Ljava/nio/ByteBuffer;I[Ljava/lang/String;)V");
  state->applyMountTransactionSync =
      env->GetMethodID(state->uiClass, "applyMountTransactionSync", "(Ljava/nio/ByteBuffer;I[Ljava/lang/String;)V");
  state->setNativeCommitEnabled =
      env->GetMethodID(state->uiClass, "setNativeCommitEnabled", "(Z)V");
  state->beginAtomicCommit = env->GetMethodID(state->uiClass, "beginAtomicCommit", "()V");
  state->endAtomicCommit = env->GetMethodID(state->uiClass, "endAtomicCommit", "()V");
  state->setSurface = env->GetMethodID(state->uiClass, "setSurface", "(I)V");
  state->flush = env->GetMethodID(state->uiClass, "flush", "()V");
  state->applyAnimatedStyle =
      env->GetMethodID(state->uiClass, "applyAnimatedStyle", "(IFFFFFFFFFFF)V");
  state->applyAnimatedLayoutStyle =
      env->GetMethodID(state->uiClass, "applyAnimatedLayoutStyle", "(IFFFFFFFFFFFFFFFFFFFFFFFFFFFF)V");
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
  jclass nativeOverlayClass = env->FindClass("com/zynth/kit/runtime/ZynthNativeErrorOverlay");
  if (nativeOverlayClass) {
    state->nativeOverlayClass = static_cast<jclass>(env->NewGlobalRef(nativeOverlayClass));
    env->DeleteLocalRef(nativeOverlayClass);
    state->nativeOverlayHandleRaw =
        env->GetStaticMethodID(state->nativeOverlayClass, "handleRawEvent", "(Ljava/lang/String;)V");
    if (!gNativeOverlayClass && state->nativeOverlayClass && state->nativeOverlayHandleRaw) {
      gNativeOverlayClass = static_cast<jclass>(env->NewGlobalRef(state->nativeOverlayClass));
      gNativeOverlayHandleRawMethod = state->nativeOverlayHandleRaw;
    }
  }
  jclass performanceOverlayClass = env->FindClass("com/zynth/kit/runtime/ZynthNativePerformanceOverlay");
  if (performanceOverlayClass) {
    state->performanceOverlayClass = static_cast<jclass>(env->NewGlobalRef(performanceOverlayClass));
    env->DeleteLocalRef(performanceOverlayClass);
    state->performanceOverlayRecordYoga =
        env->GetStaticMethodID(state->performanceOverlayClass, "recordNativeYogaPass", "(DDD)V");
  }
  jclass stringCls = env->FindClass("java/lang/String");
  if (stringCls) {
    state->stringClass = static_cast<jclass>(env->NewGlobalRef(stringCls));
    env->DeleteLocalRef(stringCls);
  }

  state->rendererHost.measureFunc_ = zynthYogaMeasureFunc;
  state->measureRegistry.setCallback([state](int32_t nodeId, float width, YGMeasureMode widthMode, float height, YGMeasureMode heightMode) -> YGSize {
    JNIEnv *env = getEnv();
    if (!env || !state->uiManager || !state->measureNode) return {0, 0};
    
    jlong result = env->CallLongMethod(state->uiManager, state->measureNode,
                                       static_cast<jint>(nodeId),
                                       static_cast<jfloat>(width),
                                       static_cast<jint>(widthMode),
                                       static_cast<jfloat>(height),
                                       static_cast<jint>(heightMode));
                                       
    uint32_t mwRaw = (result >> 32) & 0xFFFFFFFF;
    uint32_t mhRaw = result & 0xFFFFFFFF;
    float mw, mh;
    std::memcpy(&mw, &mwRaw, sizeof(float));
    std::memcpy(&mh, &mhRaw, sizeof(float));
    return {mw, mh};
  });

  {
    std::lock_guard<std::mutex> lock(gStateMutex);
    gStates[runtime] = state;
  }
  
  if (state->setNativeCommitEnabled) {
    env->CallVoidMethod(state->uiManager, state->setNativeCommitEnabled, state->useNativeCommit ? JNI_TRUE : JNI_FALSE);
  }

  installConsole(*runtime, state.get());
  installGlobals(*runtime);
  installDevtoolsBridge(*runtime, state.get());
  installCrashSignalHandlers();
  installModulesStub(*runtime);
  installTimers(*runtime, runtime);
  installUIBindings(*runtime, runtime);
  installSharedSignals(*runtime, state.get());
  installSyncSignals(*runtime, state.get());
  installWorkletsBridge(*runtime, runtime);
  auto shared = sharedStateFor(runtime);
  if (shared) {
    zynth::kit::installUICommandsRegistry(shared, *runtime);
  }
  runtime->global().setProperty(
      *runtime, "__ZYNTH_PLATFORM", String::createFromUtf8(*runtime, "android"));
  installJSIPlugins(*runtime, state.get());
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
  auto state = sharedStateFor(runtime);
  try {
    runtime->evaluateJavaScript(buffer, source ? source : "<android>");
  } catch (const facebook::jsi::JSError &error) {
    std::string message = error.getMessage();
    std::string stack = error.getStack();
    std::string combined = stack.empty() ? message : (message + "\n" + stack);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", combined);
  } catch (const std::exception &error) {
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", error.what());
  } catch (...) {
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", "Unknown evaluateScript failure");
  }
  if (sourceUrl && source) env->ReleaseStringUTFChars(sourceUrl, source);
}

class ZynthBytecodeBuffer : public facebook::jsi::Buffer {
public:
    ZynthBytecodeBuffer(std::vector<uint8_t> data) : data_(std::move(data)) {}
    const uint8_t *data() const override { return data_.data(); }
    size_t size() const override { return data_.size(); }
private:
    std::vector<uint8_t> data_;
};

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_loadBytecode(JNIEnv *env, jobject, jlong ptr, jbyteArray bytecode, jstring sourceUrl) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime || !bytecode) return;

  jsize len = env->GetArrayLength(bytecode);
  if (len == 0) return;

  jbyte *bytes = env->GetByteArrayElements(bytecode, nullptr);
  if (!bytes) return;

  std::vector<uint8_t> data(len);
  std::memcpy(data.data(), bytes, len);
  
  env->ReleaseByteArrayElements(bytecode, bytes, JNI_ABORT);

  const char *source = sourceUrl ? env->GetStringUTFChars(sourceUrl, nullptr) : nullptr;
  
  auto buffer = std::make_shared<ZynthBytecodeBuffer>(std::move(data));
  auto state = sharedStateFor(runtime);
  try {
    runtime->evaluateJavaScript(buffer, source ? source : "main.hbc");
  } catch (const facebook::jsi::JSError &e) {
    __android_log_print(ANDROID_LOG_ERROR, "ZynthRuntime", "Failed to load bytecode: %s", e.getMessage().c_str());
    std::string message = e.getMessage();
    std::string stack = e.getStack();
    std::string combined = stack.empty() ? message : (message + "\n" + stack);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", combined);
  } catch (const std::exception &e) {
    __android_log_print(ANDROID_LOG_ERROR, "ZynthRuntime", "Failed to load bytecode: %s", e.what());
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", e.what());
  } catch (...) {
    __android_log_print(ANDROID_LOG_ERROR, "ZynthRuntime", "Failed to load bytecode: Unknown error");
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", "Unknown bytecode evaluation failure");
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
  } catch (const JSError &error) {
    auto state = sharedStateFor(runtime);
    std::string message = error.getMessage();
    std::string stack = error.getStack();
    std::string combined = stack.empty() ? message : (message + "\n" + stack);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", combined);
  } catch (const std::exception &error) {
    auto state = sharedStateFor(runtime);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", error.what());
  } catch (...) {
    auto state = sharedStateFor(runtime);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", "Unknown callGlobalDouble failure");
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
  } catch (const JSError &error) {
    auto state = sharedStateFor(runtime);
    std::string message = error.getMessage();
    std::string stack = error.getStack();
    std::string combined = stack.empty() ? message : (message + "\n" + stack);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", combined);
  } catch (const std::exception &error) {
    auto state = sharedStateFor(runtime);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", error.what());
  } catch (...) {
    auto state = sharedStateFor(runtime);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", "Unknown callGlobalFrame failure");
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
  } catch (const JSError &error) {
    auto state = sharedStateFor(runtime);
    std::string message = error.getMessage();
    std::string stack = error.getStack();
    std::string combined = stack.empty() ? message : (message + "\n" + stack);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", combined);
  } catch (const std::exception &error) {
    auto state = sharedStateFor(runtime);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", error.what());
  } catch (...) {
    auto state = sharedStateFor(runtime);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", "Unknown emitEvent failure");
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_invokePressEvent(JNIEnv *env,
                                                     jobject,
                                                     jlong runtimePtr,
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
  facebook::hermes::HermesRuntime *runtime =
      reinterpret_cast<facebook::hermes::HermesRuntime *>(runtimePtr);
  if (!runtime) return;
  std::shared_ptr<Function> handler;
  {
    std::lock_guard<std::mutex> lock(gHandlerMutex);
    auto it = gHandlers.find(HandlerKey{runtime, static_cast<int>(nodeId), eventName});
    if (it == gHandlers.end()) return;
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
                                                jlong runtimePtr,
                                                jint nodeId,
                                                jstring name,
                                                jstring payloadJson) {
  if (!name) return;
  const char *utf8 = env->GetStringUTFChars(name, nullptr);
  std::string eventName = utf8 ? utf8 : "";
  env->ReleaseStringUTFChars(name, utf8);
  if (eventName.empty()) return;
  facebook::hermes::HermesRuntime *runtime =
      reinterpret_cast<facebook::hermes::HermesRuntime *>(runtimePtr);
  if (!runtime) return;
  std::shared_ptr<Function> handler;
  {
    std::lock_guard<std::mutex> lock(gHandlerMutex);
    auto it = gHandlers.find(HandlerKey{runtime, static_cast<int>(nodeId), eventName});
    if (it == gHandlers.end()) return;
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

extern "C" JNIEXPORT jstring JNICALL
Java_com_zynth_kit_runtime_JSBridge_runInputHandlerOnUiRuntime(JNIEnv *env,
                                                               jobject,
                                                               jlong ptr,
                                                               jint workletId,
                                                               jstring currentText,
                                                               jstring newInput,
                                                               jstring proposedText) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return nullptr;
  auto state = sharedStateFor(runtime);
  if (!state) return nullptr;

  const char *currentUtf8 = currentText ? env->GetStringUTFChars(currentText, nullptr) : nullptr;
  const char *inputUtf8 = newInput ? env->GetStringUTFChars(newInput, nullptr) : nullptr;
  const char *proposedUtf8 = proposedText ? env->GetStringUTFChars(proposedText, nullptr) : nullptr;
  std::string current = currentUtf8 ? currentUtf8 : "";
  std::string input = inputUtf8 ? inputUtf8 : "";
  std::string proposed = proposedUtf8 ? proposedUtf8 : "";
  if (currentText && currentUtf8) env->ReleaseStringUTFChars(currentText, currentUtf8);
  if (newInput && inputUtf8) env->ReleaseStringUTFChars(newInput, inputUtf8);
  if (proposedText && proposedUtf8) {
    env->ReleaseStringUTFChars(proposedText, proposedUtf8);
  }

  auto result = runInputHandlerWorkletOnUIRuntime(
      state, workletId, current, input, proposed);
  if (!result.has_value()) return nullptr;
  return env->NewStringUTF(result->c_str());
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_invokeLayoutEvent(JNIEnv *,
                                                      jobject,
                                                      jlong runtimePtr,
                                                      jint nodeId,
                                                      jdouble x,
                                                      jdouble y,
                                                      jdouble width,
                                                      jdouble height) {
  facebook::hermes::HermesRuntime *runtime =
      reinterpret_cast<facebook::hermes::HermesRuntime *>(runtimePtr);
  if (!runtime) return;
  std::shared_ptr<Function> handler;
  {
    std::lock_guard<std::mutex> lock(gHandlerMutex);
    auto it = gHandlers.find(HandlerKey{runtime, static_cast<int>(nodeId), "onLayout"});
    if (it == gHandlers.end()) return;
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

static void invokeLayoutEventsBatchInternal(
    JNIEnv *env,
    facebook::hermes::HermesRuntime *runtime,
    jdoubleArray payload,
    jsize requestedLength) {
  if (!env || !runtime || !payload) return;
  jsize availableLength = env->GetArrayLength(payload);
  jsize length = requestedLength >= 0 ? std::min(availableLength, requestedLength) : availableLength;
  if (length < 5) return;
  jdouble *data = env->GetDoubleArrayElements(payload, nullptr);
  if (!data) return;
  struct LayoutDispatchEntry {
    std::shared_ptr<Function> handler;
    double x = 0.0;
    double y = 0.0;
    double width = 0.0;
    double height = 0.0;
  };
  std::vector<LayoutDispatchEntry> dispatchEntries;
  dispatchEntries.reserve(static_cast<size_t>(length / 5));
  {
    std::lock_guard<std::mutex> lock(gHandlerMutex);
    for (jsize i = 0; i + 4 < length; i += 5) {
      int nodeId = static_cast<int>(data[i]);
      auto it = gHandlers.find(HandlerKey{runtime, nodeId, "onLayout"});
      if (it == gHandlers.end() || !it->second.handler) continue;
      LayoutDispatchEntry entry;
      entry.handler = it->second.handler;
      entry.x = data[i + 1];
      entry.y = data[i + 2];
      entry.width = data[i + 3];
      entry.height = data[i + 4];
      dispatchEntries.push_back(std::move(entry));
    }
  }
  
  Runtime &rt = *runtime;
  
  // Suspend host batching flushes in JS to prevent 1-op fragmentation
  try {
    Object global = rt.global();
    if (global.hasProperty(rt, "__setNativeBatching")) {
      global.getPropertyAsFunction(rt, "__setNativeBatching").call(rt, true);
    }
  } catch (...) {}

  for (const auto &entry : dispatchEntries) {
    if (!entry.handler) continue;
    Object payloadObj(rt);
    Object nativeEvent(rt);
    Object layout(rt);
    layout.setProperty(rt, "x", entry.x);
    layout.setProperty(rt, "y", entry.y);
    layout.setProperty(rt, "width", entry.width);
    layout.setProperty(rt, "height", entry.height);
    nativeEvent.setProperty(rt, "layout", layout);
    payloadObj.setProperty(rt, "nativeEvent", nativeEvent);
    try {
      entry.handler->call(rt, payloadObj);
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
  
  // Resume host batching
  try {
    Object global = rt.global();
    if (global.hasProperty(rt, "__setNativeBatching")) {
      global.getPropertyAsFunction(rt, "__setNativeBatching").call(rt, false);
    }
  } catch (...) {}

  env->ReleaseDoubleArrayElements(payload, data, JNI_ABORT);
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_invokeLayoutEventsBatch(JNIEnv *env,
                                                            jobject,
                                                            jlong runtimePtr,
                                                            jdoubleArray payload) {
  facebook::hermes::HermesRuntime *runtime =
      reinterpret_cast<facebook::hermes::HermesRuntime *>(runtimePtr);
  invokeLayoutEventsBatchInternal(env, runtime, payload, -1);
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_invokeLayoutEventsBatchSlice(JNIEnv *env,
                                                                 jobject,
                                                                 jlong runtimePtr,
                                                                 jdoubleArray payload,
                                                                 jint length) {
  facebook::hermes::HermesRuntime *runtime =
      reinterpret_cast<facebook::hermes::HermesRuntime *>(runtimePtr);
  invokeLayoutEventsBatchInternal(env, runtime, payload, static_cast<jsize>(length));
}

static jobject jsValueToJava(JNIEnv *env, Runtime &rt, RuntimeState *state, const Value &value) {
  if (value.isString()) {
    return env->NewStringUTF(value.asString(rt).utf8(rt).c_str());
  }
  if (value.isNumber()) {
    if (!state->doubleClass || !state->doubleConstructor) return nullptr;
    return env->NewObject(state->doubleClass, state->doubleConstructor, value.asNumber());
  }
  if (value.isBool()) {
    if (!state->booleanClass || !state->booleanConstructor) return nullptr;
    return env->NewObject(state->booleanClass, state->booleanConstructor, value.getBool());
  }
  if (value.isObject()) {
    if (!state->jsonObjectClass || !state->jsonObjectConstructor) return nullptr;
    // JSON.stringify the object
    try {
      Object json = rt.global().getPropertyAsObject(rt, "JSON");
      Function stringify = json.getPropertyAsFunction(rt, "stringify");
      Value result = stringify.call(rt, value);
      if (result.isString()) {
        jstring jsonStr = env->NewStringUTF(result.asString(rt).utf8(rt).c_str());
        jobject jsonObj = env->NewObject(state->jsonObjectClass, state->jsonObjectConstructor, jsonStr);
        env->DeleteLocalRef(jsonStr);
        return jsonObj;
      }
    } catch (...) {
      return nullptr;
    }
  }
  return nullptr; // null/undefined
}

static Value javaJsonToJs(JNIEnv *env, Runtime &rt, jobject jsonObject) {
  if (!jsonObject) return Value::null();
  jmethodID toString = env->GetMethodID(env->GetObjectClass(jsonObject), "toString", "()Ljava/lang/String;");
  jstring jsonStr = (jstring)env->CallObjectMethod(jsonObject, toString);
  if (!jsonStr) return Value::null();
  
  const char *utf8 = env->GetStringUTFChars(jsonStr, nullptr);
  std::string str = utf8 ? utf8 : "";
  env->ReleaseStringUTFChars(jsonStr, utf8);
  env->DeleteLocalRef(jsonStr);

  try {
    Object json = rt.global().getPropertyAsObject(rt, "JSON");
    Function parse = json.getPropertyAsFunction(rt, "parse");
    return parse.call(rt, String::createFromUtf8(rt, str));
  } catch (...) {
    return Value::undefined();
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_installModuleRegistry(JNIEnv *env, jobject, jlong ptr, jobject registry) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime || !registry) return;
  auto state = sharedStateFor(runtime);
  if (!state) return;

  state->moduleRegistry = env->NewGlobalRef(registry);
  jclass regClass = env->GetObjectClass(registry);
  state->moduleRegistryClass = static_cast<jclass>(env->NewGlobalRef(regClass));
  state->moduleCall = env->GetMethodID(state->moduleRegistryClass, "call", "(Ljava/lang/String;Ljava/lang/String;[Ljava/lang/Object;)Lorg/json/JSONObject;");
  state->moduleCallSync = env->GetMethodID(state->moduleRegistryClass, "callSync", "(Ljava/lang/String;Ljava/lang/String;[Ljava/lang/Object;)Ljava/lang/Object;");

  jclass jsonCls = env->FindClass("org/json/JSONObject");
  state->jsonObjectClass = static_cast<jclass>(env->NewGlobalRef(jsonCls));
  state->jsonObjectConstructor = env->GetMethodID(state->jsonObjectClass, "<init>", "(Ljava/lang/String;)V");
  env->DeleteLocalRef(jsonCls);

  jclass doubleCls = env->FindClass("java/lang/Double");
  state->doubleClass = static_cast<jclass>(env->NewGlobalRef(doubleCls));
  state->doubleConstructor = env->GetMethodID(state->doubleClass, "<init>", "(D)V");
  env->DeleteLocalRef(doubleCls);

  jclass boolCls = env->FindClass("java/lang/Boolean");
  state->booleanClass = static_cast<jclass>(env->NewGlobalRef(boolCls));
  state->booleanConstructor = env->GetMethodID(state->booleanClass, "<init>", "(Z)V");
  env->DeleteLocalRef(boolCls);

  jclass stringCls = env->FindClass("java/lang/String");
  if (stringCls && !state->stringClass) {
    state->stringClass = static_cast<jclass>(env->NewGlobalRef(stringCls));
  }
  if (stringCls) {
    env->DeleteLocalRef(stringCls);
  }

  Runtime &rt = *runtime;

  auto callFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "call"), 2,
      [state, runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (!state || !state->moduleRegistry || !state->moduleCall) return Value::undefined();
        if (count < 2 || !args[0].isString() || !args[1].isString()) return Value::undefined();
        
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();

        std::string moduleName = args[0].asString(rt).utf8(rt);
        std::string methodName = args[1].asString(rt).utf8(rt);
        jstring jModule = env->NewStringUTF(moduleName.c_str());
        jstring jMethod = env->NewStringUTF(methodName.c_str());

        // Marshal args
        size_t argCount = count > 2 ? count - 2 : 0;
        jobjectArray jArgs = nullptr;
        if (argCount > 0) {
          jclass objCls = env->FindClass("java/lang/Object");
          jArgs = env->NewObjectArray(static_cast<jsize>(argCount), objCls, nullptr);
          env->DeleteLocalRef(objCls);
          
          for (size_t i = 0; i < argCount; i++) {
            jobject jArg = jsValueToJava(env, rt, state.get(), args[i + 2]);
            env->SetObjectArrayElement(jArgs, static_cast<jsize>(i), jArg);
            if (jArg) env->DeleteLocalRef(jArg);
          }
        } else {
             jclass objCls = env->FindClass("java/lang/Object");
             jArgs = env->NewObjectArray(0, objCls, nullptr);
             env->DeleteLocalRef(objCls);
        }

        jobject resultObj = env->CallObjectMethod(state->moduleRegistry, state->moduleCall, jModule, jMethod, jArgs);
        
        env->DeleteLocalRef(jModule);
        env->DeleteLocalRef(jMethod);
        env->DeleteLocalRef(jArgs);

        Value result = javaJsonToJs(env, rt, resultObj);
        if (resultObj) env->DeleteLocalRef(resultObj);
        return result;
      });

  auto callSyncFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "callSync"), 2,
      [state, runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (!state || !state->moduleRegistry || !state->moduleCallSync) return Value::undefined();
        if (count < 2 || !args[0].isString() || !args[1].isString()) return Value::undefined();
        
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();

        std::string moduleName = args[0].asString(rt).utf8(rt);
        std::string methodName = args[1].asString(rt).utf8(rt);
        jstring jModule = env->NewStringUTF(moduleName.c_str());
        jstring jMethod = env->NewStringUTF(methodName.c_str());

        // Marshal args
        size_t argCount = count > 2 ? count - 2 : 0;
        jobjectArray jArgs = nullptr;
        if (argCount > 0) {
          jclass objCls = env->FindClass("java/lang/Object");
          jArgs = env->NewObjectArray(static_cast<jsize>(argCount), objCls, nullptr);
          env->DeleteLocalRef(objCls);
          
          for (size_t i = 0; i < argCount; i++) {
            jobject jArg = jsValueToJava(env, rt, state.get(), args[i + 2]);
            env->SetObjectArrayElement(jArgs, static_cast<jsize>(i), jArg);
            if (jArg) env->DeleteLocalRef(jArg);
          }
        } else {
             jclass objCls = env->FindClass("java/lang/Object");
             jArgs = env->NewObjectArray(0, objCls, nullptr);
             env->DeleteLocalRef(objCls);
        }

        jobject resultObj = env->CallObjectMethod(state->moduleRegistry, state->moduleCallSync, jModule, jMethod, jArgs);
        
        env->DeleteLocalRef(jModule);
        env->DeleteLocalRef(jMethod);
        env->DeleteLocalRef(jArgs);

        if (!resultObj) return Value::null();

        if (env->IsInstanceOf(resultObj, state->stringClass)) {
            const char *utf8 = env->GetStringUTFChars((jstring)resultObj, nullptr);
            auto val = String::createFromUtf8(rt, utf8 ? utf8 : "");
            if (utf8) env->ReleaseStringUTFChars((jstring)resultObj, utf8);
            env->DeleteLocalRef(resultObj);
            return val;
        }

        Value result = javaJsonToJs(env, rt, resultObj);
        env->DeleteLocalRef(resultObj);
        return result;
      });

  Object modules(rt);
  modules.setProperty(rt, "call", callFn);
  modules.setProperty(rt, "callSync", callSyncFn);
  rt.global().setProperty(rt, "__modules", modules);
}
