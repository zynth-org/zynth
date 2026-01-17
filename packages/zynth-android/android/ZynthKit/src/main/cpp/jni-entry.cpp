#include <jni.h>

#include <android/log.h>
#include <fbjni/fbjni.h>
#include <hermes/Public/RuntimeConfig.h>
#include <hermes/hermes.h>
#include <jsi/jsi.h>

#include <memory>
#include <string>
#include <vector>

namespace zynth::kit {
void setJavaVm(JavaVM *vm);
void destroyRuntime(facebook::hermes::HermesRuntime *runtime);
void installBindings(
    facebook::hermes::HermesRuntime *runtime,
    JNIEnv *env,
    jobject uiShim,
    jobject modulesShim,
    jobject timerShim,
    jobject errorHandler);
void evaluateString(
    facebook::hermes::HermesRuntime *runtime,
    const std::string &code,
    const std::string &sourceUrl);
void evaluateBytecode(
    facebook::hermes::HermesRuntime *runtime,
    const uint8_t *data,
    size_t length,
    const std::string &sourceUrl);
void callGlobal(
    facebook::hermes::HermesRuntime *runtime,
    JNIEnv *env,
    const std::string &name,
    jobjectArray args);
void onTimerFired(facebook::hermes::HermesRuntime *runtime, int timerId);
void onAnimationFrame(facebook::hermes::HermesRuntime *runtime, int frameId, double frameTimeMs);
void resolvePromise(facebook::hermes::HermesRuntime *runtime, int promiseId, const std::string &payloadJson);
void rejectPromise(facebook::hermes::HermesRuntime *runtime, int promiseId, const std::string &message);
void invokeHandler(facebook::hermes::HermesRuntime *runtime, long handlerId, int nodeId, const std::string &event);
void emitEvent(facebook::hermes::HermesRuntime *runtime, const std::string &eventName, const std::string &payloadJson);
void registerWorkletOnUIRuntime(facebook::hermes::HermesRuntime *runtime, int workletId);
void runWorkletOnUIRuntime(facebook::hermes::HermesRuntime *runtime, int workletId);

namespace {
constexpr const char *kTag = "ZynthKitNative";
}

void logDebug(const char *message) {
  __android_log_print(ANDROID_LOG_DEBUG, kTag, "%s", message);
}

facebook::hermes::HermesRuntime *fromPtr(jlong ptr) {
  return reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
}
} // namespace zynth::kit

namespace {

std::string toStdString(JNIEnv *env, jstring str) {
  if (!str) return {};
  const char *chars = env->GetStringUTFChars(str, nullptr);
  std::string result = chars ? chars : "";
  if (chars) {
    env->ReleaseStringUTFChars(str, chars);
  }
  return result;
}

} // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_com_zynth_kit_runtime_JSBridge_createHermesRuntime(JNIEnv *, jclass) {
  zynth::kit::logDebug("createHermesRuntime");
  auto runtime = facebook::hermes::makeHermesRuntime(
      hermes::vm::RuntimeConfig::Builder().build());
  return reinterpret_cast<jlong>(runtime.release());
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_destroyHermesRuntime(JNIEnv *, jclass, jlong runtimePtr) {
  auto *runtime = zynth::kit::fromPtr(runtimePtr);
  zynth::kit::destroyRuntime(runtime);
  delete runtime;
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_installBindings(
    JNIEnv *env,
    jclass,
    jlong runtimePtr,
    jobject uiShim,
    jobject modulesShim,
    jobject timerShim,
    jobject errorHandler) {
  auto *runtime = zynth::kit::fromPtr(runtimePtr);
  zynth::kit::installBindings(runtime, env, uiShim, modulesShim, timerShim, errorHandler);
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_evaluateString(
    JNIEnv *env,
    jclass,
    jlong runtimePtr,
    jstring script,
    jstring sourceUrl) {
  auto *runtime = zynth::kit::fromPtr(runtimePtr);
  std::string code = ::toStdString(env, script);
  std::string url = ::toStdString(env, sourceUrl);
  zynth::kit::evaluateString(runtime, code, url.empty() ? "<unknown>" : url);
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_evaluateBytecode(
    JNIEnv *env,
    jclass,
    jlong runtimePtr,
    jbyteArray bytecode,
    jstring sourceUrl) {
  auto *runtime = zynth::kit::fromPtr(runtimePtr);
  if (!bytecode) {
    return;
  }
  jsize length = env->GetArrayLength(bytecode);
  std::vector<uint8_t> buffer(length);
  env->GetByteArrayRegion(bytecode, 0, length, reinterpret_cast<jbyte *>(buffer.data()));
  std::string url = ::toStdString(env, sourceUrl);
  zynth::kit::evaluateBytecode(runtime, buffer.data(), buffer.size(), url.empty() ? "<unknown>" : url);
}

extern "C" JNIEXPORT jobject JNICALL
Java_com_zynth_kit_runtime_JSBridge_callGlobal(
    JNIEnv *env,
    jclass,
    jlong runtimePtr,
    jstring name,
    jobjectArray args) {
  // CRITICAL FIX: The env parameter is valid for THIS thread (the HandlerThread).
  // We should use it directly instead of creating a new JniEnv wrapper.
  // The issue was that we were discarding a valid env and trying to get a new one.
  auto *runtime = zynth::kit::fromPtr(runtimePtr);
  std::string functionName = ::toStdString(env, name);
  zynth::kit::callGlobal(runtime, env, functionName, args);
  return nullptr;
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_onTimerFired(
    JNIEnv *,
    jclass,
    jlong runtimePtr,
    jint timerId) {
  auto *runtime = zynth::kit::fromPtr(runtimePtr);
  zynth::kit::onTimerFired(runtime, timerId);
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_onAnimationFrame(
    JNIEnv *,
    jclass,
    jlong runtimePtr,
    jint frameId,
    jlong frameTimeNanos) {
  auto *runtime = zynth::kit::fromPtr(runtimePtr);
  double frameTimeMs = static_cast<double>(frameTimeNanos) / 1000000.0;
  zynth::kit::onAnimationFrame(runtime, frameId, frameTimeMs);
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_resolvePromise(
    JNIEnv *env,
    jclass,
    jlong runtimePtr,
    jint promiseId,
    jstring payload) {
  auto *runtime = zynth::kit::fromPtr(runtimePtr);
  zynth::kit::resolvePromise(runtime, promiseId, ::toStdString(env, payload));
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_rejectPromise(
    JNIEnv *env,
    jclass,
    jlong runtimePtr,
    jint promiseId,
    jstring message) {
  auto *runtime = zynth::kit::fromPtr(runtimePtr);
  zynth::kit::rejectPromise(runtime, promiseId, ::toStdString(env, message));
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_emitEvent(
    JNIEnv *env,
    jclass,
    jlong runtimePtr,
    jstring eventName,
    jstring payloadJson) {
  auto *runtime = zynth::kit::fromPtr(runtimePtr);
  if (!runtime) {
    return;
  }
  zynth::kit::emitEvent(runtime, ::toStdString(env, eventName), ::toStdString(env, payloadJson));
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_invokeHandler(
    JNIEnv *env,
    jclass,
    jlong runtimePtr,
    jlong handlerId,
    jint nodeId,
    jstring eventName) {
  auto *runtime = zynth::kit::fromPtr(runtimePtr);
  zynth::kit::invokeHandler(runtime, handlerId, nodeId, ::toStdString(env, eventName));
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_registerWorkletOnUiRuntime(
    JNIEnv *,
    jclass,
    jlong runtimePtr,
    jint workletId) {
  auto *runtime = zynth::kit::fromPtr(runtimePtr);
  zynth::kit::registerWorkletOnUIRuntime(runtime, workletId);
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_runWorkletOnUiRuntime(
    JNIEnv *,
    jclass,
    jlong runtimePtr,
    jint workletId) {
  auto *runtime = zynth::kit::fromPtr(runtimePtr);
  zynth::kit::runWorkletOnUIRuntime(runtime, workletId);
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_dev_ZynthDiagnosticsKt_zynthDiagnosticsReportJNI(
    JNIEnv *env,
    jclass,
    jstring phase,
    jstring message,
    jstring stack) {
  // This is the JNI bridge for ZynthDiagnostics.report() calls from native C++
  jclass diagClass = env->FindClass("com/zynth/kit/dev/ZynthDiagnostics");
  if (!diagClass) {
    return;
  }
  
  jmethodID reportMethod = env->GetStaticMethodID(
      diagClass,
      "report", 
      "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V");
  if (!reportMethod) {
    env->DeleteLocalRef(diagClass);
    return;
  }
  
  env->CallStaticVoidMethod(diagClass, reportMethod, phase, message, stack);
  env->DeleteLocalRef(diagClass);
}

extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *) {
  facebook::jni::Environment::initialize(vm);
  zynth::kit::setJavaVm(vm);
  zynth::kit::logDebug("JNI_OnLoad");
  return JNI_VERSION_1_6;
}
