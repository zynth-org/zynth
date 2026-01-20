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

JNIEnv *getEnv() {
  if (!gVm) return nullptr;
  JNIEnv *env = nullptr;
  if (gVm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) != JNI_OK) {
    if (gVm->AttachCurrentThread(&env, nullptr) != JNI_OK) return nullptr;
  }
  return env;
}

void installConsole(Runtime &rt) {
  auto logFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "log"), 1,
      [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        std::string out;
        for (size_t i = 0; i < count; i++) {
          if (i > 0) out += " ";
          if (args[i].isString()) {
            out += args[i].asString(rt).utf8(rt);
          } else if (args[i].isNumber()) {
            out += std::to_string(args[i].asNumber());
          } else if (args[i].isBool()) {
            out += args[i].getBool() ? "true" : "false";
          } else if (args[i].isNull()) {
            out += "null";
          } else if (args[i].isUndefined()) {
            out += "undefined";
          } else {
            out += "[object]";
          }
        }
        __android_log_print(ANDROID_LOG_INFO, "ZynthJS", "%s", out.c_str());
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
        std::string json = args[2].isString() ? args[2].asString(rt).utf8(rt) : "";
        jstring jName = env->NewStringUTF(name.c_str());
        jstring jValue = env->NewStringUTF(json.c_str());
        env->CallVoidMethod(state->uiManager, state->setProp, nodeId, jName, jValue);
        env->DeleteLocalRef(jName);
        env->DeleteLocalRef(jValue);
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
        if (count < 3 || !args[0].isNumber() || !args[1].isString() || !args[2].isNumber()) {
          return Value::undefined();
        }
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        jint nodeId = static_cast<jint>(args[0].asNumber());
        std::string name = args[1].asString(rt).utf8(rt);
        jstring jName = env->NewStringUTF(name.c_str());
        jlong handlerId = static_cast<jlong>(args[2].asNumber());
        env->CallVoidMethod(state->uiManager, state->setHandler, nodeId, jName, handlerId);
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
  ui.setProperty(rt, "setSurface", setSurface);
  ui.setProperty(rt, "flush", flush);
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
  state.setProp = env->GetMethodID(state.uiClass, "setProp", "(ILjava/lang/String;Ljava/lang/String;)V");
  state.setText = env->GetMethodID(state.uiClass, "setText", "(ILjava/lang/String;)V");
  state.insertChild = env->GetMethodID(state.uiClass, "insertChild", "(III)V");
  state.removeChild = env->GetMethodID(state.uiClass, "removeChild", "(II)V");
  state.setHandler = env->GetMethodID(state.uiClass, "setHandler", "(ILjava/lang/String;J)V");
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
  runtime->evaluateJavaScript(buffer, source ? source : "<android>");
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
  (fn.*callFn)(rt, &arg, 1);
}
