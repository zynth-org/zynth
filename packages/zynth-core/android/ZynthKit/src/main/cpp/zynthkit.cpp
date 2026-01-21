#include <jni.h>
#include <android/log.h>
#include <hermes/hermes.h>
#include <jsi/jsi.h>

#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>

using namespace facebook::jsi;

namespace {
JavaVM *gVm = nullptr;

struct RuntimeState {
  jobject uiManager = nullptr;
  jclass uiClass = nullptr;
  jmethodID createNode = nullptr;
  jmethodID createNodeWithId = nullptr;
  jmethodID setProp = nullptr;
  jmethodID setText = nullptr;
  jmethodID insertChild = nullptr;
  jmethodID removeChild = nullptr;
  jmethodID setHandler = nullptr;
  jmethodID applyBatch = nullptr;
  jmethodID setSurface = nullptr;
  jmethodID flush = nullptr;
};

std::mutex gStateMutex;
std::unordered_map<facebook::hermes::HermesRuntime *, RuntimeState> gStates;

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

JNIEnv *getEnv() {
  if (!gVm) return nullptr;
  JNIEnv *env = nullptr;
  if (gVm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) != JNI_OK) {
    if (gVm->AttachCurrentThread(&env, nullptr) != JNI_OK) return nullptr;
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
    if (v.isString()) {
      callSetProp(env, state, nodeId, key, v.asString(rt).utf8(rt));
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

void installConsole(Runtime &rt) {
  auto logFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "log"), 1,
      [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        count;
        rt;
        return Value::undefined();
      });

  Object console(rt);
  console.setProperty(rt, "log", logFn);
  console.setProperty(rt, "warn", logFn);
  console.setProperty(rt, "error", logFn);
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

RuntimeState *stateFor(facebook::hermes::HermesRuntime *runtime) {
  std::lock_guard<std::mutex> lock(gStateMutex);
  auto it = gStates.find(runtime);
  if (it == gStates.end()) return nullptr;
  return &it->second;
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
            Value tagVal = op.getProperty(rt, "tag");
            if (!tagVal.isString()) continue;
            jint nodeId = idVal.isNumber() ? static_cast<jint>(idVal.asNumber()) : 0;
            std::string tag = tagVal.asString(rt).utf8(rt);
            jstring jTag = env->NewStringUTF(tag.c_str());
            if (state->createNodeWithId) {
              env->CallVoidMethod(state->uiManager, state->createNodeWithId, jTag, nodeId);
            } else {
              env->CallIntMethod(state->uiManager, state->createNode, jTag);
            }
            env->DeleteLocalRef(jTag);
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

extern "C" jint JNI_OnLoad(JavaVM *vm, void *) {
  gVm = vm;
  return JNI_VERSION_1_6;
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
      if (env && it->second.uiManager) {
        env->DeleteGlobalRef(it->second.uiManager);
        env->DeleteGlobalRef(it->second.uiClass);
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

  RuntimeState state;
  state.uiManager = env->NewGlobalRef(uiManager);
  state.uiClass = static_cast<jclass>(env->NewGlobalRef(env->GetObjectClass(uiManager)));
  state.createNode = env->GetMethodID(state.uiClass, "createNode", "(Ljava/lang/String;)I");
  state.createNodeWithId =
      env->GetMethodID(state.uiClass, "createNodeWithId", "(Ljava/lang/String;I)V");
  state.setProp = env->GetMethodID(state.uiClass, "setProp", "(ILjava/lang/String;Ljava/lang/String;)V");
  state.setText = env->GetMethodID(state.uiClass, "setText", "(ILjava/lang/String;)V");
  state.insertChild = env->GetMethodID(state.uiClass, "insertChild", "(III)V");
  state.removeChild = env->GetMethodID(state.uiClass, "removeChild", "(II)V");
  state.setHandler = env->GetMethodID(state.uiClass, "setHandler", "(ILjava/lang/String;)V");
  state.applyBatch = env->GetMethodID(state.uiClass, "applyBatch", "(Ljava/lang/String;)V");
  state.setSurface = env->GetMethodID(state.uiClass, "setSurface", "(I)V");
  state.flush = env->GetMethodID(state.uiClass, "flush", "()V");

  {
    std::lock_guard<std::mutex> lock(gStateMutex);
    gStates[runtime] = state;
  }

  installConsole(*runtime);
  installGlobals(*runtime);
  installModulesStub(*runtime);
  installUIBindings(*runtime, runtime);
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
  } catch (...) {
    return;
  }
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
  } catch (...) {
    return;
  }
}
