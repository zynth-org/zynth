#include <jni.h>
#include <cstdlib>
#include <string>

#include "zynth_webserver.h"

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
Java_dev_zynth_webserver_ZynthWebServerNative_start(
  JNIEnv *env,
  jobject,
  jstring host,
  jint port,
  jboolean tlsEnabled,
  jstring tlsCertificate,
  jstring documentRoot,
  jstring indexHtml,
  jstring uploadPath,
  jstring uploadDir,
  jstring uploadMetadataPath,
  jstring uploadAuthToken,
  jstring uploadAuthHeader,
  jstring uploadAuthQueryKey,
  jlong maxUploadBytes,
  jstring eventsPath
) {
  std::string hostStr = jstringToString(env, host);
  std::string tlsCertificateStr = jstringToString(env, tlsCertificate);
  std::string documentRootStr = jstringToString(env, documentRoot);
  std::string indexHtmlStr = jstringToString(env, indexHtml);
  std::string uploadPathStr = jstringToString(env, uploadPath);
  std::string uploadDirStr = jstringToString(env, uploadDir);
  std::string uploadMetadataPathStr = jstringToString(env, uploadMetadataPath);
  std::string uploadAuthTokenStr = jstringToString(env, uploadAuthToken);
  std::string uploadAuthHeaderStr = jstringToString(env, uploadAuthHeader);
  std::string uploadAuthQueryKeyStr = jstringToString(env, uploadAuthQueryKey);
  std::string eventsPathStr = jstringToString(env, eventsPath);

  ZynthWebServerConfig config;
  config.host = hostStr.empty() ? nullptr : hostStr.c_str();
  config.port = static_cast<int>(port);
  config.tls_enabled = tlsEnabled == JNI_TRUE ? 1 : 0;
  config.tls_certificate =
    tlsCertificateStr.empty() ? nullptr : tlsCertificateStr.c_str();
  config.document_root =
    documentRootStr.empty() ? nullptr : documentRootStr.c_str();
  config.index_html = indexHtmlStr.empty() ? nullptr : indexHtmlStr.c_str();
  config.upload_path =
    uploadPathStr.empty() ? nullptr : uploadPathStr.c_str();
  config.upload_dir = uploadDirStr.empty() ? nullptr : uploadDirStr.c_str();
  config.upload_metadata_path =
    uploadMetadataPathStr.empty() ? nullptr : uploadMetadataPathStr.c_str();
  config.upload_auth_token =
    uploadAuthTokenStr.empty() ? nullptr : uploadAuthTokenStr.c_str();
  config.upload_auth_header =
    uploadAuthHeaderStr.empty() ? nullptr : uploadAuthHeaderStr.c_str();
  config.upload_auth_query_key =
    uploadAuthQueryKeyStr.empty() ? nullptr : uploadAuthQueryKeyStr.c_str();
  config.max_upload_bytes = static_cast<long long>(maxUploadBytes);
  config.events_path =
    eventsPathStr.empty() ? nullptr : eventsPathStr.c_str();

  ZynthWebServer *server = zynth_webserver_start(&config);
  return reinterpret_cast<jlong>(server);
}

extern "C" JNIEXPORT jboolean JNICALL
Java_dev_zynth_webserver_ZynthWebServerNative_supportsTls(
  JNIEnv *,
  jobject
) {
  return zynth_webserver_supports_tls() ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jstring JNICALL
Java_dev_zynth_webserver_ZynthWebServerNative_getLastError(
  JNIEnv *env,
  jobject
) {
  char *message = zynth_webserver_get_last_error();
  if (!message) {
    return nullptr;
  }
  jstring result = env->NewStringUTF(message);
  zynth_webserver_free_string(message);
  return result;
}

extern "C" JNIEXPORT void JNICALL
Java_dev_zynth_webserver_ZynthWebServerNative_stop(
  JNIEnv *,
  jobject,
  jlong handle
) {
  auto *server = reinterpret_cast<ZynthWebServer *>(handle);
  if (server) {
    zynth_webserver_stop(server);
  }
}

extern "C" JNIEXPORT jboolean JNICALL
Java_dev_zynth_webserver_ZynthWebServerNative_isRunning(
  JNIEnv *,
  jobject,
  jlong handle
) {
  auto *server = reinterpret_cast<ZynthWebServer *>(handle);
  return server && zynth_webserver_is_running(server) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jint JNICALL
Java_dev_zynth_webserver_ZynthWebServerNative_getPort(
  JNIEnv *,
  jobject,
  jlong handle
) {
  auto *server = reinterpret_cast<ZynthWebServer *>(handle);
  if (!server) return 0;
  return static_cast<jint>(zynth_webserver_get_port(server));
}

extern "C" JNIEXPORT jobjectArray JNICALL
Java_dev_zynth_webserver_ZynthWebServerNative_drainEvents(
  JNIEnv *env,
  jobject,
  jlong handle,
  jint maxEvents
) {
  auto *server = reinterpret_cast<ZynthWebServer *>(handle);
  if (!server || maxEvents <= 0) {
    jclass eventClass = env->FindClass("dev/zynth/webserver/NativeWebServerEvent");
    return env->NewObjectArray(0, eventClass, nullptr);
  }

  size_t capacity = static_cast<size_t>(maxEvents);
  ZynthWebServerEvent *events =
    static_cast<ZynthWebServerEvent *>(calloc(capacity, sizeof(ZynthWebServerEvent)));
  if (!events) {
    jclass eventClass = env->FindClass("dev/zynth/webserver/NativeWebServerEvent");
    return env->NewObjectArray(0, eventClass, nullptr);
  }

  size_t count = zynth_webserver_drain_events(server, events, capacity);
  jclass eventClass = env->FindClass("dev/zynth/webserver/NativeWebServerEvent");
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
    zynth_webserver_free_event(&events[i]);
  }

  free(events);
  return array;
}

extern "C" JNIEXPORT jstring JNICALL
Java_dev_zynth_webserver_ZynthWebServerNative_getUploadStateJson(
  JNIEnv *env,
  jobject,
  jlong handle
) {
  auto *server = reinterpret_cast<ZynthWebServer *>(handle);
  if (!server) {
    return env->NewStringUTF(
      "{\"activeCount\":0,\"totalStarted\":0,\"totalCompleted\":0,"
      "\"totalFailed\":0,\"totalBytesReceived\":0,\"activeUploads\":[]}"
    );
  }
  char *json = zynth_webserver_get_upload_state_json(server);
  if (!json) {
    return nullptr;
  }
  jstring result = env->NewStringUTF(json);
  zynth_webserver_free_string(json);
  return result;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_dev_zynth_webserver_ZynthWebServerNative_setReply(
  JNIEnv *env,
  jobject,
  jlong handle,
  jstring key,
  jstring payloadJson
) {
  auto *server = reinterpret_cast<ZynthWebServer *>(handle);
  if (!server || !key || !payloadJson) {
    return JNI_FALSE;
  }
  std::string keyStr = jstringToString(env, key);
  std::string payloadStr = jstringToString(env, payloadJson);
  if (keyStr.empty()) {
    return JNI_FALSE;
  }
  int ok = zynth_webserver_set_reply(server, keyStr.c_str(), payloadStr.c_str());
  return ok ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jstring JNICALL
Java_dev_zynth_webserver_ZynthWebServerNative_getReplyJson(
  JNIEnv *env,
  jobject,
  jlong handle,
  jstring key,
  jboolean consume
) {
  auto *server = reinterpret_cast<ZynthWebServer *>(handle);
  if (!server || !key) {
    return nullptr;
  }
  std::string keyStr = jstringToString(env, key);
  if (keyStr.empty()) {
    return nullptr;
  }
  char *json = zynth_webserver_get_reply_json(
    server,
    keyStr.c_str(),
    consume == JNI_TRUE ? 1 : 0
  );
  if (!json) {
    return nullptr;
  }
  jstring result = env->NewStringUTF(json);
  zynth_webserver_free_string(json);
  return result;
}
