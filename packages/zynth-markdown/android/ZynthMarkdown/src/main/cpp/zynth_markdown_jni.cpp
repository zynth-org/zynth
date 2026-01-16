#include <jni.h>
#include <string>

#include "zynth_markdown.h"

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

extern "C" JNIEXPORT jstring JNICALL
Java_dev_zynth_markdown_ZynthMarkdownNative_parse(
  JNIEnv *env,
  jobject,
  jstring content,
  jint options,
  jint extensions
) {
  std::string contentStr = jstringToString(env, content);
  char *result = zynth_markdown_parse(
    contentStr.c_str(),
    static_cast<uint32_t>(options),
    static_cast<uint32_t>(extensions)
  );
  if (!result) {
    return env->NewStringUTF("");
  }
  jstring output = env->NewStringUTF(result);
  zynth_markdown_free(result);
  return output;
}
