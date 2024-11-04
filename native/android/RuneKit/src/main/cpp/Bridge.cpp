#include <jni.h>
#include <android/log.h>

#define LOG_TAG "RuneBridge"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)

extern "C" JNIEXPORT void JNICALL
Java_com_rune_kit_runtime_RuneBridge_nativeInstallBindings(JNIEnv *env, jclass, jobject /*adapter*/, jobject /*manager*/) {
  LOGI("nativeInstallBindings stub invoked");
  // TODO: wire native host functions (__ui.*, __modules.call) once Hermes/JSI integration is available.
}
