#include <jni.h>
#include <android/log.h>
#include <dlfcn.h>
#include <jsi/jsi.h>
#include <vector>

#include "ZynthJSIPluginRegistry.h"
#include "ZynthJsiTypedPayload.h"

using namespace facebook::jsi;

namespace {
constexpr const char *kTag = "ZynthSkiaJSI";
constexpr const char *kSkiaKey = "__zynth_skia";

JavaVM *gVm = nullptr;
jclass gBridgeClass = nullptr;
jmethodID gCreateSurface = nullptr;
jmethodID gDisposeSurface = nullptr;
jmethodID gSubmitDrawCommands = nullptr;
jmethodID gSubmitDrawCommandsPacked = nullptr;
jmethodID gSubmitFrame = nullptr;
jmethodID gInvalidateSurface = nullptr;
jmethodID gSetFrameLoopEnabled = nullptr;

using RegisterInstallerFn = void (*)(ZynthJSIPluginInstaller);
RegisterInstallerFn gRegisterInstaller = nullptr;

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

  void *handle = dlopen("libzynthkit.so", RTLD_NOW | RTLD_GLOBAL);
  if (!handle) {
    __android_log_print(ANDROID_LOG_WARN, kTag, "Unable to dlopen libzynthkit.so: %s", dlerror());
    handle = RTLD_DEFAULT;
  }

  gRegisterInstaller = reinterpret_cast<RegisterInstallerFn>(
      dlsym(handle, "ZynthRegisterJSIPluginInstaller"));
}

std::string toJson(Runtime &rt, const Value &value) {
  try {
    Object json = rt.global().getPropertyAsObject(rt, "JSON");
    Function stringify = json.getPropertyAsFunction(rt, "stringify");
    Value result = stringify.call(rt, value);
    if (result.isString()) {
      return result.asString(rt).utf8(rt);
    }
  } catch (...) {
  }
  return "null";
}

bool callStaticBoolean(jmethodID methodId, jint nodeId, jvalue secondArg = {}) {
  JNIEnv *env = getEnv();
  if (!env || !gBridgeClass || !methodId) return false;

  jboolean result = JNI_FALSE;
  if (methodId == gSetFrameLoopEnabled) {
    result = env->CallStaticBooleanMethod(gBridgeClass, methodId, nodeId, secondArg.z);
  } else if (methodId == gSubmitDrawCommands || methodId == gSubmitFrame) {
    result = env->CallStaticBooleanMethod(gBridgeClass, methodId, nodeId, secondArg.l);
  } else {
    result = env->CallStaticBooleanMethod(gBridgeClass, methodId, nodeId);
  }

  if (env->ExceptionCheck()) {
    env->ExceptionClear();
    return false;
  }
  return result == JNI_TRUE;
}

void installSkiaBridge(Runtime &rt) {
  auto createSurface = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "createSurface"), 1,
      [](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value(false);
        int nodeId = static_cast<int>(args[0].asNumber());
        return Value(callStaticBoolean(gCreateSurface, nodeId));
      });

  auto disposeSurface = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "disposeSurface"), 1,
      [](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value(false);
        int nodeId = static_cast<int>(args[0].asNumber());
        return Value(callStaticBoolean(gDisposeSurface, nodeId));
      });

  auto submitDrawCommands = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "submitDrawCommands"), 2,
      [&rt](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber()) return Value(false);
        int nodeId = static_cast<int>(args[0].asNumber());
        std::string json = toJson(rt, args[1]);
        JNIEnv *env = getEnv();
        if (!env) return Value(false);
        jstring payload = env->NewStringUTF(json.c_str());
        jvalue arg{};
        arg.l = payload;
        bool ok = callStaticBoolean(gSubmitDrawCommands, nodeId, arg);
        env->DeleteLocalRef(payload);
        return Value(ok);
      });

  auto submitDrawCommandsPacked = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "submitDrawCommandsPacked"), 4,
      [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 4 || !args[0].isNumber() || !args[1].isObject() ||
            !args[2].isNumber() || !args[3].isObject()) {
          return Value(false);
        }
        int nodeId = static_cast<int>(args[0].asNumber());
        uint8_t *opsData = nullptr;
        size_t opsSize = 0;
        if (!zynth::jsiutil::readArrayBufferBytes(rt, args[1], &opsData, &opsSize)) {
          return Value(false);
        }
        std::vector<std::string> stringTable;
        if (!zynth::jsiutil::readStringTable(rt, args[3], &stringTable)) return Value(false);

        JNIEnv *env = getEnv();
        if (!env || !gBridgeClass || !gSubmitDrawCommandsPacked) return Value(false);

        jobject jBuffer = zynth::jsiutil::newDirectByteBuffer(env, opsData, opsSize);
        if (!jBuffer) return Value(false);

        const int opCount = static_cast<int>(args[2].asNumber());
        jobjectArray jStrings = zynth::jsiutil::newJavaStringArray(env, stringTable);
        if (!jStrings) {
          env->DeleteLocalRef(jBuffer);
          return Value(false);
        }

        jboolean result = env->CallStaticBooleanMethod(
            gBridgeClass, gSubmitDrawCommandsPacked, nodeId, jBuffer,
            static_cast<jint>(opCount), jStrings);
        env->DeleteLocalRef(jBuffer);
        env->DeleteLocalRef(jStrings);
        if (env->ExceptionCheck()) {
          env->ExceptionClear();
          return Value(false);
        }
        return Value(result == JNI_TRUE);
      });

  auto submitFrame = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "submitFrame"), 2,
      [&rt](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber()) return Value(false);
        int nodeId = static_cast<int>(args[0].asNumber());
        std::string json = toJson(rt, args[1]);
        JNIEnv *env = getEnv();
        if (!env) return Value(false);
        jstring payload = env->NewStringUTF(json.c_str());
        jvalue arg{};
        arg.l = payload;
        bool ok = callStaticBoolean(gSubmitFrame, nodeId, arg);
        env->DeleteLocalRef(payload);
        return Value(ok);
      });

  auto invalidateSurface = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "invalidateSurface"), 1,
      [](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value(false);
        int nodeId = static_cast<int>(args[0].asNumber());
        return Value(callStaticBoolean(gInvalidateSurface, nodeId));
      });

  auto setFrameLoopEnabled = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setFrameLoopEnabled"), 2,
      [](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isBool()) return Value(false);
        int nodeId = static_cast<int>(args[0].asNumber());
        jvalue enabled{};
        enabled.z = args[1].getBool();
        return Value(callStaticBoolean(gSetFrameLoopEnabled, nodeId, enabled));
      });

  Object skia(rt);
  skia.setProperty(rt, "createSurface", createSurface);
  skia.setProperty(rt, "disposeSurface", disposeSurface);
  skia.setProperty(rt, "submitDrawCommands", submitDrawCommands);
  skia.setProperty(rt, "submitDrawCommandsPacked", submitDrawCommandsPacked);
  skia.setProperty(rt, "submitFrame", submitFrame);
  skia.setProperty(rt, "invalidateSurface", invalidateSurface);
  skia.setProperty(rt, "setFrameLoopEnabled", setFrameLoopEnabled);
  rt.global().setProperty(rt, kSkiaKey, skia);
}

void registerInstaller() {
  resolveCoreSymbols();
  if (!gRegisterInstaller) {
    __android_log_print(ANDROID_LOG_WARN, kTag, "JSI plugin registry unavailable");
    return;
  }

  gRegisterInstaller([](Runtime &rt, void *state) {
    state = state;
    installSkiaBridge(rt);
  });
}
} // namespace

extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *) {
  gVm = vm;
  registerInstaller();
  return JNI_VERSION_1_6;
}

extern "C" JNIEXPORT void JNICALL
Java_dev_zynth_skia_ZynthSkiaJSI_nativeInstall(JNIEnv *env, jclass, jclass clazz) {
  if (!clazz) return;
  if (gBridgeClass) {
    env->DeleteGlobalRef(gBridgeClass);
    gBridgeClass = nullptr;
  }
  gBridgeClass = static_cast<jclass>(env->NewGlobalRef(clazz));
  gCreateSurface = env->GetStaticMethodID(gBridgeClass, "createSurface", "(I)Z");
  gDisposeSurface = env->GetStaticMethodID(gBridgeClass, "disposeSurface", "(I)Z");
  gSubmitDrawCommands = env->GetStaticMethodID(gBridgeClass, "submitDrawCommands", "(ILjava/lang/String;)Z");
  gSubmitDrawCommandsPacked = env->GetStaticMethodID(
      gBridgeClass, "submitDrawCommandsPacked",
      "(ILjava/nio/ByteBuffer;I[Ljava/lang/String;)Z");
  gSubmitFrame = env->GetStaticMethodID(gBridgeClass, "submitFrame", "(ILjava/lang/String;)Z");
  gInvalidateSurface = env->GetStaticMethodID(gBridgeClass, "invalidateSurface", "(I)Z");
  gSetFrameLoopEnabled = env->GetStaticMethodID(gBridgeClass, "setFrameLoopEnabled", "(IZ)Z");
}
