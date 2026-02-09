#pragma once

#include <jni.h>
#include <jsi/jsi.h>

#include <string>
#include <vector>

namespace zynth::jsiutil {

inline bool readArrayBufferBytes(
    facebook::jsi::Runtime &rt,
    const facebook::jsi::Value &value,
    uint8_t **outData,
    size_t *outSize) {
  if (!outData || !outSize || !value.isObject()) return false;
  facebook::jsi::Object object = value.asObject(rt);
  if (!object.isArrayBuffer(rt)) return false;
  facebook::jsi::ArrayBuffer buffer = object.getArrayBuffer(rt);
  *outData = buffer.data(rt);
  *outSize = buffer.size(rt);
  return true;
}

inline bool readStringTable(
    facebook::jsi::Runtime &rt,
    const facebook::jsi::Value &value,
    std::vector<std::string> *out) {
  if (!out || !value.isObject()) return false;
  facebook::jsi::Object object = value.asObject(rt);
  if (!object.isArray(rt)) return false;
  facebook::jsi::Array table = object.asArray(rt);
  const size_t length = table.length(rt);
  out->clear();
  out->reserve(length);
  for (size_t i = 0; i < length; i++) {
    facebook::jsi::Value entry = table.getValueAtIndex(rt, i);
    if (entry.isString()) {
      out->push_back(entry.asString(rt).utf8(rt));
    } else {
      out->push_back("");
    }
  }
  return true;
}

inline jobjectArray newJavaStringArray(
    JNIEnv *env,
    const std::vector<std::string> &values) {
  if (!env) return nullptr;
  jclass stringClass = env->FindClass("java/lang/String");
  if (!stringClass) return nullptr;
  jobjectArray result = env->NewObjectArray(
      static_cast<jsize>(values.size()), stringClass, nullptr);
  env->DeleteLocalRef(stringClass);
  if (!result) return nullptr;
  for (size_t i = 0; i < values.size(); i++) {
    const std::string &value = values[i];
    jstring jValue = env->NewStringUTF(value.c_str());
    env->SetObjectArrayElement(result, static_cast<jsize>(i), jValue);
    env->DeleteLocalRef(jValue);
  }
  return result;
}

inline jobject newDirectByteBuffer(
    JNIEnv *env,
    uint8_t *data,
    size_t size) {
  if (!env) return nullptr;
  return env->NewDirectByteBuffer(data, static_cast<jlong>(size));
}

} // namespace zynth::jsiutil
