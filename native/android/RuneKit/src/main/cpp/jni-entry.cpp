#include <jni.h>

#include <android/log.h>
#include <hermes/Public/RuntimeConfig.h>
#include <hermes/hermes.h>
#include <jsi/jsi.h>

#include <memory>
#include <string>
#include <vector>

namespace rune::kit {
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
void resolvePromise(facebook::hermes::HermesRuntime *runtime, int promiseId, const std::string &payloadJson);
void rejectPromise(facebook::hermes::HermesRuntime *runtime, int promiseId, const std::string &message);
void invokeHandler(facebook::hermes::HermesRuntime *runtime, long handlerId, int nodeId, const std::string &event);

namespace {
constexpr const char *kTag = "RuneKitNative";
}

void logDebug(const char *message) {
  __android_log_print(ANDROID_LOG_DEBUG, kTag, "%s", message);
}

facebook::hermes::HermesRuntime *fromPtr(jlong ptr) {
  return reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
}
} // namespace rune::kit

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
Java_com_rune_kit_runtime_JSBridge_createHermesRuntime(JNIEnv *, jclass) {
  rune::kit::logDebug("createHermesRuntime");
  auto runtime = facebook::hermes::makeHermesRuntime(
      hermes::vm::RuntimeConfig::Builder().build());
  return reinterpret_cast<jlong>(runtime.release());
}

extern "C" JNIEXPORT void JNICALL
Java_com_rune_kit_runtime_JSBridge_destroyHermesRuntime(JNIEnv *, jclass, jlong runtimePtr) {
  auto *runtime = rune::kit::fromPtr(runtimePtr);
  rune::kit::destroyRuntime(runtime);
  delete runtime;
}

extern "C" JNIEXPORT void JNICALL
Java_com_rune_kit_runtime_JSBridge_installBindings(
    JNIEnv *env,
    jclass,
    jlong runtimePtr,
    jobject uiShim,
    jobject modulesShim,
    jobject timerShim,
    jobject errorHandler) {
  auto *runtime = rune::kit::fromPtr(runtimePtr);
  rune::kit::installBindings(runtime, env, uiShim, modulesShim, timerShim, errorHandler);
}

extern "C" JNIEXPORT void JNICALL
Java_com_rune_kit_runtime_JSBridge_evaluateString(
    JNIEnv *env,
    jclass,
    jlong runtimePtr,
    jstring script,
    jstring sourceUrl) {
  auto *runtime = rune::kit::fromPtr(runtimePtr);
  std::string code = ::toStdString(env, script);
  std::string url = ::toStdString(env, sourceUrl);
  rune::kit::evaluateString(runtime, code, url.empty() ? "<unknown>" : url);
}

extern "C" JNIEXPORT void JNICALL
Java_com_rune_kit_runtime_JSBridge_evaluateBytecode(
    JNIEnv *env,
    jclass,
    jlong runtimePtr,
    jbyteArray bytecode,
    jstring sourceUrl) {
  auto *runtime = rune::kit::fromPtr(runtimePtr);
  if (!bytecode) {
    return;
  }
  jsize length = env->GetArrayLength(bytecode);
  std::vector<uint8_t> buffer(length);
  env->GetByteArrayRegion(bytecode, 0, length, reinterpret_cast<jbyte *>(buffer.data()));
  std::string url = ::toStdString(env, sourceUrl);
  rune::kit::evaluateBytecode(runtime, buffer.data(), buffer.size(), url.empty() ? "<unknown>" : url);
}

extern "C" JNIEXPORT jobject JNICALL
Java_com_rune_kit_runtime_JSBridge_callGlobal(
    JNIEnv *env,
    jclass,
    jlong runtimePtr,
    jstring name,
    jobjectArray args) {
  auto *runtime = rune::kit::fromPtr(runtimePtr);
  std::string functionName = ::toStdString(env, name);
  rune::kit::callGlobal(runtime, env, functionName, args);
  return nullptr;
}

extern "C" JNIEXPORT void JNICALL
Java_com_rune_kit_runtime_JSBridge_onTimerFired(
    JNIEnv *,
    jclass,
    jlong runtimePtr,
    jint timerId) {
  auto *runtime = rune::kit::fromPtr(runtimePtr);
  rune::kit::onTimerFired(runtime, timerId);
}

extern "C" JNIEXPORT void JNICALL
Java_com_rune_kit_runtime_JSBridge_resolvePromise(
    JNIEnv *env,
    jclass,
    jlong runtimePtr,
    jint promiseId,
    jstring payload) {
  auto *runtime = rune::kit::fromPtr(runtimePtr);
  rune::kit::resolvePromise(runtime, promiseId, ::toStdString(env, payload));
}

extern "C" JNIEXPORT void JNICALL
Java_com_rune_kit_runtime_JSBridge_rejectPromise(
    JNIEnv *env,
    jclass,
    jlong runtimePtr,
    jint promiseId,
    jstring message) {
  auto *runtime = rune::kit::fromPtr(runtimePtr);
  rune::kit::rejectPromise(runtime, promiseId, ::toStdString(env, message));
}

extern "C" JNIEXPORT void JNICALL
Java_com_rune_kit_runtime_JSBridge_invokeHandler(
    JNIEnv *env,
    jclass,
    jlong runtimePtr,
    jlong handlerId,
    jint nodeId,
    jstring eventName) {
  auto *runtime = rune::kit::fromPtr(runtimePtr);
  rune::kit::invokeHandler(runtime, handlerId, nodeId, ::toStdString(env, eventName));
}

extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *) {
  rune::kit::setJavaVm(vm);
  rune::kit::logDebug("JNI_OnLoad");
  return JNI_VERSION_1_6;
}
