#include <jni.h>
#include <cstdlib>
#include <string>

#include "rune_webserver.h"

static std::string jstringToString(JNIEnv *env, jstring value) {
  if (!value) {
    return std::string();
  }
  const char *chars = env->GetStringUTFChars(value, nullptr);
  if (!chars) {
    return std::string();
  }
  std::string result(chars);
  env->ReleaseStringUTFChars(value, chars);
  return result;
}

extern "C" JNIEXPORT jlong JNICALL
Java_dev_rune_webserver_RuneWebServerNative_start(
  JNIEnv *env,
  jobject,
  jstring host,
  jint port,
  jstring documentRoot,
  jstring indexHtml,
  jstring uploadPath,
  jstring uploadDir,
  jlong maxUploadBytes,
  jstring eventsPath
) {
  std::string hostStr = jstringToString(env, host);
  std::string documentRootStr = jstringToString(env, documentRoot);
  std::string indexHtmlStr = jstringToString(env, indexHtml);
  std::string uploadPathStr = jstringToString(env, uploadPath);
  std::string uploadDirStr = jstringToString(env, uploadDir);
  std::string eventsPathStr = jstringToString(env, eventsPath);

  RuneWebServerConfig config;
  config.host = hostStr.empty() ? nullptr : hostStr.c_str();
  config.port = static_cast<int>(port);
  config.document_root =
    documentRootStr.empty() ? nullptr : documentRootStr.c_str();
  config.index_html = indexHtmlStr.empty() ? nullptr : indexHtmlStr.c_str();
  config.upload_path =
    uploadPathStr.empty() ? nullptr : uploadPathStr.c_str();
  config.upload_dir = uploadDirStr.empty() ? nullptr : uploadDirStr.c_str();
  config.max_upload_bytes = static_cast<long long>(maxUploadBytes);
  config.events_path =
    eventsPathStr.empty() ? nullptr : eventsPathStr.c_str();

  RuneWebServer *server = rune_webserver_start(&config);
  return reinterpret_cast<jlong>(server);
}

extern "C" JNIEXPORT void JNICALL
Java_dev_rune_webserver_RuneWebServerNative_stop(
  JNIEnv *,
  jobject,
  jlong handle
) {
  auto *server = reinterpret_cast<RuneWebServer *>(handle);
  if (server) {
    rune_webserver_stop(server);
  }
}

extern "C" JNIEXPORT jboolean JNICALL
Java_dev_rune_webserver_RuneWebServerNative_isRunning(
  JNIEnv *,
  jobject,
  jlong handle
) {
  auto *server = reinterpret_cast<RuneWebServer *>(handle);
  return server && rune_webserver_is_running(server) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jint JNICALL
Java_dev_rune_webserver_RuneWebServerNative_getPort(
  JNIEnv *,
  jobject,
  jlong handle
) {
  auto *server = reinterpret_cast<RuneWebServer *>(handle);
  if (!server) return 0;
  return static_cast<jint>(rune_webserver_get_port(server));
}

extern "C" JNIEXPORT jobjectArray JNICALL
Java_dev_rune_webserver_RuneWebServerNative_drainEvents(
  JNIEnv *env,
  jobject,
  jlong handle,
  jint maxEvents
) {
  auto *server = reinterpret_cast<RuneWebServer *>(handle);
  if (!server || maxEvents <= 0) {
    jclass eventClass = env->FindClass("dev/rune/webserver/NativeWebServerEvent");
    return env->NewObjectArray(0, eventClass, nullptr);
  }

  size_t capacity = static_cast<size_t>(maxEvents);
  RuneWebServerEvent *events =
    static_cast<RuneWebServerEvent *>(calloc(capacity, sizeof(RuneWebServerEvent)));
  if (!events) {
    jclass eventClass = env->FindClass("dev/rune/webserver/NativeWebServerEvent");
    return env->NewObjectArray(0, eventClass, nullptr);
  }

  size_t count = rune_webserver_drain_events(server, events, capacity);
  jclass eventClass = env->FindClass("dev/rune/webserver/NativeWebServerEvent");
  jmethodID ctor = env->GetMethodID(
    eventClass,
    "<init>",
    "(Ljava/lang/String;Ljava/lang/String;)V"
  );

  jobjectArray array =
    env->NewObjectArray(static_cast<jsize>(count), eventClass, nullptr);

  for (size_t i = 0; i < count; i++) {
    const char *type = events[i].type ? events[i].type : "";
    const char *payload = events[i].payload ? events[i].payload : "";
    jstring typeStr = env->NewStringUTF(type);
    jstring payloadStr = env->NewStringUTF(payload);
    jobject eventObj = env->NewObject(eventClass, ctor, typeStr, payloadStr);
    env->SetObjectArrayElement(array, static_cast<jsize>(i), eventObj);
    env->DeleteLocalRef(typeStr);
    env->DeleteLocalRef(payloadStr);
    env->DeleteLocalRef(eventObj);
    rune_webserver_free_event(&events[i]);
  }

  free(events);
  return array;
}
