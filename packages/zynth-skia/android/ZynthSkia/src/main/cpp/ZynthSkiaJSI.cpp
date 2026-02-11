#include <jni.h>
#include <android/bitmap.h>
#include <android/log.h>
#include <dlfcn.h>
#include <jsi/jsi.h>

#include <algorithm>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#include "ZynthJSIPluginRegistry.h"

#include "include/core/SkCanvas.h"
#include "include/core/SkColor.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkPaint.h"
#include "include/core/SkRect.h"
#include "include/core/SkSurface.h"

using namespace facebook::jsi;

namespace {
constexpr const char *kTag = "ZynthSkia";
constexpr const char *kSkiaKey = "__zynth_skia";

constexpr int kOpcodeClear = 1;
constexpr int kOpcodeRect = 2;
constexpr int kOpcodeCircle = 3;
constexpr int kOpcodeLine = 4;

constexpr int kColorTypeInt = 1;
constexpr int kColorTypeString = 2;

constexpr int kStyleFill = 0;
constexpr int kStyleStroke = 1;

JavaVM *gVm = nullptr;
using RegisterInstallerFn = void (*)(ZynthJSIPluginInstaller installer);
RegisterInstallerFn gRegisterInstaller = nullptr;

jclass gSkiaBridgeClass = nullptr;
jmethodID gCreateSurface = nullptr;
jmethodID gDisposeSurface = nullptr;
jmethodID gSubmitPacked = nullptr;
jmethodID gInvalidateSurface = nullptr;
jmethodID gSetFrameLoopEnabled = nullptr;

struct SurfaceState {
  bool frameLoopEnabled = false;
  struct CommandBuffer {
    std::vector<double> ops;
    std::vector<std::string> stringTable;
  };
  std::shared_ptr<CommandBuffer> front;
  std::shared_ptr<CommandBuffer> back;
  bool hasPending = false;
};

std::mutex gSurfaceMutex;
std::unordered_map<int, SurfaceState> gSurfaces;

JNIEnv *getEnv() {
  if (!gVm) return nullptr;
  JNIEnv *env = nullptr;
  if (gVm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) != JNI_OK) {
    if (gVm->AttachCurrentThread(&env, nullptr) != JNI_OK) return nullptr;
  }
  return env;
}

bool parseHexNibble(char c, uint32_t &out) {
  if (c >= '0' && c <= '9') {
    out = static_cast<uint32_t>(c - '0');
    return true;
  }
  if (c >= 'a' && c <= 'f') {
    out = static_cast<uint32_t>(10 + (c - 'a'));
    return true;
  }
  if (c >= 'A' && c <= 'F') {
    out = static_cast<uint32_t>(10 + (c - 'A'));
    return true;
  }
  return false;
}

bool parseHexColorString(const std::string &value, uint32_t &out) {
  if (value.empty() || value[0] != '#') return false;
  const size_t len = value.size() - 1;
  if (len != 6 && len != 8) return false;

  uint32_t parsed = 0;
  for (size_t i = 1; i < value.size(); i += 1) {
    uint32_t nibble = 0;
    if (!parseHexNibble(value[i], nibble)) return false;
    parsed = (parsed << 4u) | nibble;
  }

  out = (len == 6) ? (0xFF000000u | parsed) : parsed;
  return true;
}

SkColor readPackedColor(const SurfaceState::CommandBuffer &buffer, const std::vector<double> &ops, size_t &index) {
  if (index >= ops.size()) return SK_ColorTRANSPARENT;
  const int colorType = static_cast<int>(ops[index++]);
  if (index >= ops.size()) return SK_ColorTRANSPARENT;

  if (colorType == kColorTypeInt) {
    const int32_t raw = static_cast<int32_t>(ops[index++]);
    return static_cast<SkColor>(raw);
  }

  if (colorType == kColorTypeString) {
    const int stringIndex = static_cast<int>(ops[index++]);
    if (stringIndex < 0 || stringIndex >= static_cast<int>(buffer.stringTable.size())) {
      return SK_ColorTRANSPARENT;
    }
    uint32_t parsed = 0;
    if (parseHexColorString(buffer.stringTable[static_cast<size_t>(stringIndex)], parsed)) {
      return static_cast<SkColor>(parsed);
    }
  }

  return SK_ColorTRANSPARENT;
}

bool renderSurfaceState(
    const SurfaceState::CommandBuffer &buffer,
    SkCanvas *canvas,
    float density,
    SkColor clearColor) {
  if (!canvas) return false;
  canvas->clear(clearColor);
  const float scale = density > 0.0f ? density : 1.0f;
  canvas->save();
  canvas->scale(scale, scale);

  size_t i = 0;
  while (i < buffer.ops.size()) {
    const int opcode = static_cast<int>(buffer.ops[i++]);

    if (opcode == kOpcodeClear) {
      canvas->clear(readPackedColor(buffer, buffer.ops, i));
      continue;
    }

    if (opcode == kOpcodeRect) {
      if (i + 5 >= buffer.ops.size()) break;
      const float x = static_cast<float>(buffer.ops[i++]);
      const float y = static_cast<float>(buffer.ops[i++]);
      const float w = static_cast<float>(buffer.ops[i++]);
      const float h = static_cast<float>(buffer.ops[i++]);
      const SkColor color = readPackedColor(buffer, buffer.ops, i);
      if (i + 1 >= buffer.ops.size()) break;
      const float strokeWidth = static_cast<float>(buffer.ops[i++]);
      const int style = static_cast<int>(buffer.ops[i++]);

      SkPaint paint;
      paint.setAntiAlias(true);
      paint.setColor(color);
      paint.setStrokeWidth(strokeWidth);
      paint.setStyle(style == kStyleStroke ? SkPaint::kStroke_Style : SkPaint::kFill_Style);
      canvas->drawRect(SkRect::MakeXYWH(x, y, w, h), paint);
      continue;
    }

    if (opcode == kOpcodeCircle) {
      if (i + 4 >= buffer.ops.size()) break;
      const float cx = static_cast<float>(buffer.ops[i++]);
      const float cy = static_cast<float>(buffer.ops[i++]);
      const float r = static_cast<float>(buffer.ops[i++]);
      const SkColor color = readPackedColor(buffer, buffer.ops, i);
      if (i + 1 >= buffer.ops.size()) break;
      const float strokeWidth = static_cast<float>(buffer.ops[i++]);
      const int style = static_cast<int>(buffer.ops[i++]);

      SkPaint paint;
      paint.setAntiAlias(true);
      paint.setColor(color);
      paint.setStrokeWidth(strokeWidth);
      paint.setStyle(style == kStyleStroke ? SkPaint::kStroke_Style : SkPaint::kFill_Style);
      canvas->drawCircle(cx, cy, r, paint);
      continue;
    }

    if (opcode == kOpcodeLine) {
      if (i + 5 >= buffer.ops.size()) break;
      const float x1 = static_cast<float>(buffer.ops[i++]);
      const float y1 = static_cast<float>(buffer.ops[i++]);
      const float x2 = static_cast<float>(buffer.ops[i++]);
      const float y2 = static_cast<float>(buffer.ops[i++]);
      const SkColor color = readPackedColor(buffer, buffer.ops, i);
      if (i >= buffer.ops.size()) break;
      const float strokeWidth = static_cast<float>(buffer.ops[i++]);

      SkPaint paint;
      paint.setAntiAlias(true);
      paint.setColor(color);
      paint.setStrokeWidth(strokeWidth);
      paint.setStyle(SkPaint::kStroke_Style);
      canvas->drawLine(x1, y1, x2, y2, paint);
      continue;
    }

    break;
  }

  canvas->restore();
  return true;
}

int addString(std::vector<std::string> &table, std::unordered_map<std::string, int> &index, const std::string &value) {
  const auto found = index.find(value);
  if (found != index.end()) return found->second;

  const int next = static_cast<int>(table.size());
  table.push_back(value);
  index[value] = next;
  return next;
}

void pushPackedColor(
    std::vector<double> &ops,
    std::vector<std::string> &table,
    std::unordered_map<std::string, int> &index,
    const std::string &color) {
  uint32_t parsed = 0;
  if (parseHexColorString(color, parsed)) {
    ops.push_back(static_cast<double>(kColorTypeInt));
    ops.push_back(static_cast<double>(static_cast<int32_t>(parsed)));
    return;
  }

  const int stringIndex = addString(table, index, color);
  ops.push_back(static_cast<double>(kColorTypeString));
  ops.push_back(static_cast<double>(stringIndex));
}

double readNumberProp(Runtime &rt, const Object &object, const char *name, double fallback) {
  Value v = object.getProperty(rt, name);
  return v.isNumber() ? v.asNumber() : fallback;
}

std::string readStringProp(Runtime &rt, const Object &object, const char *name, const char *fallback = "") {
  Value v = object.getProperty(rt, name);
  if (v.isString()) return v.asString(rt).utf8(rt);
  return std::string(fallback);
}

void encodeCommandsFromJS(
    Runtime &rt,
    const Array &commands,
    std::vector<double> &outOps,
    std::vector<std::string> &outStrings) {
  std::unordered_map<std::string, int> stringIndex;

  const size_t length = commands.length(rt);
  for (size_t i = 0; i < length; i += 1) {
    Value commandValue = commands.getValueAtIndex(rt, i);
    if (!commandValue.isObject()) continue;

    Object command = commandValue.asObject(rt);
    const std::string type = readStringProp(rt, command, "type");

    if (type == "clear") {
      outOps.push_back(static_cast<double>(kOpcodeClear));
      pushPackedColor(outOps, outStrings, stringIndex, readStringProp(rt, command, "color"));
      continue;
    }

    if (type == "rect") {
      outOps.push_back(static_cast<double>(kOpcodeRect));
      outOps.push_back(readNumberProp(rt, command, "x", 0));
      outOps.push_back(readNumberProp(rt, command, "y", 0));
      outOps.push_back(readNumberProp(rt, command, "width", 0));
      outOps.push_back(readNumberProp(rt, command, "height", 0));
      pushPackedColor(outOps, outStrings, stringIndex, readStringProp(rt, command, "color"));
      outOps.push_back(readNumberProp(rt, command, "strokeWidth", 1));
      const std::string style = readStringProp(rt, command, "style", "fill");
      outOps.push_back(static_cast<double>(style == "stroke" ? kStyleStroke : kStyleFill));
      continue;
    }

    if (type == "circle") {
      outOps.push_back(static_cast<double>(kOpcodeCircle));
      outOps.push_back(readNumberProp(rt, command, "cx", 0));
      outOps.push_back(readNumberProp(rt, command, "cy", 0));
      outOps.push_back(readNumberProp(rt, command, "r", 0));
      pushPackedColor(outOps, outStrings, stringIndex, readStringProp(rt, command, "color"));
      outOps.push_back(readNumberProp(rt, command, "strokeWidth", 1));
      const std::string style = readStringProp(rt, command, "style", "fill");
      outOps.push_back(static_cast<double>(style == "stroke" ? kStyleStroke : kStyleFill));
      continue;
    }

    if (type == "line") {
      outOps.push_back(static_cast<double>(kOpcodeLine));
      outOps.push_back(readNumberProp(rt, command, "x1", 0));
      outOps.push_back(readNumberProp(rt, command, "y1", 0));
      outOps.push_back(readNumberProp(rt, command, "x2", 0));
      outOps.push_back(readNumberProp(rt, command, "y2", 0));
      pushPackedColor(outOps, outStrings, stringIndex, readStringProp(rt, command, "color"));
      outOps.push_back(readNumberProp(rt, command, "strokeWidth", 1));
      continue;
    }
  }
}

void resolveCoreSymbols() {
  if (gRegisterInstaller) return;
  void *handle = dlopen("libzynthkit.so", RTLD_NOW | RTLD_GLOBAL);
  if (!handle) {
    __android_log_print(ANDROID_LOG_WARN, kTag, "dlopen(libzynthkit.so) failed: %s", dlerror());
    handle = RTLD_DEFAULT;
  }
  gRegisterInstaller = reinterpret_cast<RegisterInstallerFn>(
      dlsym(handle, "ZynthRegisterJSIPluginInstaller"));
}

bool resolveBridgeMethods(JNIEnv *env) {
  if (!env) return false;
  if (gSkiaBridgeClass && gCreateSurface && gDisposeSurface && gSubmitPacked &&
      gInvalidateSurface && gSetFrameLoopEnabled) {
    return true;
  }

  jclass bridgeClass = env->FindClass("dev/zynth/skia/SkiaBridge");
  if (!bridgeClass) {
    __android_log_print(ANDROID_LOG_WARN, kTag, "SkiaBridge class not found");
    return false;
  }

  if (!gSkiaBridgeClass) {
    gSkiaBridgeClass = static_cast<jclass>(env->NewGlobalRef(bridgeClass));
  }

  gCreateSurface = env->GetStaticMethodID(gSkiaBridgeClass, "createSurface", "(I)Z");
  gDisposeSurface = env->GetStaticMethodID(gSkiaBridgeClass, "disposeSurface", "(I)Z");
  gSubmitPacked = env->GetStaticMethodID(
      gSkiaBridgeClass,
      "submitDrawCommandsPacked",
      "(I[DI[Ljava/lang/String;)Z");
  gInvalidateSurface = env->GetStaticMethodID(gSkiaBridgeClass, "invalidateSurface", "(I)Z");
  gSetFrameLoopEnabled = env->GetStaticMethodID(gSkiaBridgeClass, "setFrameLoopEnabled", "(IZ)Z");

  env->DeleteLocalRef(bridgeClass);

  if (!gCreateSurface || !gDisposeSurface || !gSubmitPacked || !gInvalidateSurface ||
      !gSetFrameLoopEnabled) {
    __android_log_print(ANDROID_LOG_ERROR, kTag, "Failed to resolve SkiaBridge methods");
    return false;
  }

  return true;
}

bool cacheBridgeMethodsFromJavaClass(JNIEnv *env, jclass bridgeClass) {
  if (!env || !bridgeClass) return false;
  if (!gSkiaBridgeClass) {
    gSkiaBridgeClass = static_cast<jclass>(env->NewGlobalRef(bridgeClass));
  }

  if (gCreateSurface && gDisposeSurface && gSubmitPacked && gInvalidateSurface && gSetFrameLoopEnabled) {
    return true;
  }

  gCreateSurface = env->GetStaticMethodID(gSkiaBridgeClass, "createSurface", "(I)Z");
  gDisposeSurface = env->GetStaticMethodID(gSkiaBridgeClass, "disposeSurface", "(I)Z");
  gSubmitPacked = env->GetStaticMethodID(
      gSkiaBridgeClass,
      "submitDrawCommandsPacked",
      "(I[DI[Ljava/lang/String;)Z");
  gInvalidateSurface = env->GetStaticMethodID(gSkiaBridgeClass, "invalidateSurface", "(I)Z");
  gSetFrameLoopEnabled = env->GetStaticMethodID(gSkiaBridgeClass, "setFrameLoopEnabled", "(IZ)Z");
  return gCreateSurface && gDisposeSurface && gSubmitPacked && gInvalidateSurface && gSetFrameLoopEnabled;
}

bool callBoolMethod(jmethodID method, jint nodeId) {
  JNIEnv *env = getEnv();
  if (!resolveBridgeMethods(env) || !method) {
    __android_log_print(ANDROID_LOG_ERROR, kTag, "callBoolMethod resolve failed nodeId=%d", (int)nodeId);
    return false;
  }

  const jboolean result = env->CallStaticBooleanMethod(gSkiaBridgeClass, method, nodeId);
  if (env->ExceptionCheck()) {
    env->ExceptionDescribe();
    env->ExceptionClear();
    return false;
  }
  return result == JNI_TRUE;
}

bool callSetFrameLoop(jint nodeId, bool enabled) {
  JNIEnv *env = getEnv();
  if (!resolveBridgeMethods(env) || !gSetFrameLoopEnabled) {
    __android_log_print(ANDROID_LOG_ERROR, kTag, "callSetFrameLoop resolve failed nodeId=%d", (int)nodeId);
    return false;
  }

  const jboolean result = env->CallStaticBooleanMethod(
      gSkiaBridgeClass,
      gSetFrameLoopEnabled,
      nodeId,
      enabled ? JNI_TRUE : JNI_FALSE);
  if (env->ExceptionCheck()) {
    env->ExceptionDescribe();
    env->ExceptionClear();
    return false;
  }
  return result == JNI_TRUE;
}

bool callSubmitPacked(jint nodeId, const std::vector<double> &ops, const std::vector<std::string> &strings) {
  JNIEnv *env = getEnv();
  if (!resolveBridgeMethods(env) || !gSubmitPacked) {
    __android_log_print(ANDROID_LOG_ERROR, kTag, "callSubmitPacked resolve failed nodeId=%d", (int)nodeId);
    return false;
  }

  jdoubleArray jOps = env->NewDoubleArray(static_cast<jsize>(ops.size()));
  if (!jOps) {
    __android_log_print(ANDROID_LOG_ERROR, kTag, "callSubmitPacked NewDoubleArray failed nodeId=%d", (int)nodeId);
    return false;
  }
  if (!ops.empty()) {
    env->SetDoubleArrayRegion(
        jOps,
        0,
        static_cast<jsize>(ops.size()),
        reinterpret_cast<const jdouble *>(ops.data()));
  }

  jclass stringClass = env->FindClass("java/lang/String");
  jobjectArray jStrings = env->NewObjectArray(static_cast<jsize>(strings.size()), stringClass, nullptr);
  env->DeleteLocalRef(stringClass);
  if (!jStrings) {
    __android_log_print(ANDROID_LOG_ERROR, kTag, "callSubmitPacked NewObjectArray failed nodeId=%d", (int)nodeId);
    env->DeleteLocalRef(jOps);
    return false;
  }

  for (size_t i = 0; i < strings.size(); i += 1) {
    const std::string &entry = strings[i];
    jstring jEntry = env->NewStringUTF(entry.c_str());
    env->SetObjectArrayElement(jStrings, static_cast<jsize>(i), jEntry);
    env->DeleteLocalRef(jEntry);
  }

  const jboolean result = env->CallStaticBooleanMethod(
      gSkiaBridgeClass,
      gSubmitPacked,
      nodeId,
      jOps,
      static_cast<jint>(ops.size()),
      jStrings);

  env->DeleteLocalRef(jOps);
  env->DeleteLocalRef(jStrings);

  if (env->ExceptionCheck()) {
    env->ExceptionDescribe();
    env->ExceptionClear();
    __android_log_print(ANDROID_LOG_ERROR, kTag, "callSubmitPacked Java exception nodeId=%d", (int)nodeId);
    return false;
  }

  return result == JNI_TRUE;
}

void installBridge(Runtime &rt) {
  auto createSurface = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "createSurface"),
      1,
      [](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value(false);
        return Value(callBoolMethod(gCreateSurface, static_cast<jint>(args[0].asNumber())));
      });

  auto disposeSurface = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "disposeSurface"),
      1,
      [](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value(false);
        return Value(callBoolMethod(gDisposeSurface, static_cast<jint>(args[0].asNumber())));
      });

  auto submitPacked = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "submitDrawCommandsPacked"),
      4,
      [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 4 || !args[0].isNumber() || !args[1].isObject() ||
            !args[2].isNumber() || !args[3].isObject()) {
          return Value(false);
        }

        Object opsObject = args[1].asObject(rt);
        Object stringsObject = args[3].asObject(rt);
        if (!opsObject.isArrayBuffer(rt) || !stringsObject.isArray(rt)) {
          return Value(false);
        }

        ArrayBuffer buffer = opsObject.getArrayBuffer(rt);
        const size_t availableCount = buffer.size(rt) / sizeof(double);
        const size_t requestedCount = static_cast<size_t>(std::max(0.0, args[2].asNumber()));
        const size_t opCount = std::min(availableCount, requestedCount);

        const auto *data = reinterpret_cast<const double *>(buffer.data(rt));
        std::vector<double> ops(data, data + opCount);

        Array stringsArray = stringsObject.asArray(rt);
        const size_t stringCount = stringsArray.length(rt);
        std::vector<std::string> strings;
        strings.reserve(stringCount);
        for (size_t i = 0; i < stringCount; i += 1) {
          Value entry = stringsArray.getValueAtIndex(rt, i);
          if (entry.isString()) {
            strings.push_back(entry.asString(rt).utf8(rt));
          } else {
            strings.emplace_back();
          }
        }

        return Value(callSubmitPacked(static_cast<jint>(args[0].asNumber()), ops, strings));
      });

  auto submitDrawCommands = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "submitDrawCommands"),
      2,
      [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isObject()) {
          return Value(false);
        }

        Object commandsObject = args[1].asObject(rt);
        if (!commandsObject.isArray(rt)) return Value(false);

        std::vector<double> ops;
        std::vector<std::string> strings;
        encodeCommandsFromJS(rt, commandsObject.asArray(rt), ops, strings);
        return Value(callSubmitPacked(static_cast<jint>(args[0].asNumber()), ops, strings));
      });

  auto invalidateSurface = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "invalidateSurface"),
      1,
      [](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value(false);
        return Value(callBoolMethod(gInvalidateSurface, static_cast<jint>(args[0].asNumber())));
      });

  auto setFrameLoopEnabled = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "setFrameLoopEnabled"),
      2,
      [](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isBool()) return Value(false);
        return Value(callSetFrameLoop(static_cast<jint>(args[0].asNumber()), args[1].getBool()));
      });

  auto submitFrame = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "submitFrame"),
      2,
      [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isObject()) {
          return Value(false);
        }

        Object frameObject = args[1].asObject(rt);
        Value commandsValue = frameObject.getProperty(rt, "commands");
        if (!commandsValue.isObject()) return Value(false);

        Object commandsObject = commandsValue.asObject(rt);
        if (!commandsObject.isArray(rt)) return Value(false);

        std::vector<double> ops;
        std::vector<std::string> strings;
        encodeCommandsFromJS(rt, commandsObject.asArray(rt), ops, strings);
        return Value(callSubmitPacked(static_cast<jint>(args[0].asNumber()), ops, strings));
      });

  Object skia(rt);
  skia.setProperty(rt, "createSurface", createSurface);
  skia.setProperty(rt, "disposeSurface", disposeSurface);
  skia.setProperty(rt, "submitDrawCommandsPacked", submitPacked);
  skia.setProperty(rt, "submitDrawCommands", submitDrawCommands);
  skia.setProperty(rt, "invalidateSurface", invalidateSurface);
  skia.setProperty(rt, "setFrameLoopEnabled", setFrameLoopEnabled);
  skia.setProperty(rt, "submitFrame", submitFrame);
  rt.global().setProperty(rt, kSkiaKey, skia);
}

void registerInstaller() {
  resolveCoreSymbols();
  if (!gRegisterInstaller) {
    __android_log_print(ANDROID_LOG_WARN, kTag, "JSI plugin registry not available");
    return;
  }

  gRegisterInstaller([](Runtime &rt, void *state) {
    (void)state;
    installBridge(rt);
  });
}

bool prepareBitmapForSkia(
    JNIEnv *env,
    jobject bitmap,
    int width,
    int height,
    AndroidBitmapInfo &outInfo,
    void *&outPixels) {
  if (!env || !bitmap) {
    __android_log_print(ANDROID_LOG_ERROR, kTag, "prepareBitmapForSkia invalid env/bitmap");
    return false;
  }

  if (AndroidBitmap_getInfo(env, bitmap, &outInfo) != ANDROID_BITMAP_RESULT_SUCCESS) {
    __android_log_print(ANDROID_LOG_ERROR, kTag, "prepareBitmapForSkia AndroidBitmap_getInfo failed");
    return false;
  }

  if (outInfo.format != ANDROID_BITMAP_FORMAT_RGBA_8888) {
    __android_log_print(ANDROID_LOG_ERROR, kTag, "prepareBitmapForSkia unsupported format=%d", outInfo.format);
    return false;
  }

  if (outInfo.width != static_cast<uint32_t>(width) || outInfo.height != static_cast<uint32_t>(height)) {
    __android_log_print(
        ANDROID_LOG_ERROR,
        kTag,
        "prepareBitmapForSkia size mismatch bitmap=%ux%u expected=%dx%d",
        outInfo.width,
        outInfo.height,
        width,
        height);
    return false;
  }

  if (AndroidBitmap_lockPixels(env, bitmap, &outPixels) != ANDROID_BITMAP_RESULT_SUCCESS) {
    __android_log_print(ANDROID_LOG_ERROR, kTag, "prepareBitmapForSkia lockPixels failed");
    return false;
  }
  return true;
}

} // namespace

extern "C" JNIEXPORT jboolean JNICALL
Java_dev_zynth_skia_SkiaBridge_nativeCreateSurface(JNIEnv *env, jclass clazz, jint nodeId) {
  cacheBridgeMethodsFromJavaClass(env, clazz);
  if (nodeId <= 0) {
    __android_log_print(ANDROID_LOG_WARN, kTag, "nativeCreateSurface invalid nodeId=%d", (int)nodeId);
    return JNI_FALSE;
  }

  std::lock_guard<std::mutex> lock(gSurfaceMutex);
  SurfaceState state;
  state.front = std::make_shared<SurfaceState::CommandBuffer>();
  gSurfaces[static_cast<int>(nodeId)] = std::move(state);
  return JNI_TRUE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_dev_zynth_skia_SkiaBridge_nativeDisposeSurface(JNIEnv *env, jclass clazz, jint nodeId) {
  cacheBridgeMethodsFromJavaClass(env, clazz);
  if (nodeId <= 0) {
    __android_log_print(ANDROID_LOG_WARN, kTag, "nativeDisposeSurface invalid nodeId=%d", (int)nodeId);
    return JNI_FALSE;
  }

  std::lock_guard<std::mutex> lock(gSurfaceMutex);
  auto it = gSurfaces.find(static_cast<int>(nodeId));
  if (it != gSurfaces.end()) {
    gSurfaces.erase(it);
  }
  return JNI_TRUE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_dev_zynth_skia_SkiaBridge_nativeSubmitDrawCommandsPacked(
    JNIEnv *env,
    jclass clazz,
    jint nodeId,
    jdoubleArray ops,
    jint opCount,
    jobjectArray stringTable) {
  cacheBridgeMethodsFromJavaClass(env, clazz);
  if (!env || nodeId <= 0 || !ops || opCount < 0 || !stringTable) {
    __android_log_print(
        ANDROID_LOG_ERROR,
        kTag,
        "nativeSubmitDrawCommandsPacked invalid args nodeId=%d opCount=%d",
        (int)nodeId,
        (int)opCount);
    return JNI_FALSE;
  }

  jsize totalOps = env->GetArrayLength(ops);
  jsize boundedCount = std::min(totalOps, static_cast<jsize>(opCount));
  if (boundedCount < 0) return JNI_FALSE;

  std::vector<double> opsVec(static_cast<size_t>(boundedCount));
  if (boundedCount > 0) {
    env->GetDoubleArrayRegion(ops, 0, boundedCount, reinterpret_cast<jdouble *>(opsVec.data()));
    if (env->ExceptionCheck()) {
      env->ExceptionDescribe();
      env->ExceptionClear();
      return JNI_FALSE;
    }
  }

  const jsize stringCount = env->GetArrayLength(stringTable);
  std::vector<std::string> strings;
  strings.reserve(static_cast<size_t>(stringCount));
  for (jsize i = 0; i < stringCount; i += 1) {
    auto *entry = static_cast<jstring>(env->GetObjectArrayElement(stringTable, i));
    if (!entry) {
      strings.emplace_back();
      continue;
    }

    const char *chars = env->GetStringUTFChars(entry, nullptr);
    strings.emplace_back(chars ? chars : "");
    if (chars) {
      env->ReleaseStringUTFChars(entry, chars);
    }
    env->DeleteLocalRef(entry);
  }

  {
    std::lock_guard<std::mutex> lock(gSurfaceMutex);
    auto it = gSurfaces.find(static_cast<int>(nodeId));
    if (it == gSurfaces.end()) {
      __android_log_print(ANDROID_LOG_WARN, kTag, "nativeSubmitDrawCommandsPacked surface missing nodeId=%d", (int)nodeId);
      return JNI_FALSE;
    }
    auto buffer = std::make_shared<SurfaceState::CommandBuffer>();
    buffer->ops = std::move(opsVec);
    buffer->stringTable = std::move(strings);
    it->second.back = std::move(buffer);
    it->second.hasPending = true;
  }

  return JNI_TRUE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_dev_zynth_skia_SkiaBridge_nativeInvalidateSurface(JNIEnv *env, jclass clazz, jint nodeId) {
  cacheBridgeMethodsFromJavaClass(env, clazz);
  if (nodeId <= 0) {
    __android_log_print(ANDROID_LOG_WARN, kTag, "nativeInvalidateSurface invalid nodeId=%d", (int)nodeId);
    return JNI_FALSE;
  }

  std::lock_guard<std::mutex> lock(gSurfaceMutex);
  return gSurfaces.find(static_cast<int>(nodeId)) != gSurfaces.end() ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_dev_zynth_skia_SkiaBridge_nativeSetFrameLoopEnabled(JNIEnv *env, jclass clazz, jint nodeId, jboolean enabled) {
  cacheBridgeMethodsFromJavaClass(env, clazz);
  if (nodeId <= 0) {
    __android_log_print(ANDROID_LOG_WARN, kTag, "nativeSetFrameLoopEnabled invalid nodeId=%d", (int)nodeId);
    return JNI_FALSE;
  }

  std::lock_guard<std::mutex> lock(gSurfaceMutex);
  auto it = gSurfaces.find(static_cast<int>(nodeId));
  if (it == gSurfaces.end()) {
    __android_log_print(ANDROID_LOG_WARN, kTag, "nativeSetFrameLoopEnabled surface missing nodeId=%d", (int)nodeId);
    return JNI_FALSE;
  }

  it->second.frameLoopEnabled = enabled == JNI_TRUE;
  return JNI_TRUE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_dev_zynth_skia_SkiaBridge_nativeRenderToBitmap(
    JNIEnv *env,
    jclass clazz,
    jint nodeId,
    jint width,
    jint height,
    jint clearColor,
    jfloat density,
    jobject bitmap) {
  cacheBridgeMethodsFromJavaClass(env, clazz);
  if (!env || nodeId <= 0 || width <= 0 || height <= 0 || !bitmap) {
    __android_log_print(
        ANDROID_LOG_ERROR,
        kTag,
        "nativeRenderToBitmap invalid args nodeId=%d size=%dx%d bitmap=%p",
        (int)nodeId,
        (int)width,
        (int)height,
        bitmap);
    return JNI_FALSE;
  }

  std::shared_ptr<SurfaceState::CommandBuffer> commandBuffer;
  {
    std::lock_guard<std::mutex> lock(gSurfaceMutex);
    auto it = gSurfaces.find(static_cast<int>(nodeId));
    if (it == gSurfaces.end()) {
      __android_log_print(ANDROID_LOG_WARN, kTag, "nativeRenderToBitmap surface missing nodeId=%d", (int)nodeId);
      return JNI_FALSE;
    }
    if (it->second.hasPending && it->second.back) {
      it->second.front.swap(it->second.back);
      it->second.back.reset();
      it->second.hasPending = false;
    }
    commandBuffer = it->second.front;
  }
  if (!commandBuffer) return JNI_FALSE;

  AndroidBitmapInfo bitmapInfo;
  void *bitmapPixels = nullptr;
  if (!prepareBitmapForSkia(env, bitmap, static_cast<int>(width), static_cast<int>(height), bitmapInfo, bitmapPixels)) {
    return JNI_FALSE;
  }

  const SkImageInfo info = SkImageInfo::Make(
      static_cast<int>(width),
      static_cast<int>(height),
      kRGBA_8888_SkColorType,
      kPremul_SkAlphaType);
  sk_sp<SkSurface> surface = SkSurfaces::WrapPixels(info, bitmapPixels, static_cast<size_t>(bitmapInfo.stride));
  if (!surface) {
    AndroidBitmap_unlockPixels(env, bitmap);
    __android_log_print(
        ANDROID_LOG_ERROR,
        kTag,
        "nativeRenderToBitmap WrapPixels failed nodeId=%d size=%dx%d",
        (int)nodeId,
        (int)width,
        (int)height);
    return JNI_FALSE;
  }

  const bool rendered = renderSurfaceState(
      *commandBuffer,
      surface->getCanvas(),
      static_cast<float>(density),
      static_cast<SkColor>(static_cast<uint32_t>(clearColor)));
  if (!rendered) {
    AndroidBitmap_unlockPixels(env, bitmap);
    __android_log_print(
        ANDROID_LOG_ERROR,
        kTag,
        "nativeRenderToBitmap renderSurfaceState failed nodeId=%d size=%dx%d ops=%d strings=%d",
        (int)nodeId,
        (int)width,
        (int)height,
        (int)commandBuffer->ops.size(),
        (int)commandBuffer->stringTable.size());
    return JNI_FALSE;
  }
  if (AndroidBitmap_unlockPixels(env, bitmap) != ANDROID_BITMAP_RESULT_SUCCESS) {
    __android_log_print(ANDROID_LOG_ERROR, kTag, "nativeRenderToBitmap unlockPixels failed nodeId=%d", (int)nodeId);
    return JNI_FALSE;
  }
  return JNI_TRUE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_dev_zynth_skia_SkiaBridge_nativeHasSurface(JNIEnv *env, jclass clazz, jint nodeId) {
  cacheBridgeMethodsFromJavaClass(env, clazz);
  if (nodeId <= 0) {
    __android_log_print(ANDROID_LOG_WARN, kTag, "nativeHasSurface invalid nodeId=%d", (int)nodeId);
    return JNI_FALSE;
  }

  std::lock_guard<std::mutex> lock(gSurfaceMutex);
  return gSurfaces.find(static_cast<int>(nodeId)) != gSurfaces.end() ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *) {
  gVm = vm;
  JNIEnv *env = nullptr;
  if (vm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) == JNI_OK && env != nullptr) {
    resolveBridgeMethods(env);
  }
  registerInstaller();
  return JNI_VERSION_1_6;
}

extern "C" JNIEXPORT void JNICALL JNI_OnUnload(JavaVM *, void *) {
  JNIEnv *env = getEnv();
  if (env && gSkiaBridgeClass) {
    env->DeleteGlobalRef(gSkiaBridgeClass);
  }
  gSkiaBridgeClass = nullptr;
  gCreateSurface = nullptr;
  gDisposeSurface = nullptr;
  gSubmitPacked = nullptr;
  gInvalidateSurface = nullptr;
  gSetFrameLoopEnabled = nullptr;

  std::lock_guard<std::mutex> lock(gSurfaceMutex);
  gSurfaces.clear();
}
