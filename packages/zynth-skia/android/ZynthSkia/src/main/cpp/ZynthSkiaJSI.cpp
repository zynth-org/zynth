#include <jni.h>
#include <android/bitmap.h>
#include <android/log.h>
#include <dlfcn.h>
#include <jsi/jsi.h>
#include <cstddef>
#include <cstdint>
#include <new>
#include <vector>

#include "ZynthJSIPluginRegistry.h"
#include "ZynthJsiTypedPayload.h"

#ifndef ZYNTH_SKIA_VENDOR_AVAILABLE
#define ZYNTH_SKIA_VENDOR_AVAILABLE 0
#endif

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

#if ZYNTH_SKIA_VENDOR_AVAILABLE
struct SkSurface;
struct SkCanvas;
struct SkSurfaceProps;
struct SkColorSpace;
struct SkRefCntBase;

struct alignas(8) SkImageInfo {
  std::uint8_t storage[24];
};

struct alignas(8) SkPaint {
  std::uint8_t storage[80];
};

struct SkRect {
  float fLeft;
  float fTop;
  float fRight;
  float fBottom;
};

enum class SkPaintStyle : std::uint8_t {
  Fill = 0,
  Stroke = 1,
};

extern "C" {
void C_SkImageInfo_MakeN32Premul(
    std::int32_t width,
    std::int32_t height,
    SkColorSpace *colorSpace,
    SkImageInfo *uninitialized);
SkSurface *C_SkSurfaces_WrapPixels(
    const SkImageInfo *imageInfo,
    void *pixels,
    std::size_t rowBytes,
    const SkSurfaceProps *surfaceProps);
void C_SkRefCntBase_unref(const SkRefCntBase *self_);
}

extern "C" SkCanvas *SkSurface_getCanvas(
    SkSurface *self_) __asm("_ZN9SkSurface9getCanvasEv");
extern "C" void SkPaint_SkPaint(
    SkPaint *self_) __asm("_ZN7SkPaintC1Ev");
extern "C" void SkPaint_SkPaint_destructor(
    SkPaint *self_) __asm("_ZN7SkPaintD1Ev");
extern "C" void SkPaint_setStyle(
    SkPaint *self_,
    SkPaintStyle style) __asm("_ZN7SkPaint8setStyleENS_5StyleE");
extern "C" void SkPaint_setColor(
    SkPaint *self_,
    std::uint32_t color) __asm("_ZN7SkPaint8setColorEj");
extern "C" void SkPaint_setStrokeWidth(
    SkPaint *self_,
    float width) __asm("_ZN7SkPaint14setStrokeWidthEf");

extern "C" void SkCanvas_drawLine(
    SkCanvas *self_,
    float x0,
    float y0,
    float x1,
    float y1,
    const SkPaint *paint) __asm("_ZN8SkCanvas8drawLineEffffRK7SkPaint");
extern "C" void SkCanvas_drawRect(
    SkCanvas *self_,
    const SkRect *rect,
    const SkPaint *paint) __asm("_ZN8SkCanvas8drawRectERK6SkRectRK7SkPaint");
extern "C" void SkCanvas_drawCircle(
    SkCanvas *self_,
    float cx,
    float cy,
    float radius,
    const SkPaint *paint) __asm("_ZN8SkCanvas10drawCircleEfffRK7SkPaint");

struct SkiaRasterFrame {
  jobject bitmapGlobal;
  void *pixels;
  SkSurface *surface;
  SkCanvas *canvas;
  SkPaint paint;
  bool paintInitialized;
  std::int32_t width;
  std::int32_t height;
};

inline void applyRasterPaint(
    SkiaRasterFrame *frame,
    std::uint32_t color,
    bool stroke,
    float strokeWidth) {
  if (!frame) return;
  SkPaint_setColor(&frame->paint, color);
  SkPaint_setStyle(&frame->paint, stroke ? SkPaintStyle::Stroke : SkPaintStyle::Fill);
  SkPaint_setStrokeWidth(&frame->paint, strokeWidth > 0.0f ? strokeWidth : 1.0f);
}

inline void drawRasterClear(SkiaRasterFrame *frame, std::uint32_t color) {
  if (!frame || !frame->canvas) return;
  applyRasterPaint(frame, color, false, 1.0f);
  const SkRect bounds = {
      0.0f,
      0.0f,
      static_cast<float>(frame->width),
      static_cast<float>(frame->height),
  };
  SkCanvas_drawRect(frame->canvas, &bounds, &frame->paint);
}

void destroyRasterFrame(JNIEnv *env, SkiaRasterFrame *frame) {
  if (!frame) return;
  if (frame->paintInitialized) {
    SkPaint_SkPaint_destructor(&frame->paint);
  }
  if (frame->surface) {
    C_SkRefCntBase_unref(reinterpret_cast<const SkRefCntBase *>(frame->surface));
  }
  if (env && frame->bitmapGlobal) {
    AndroidBitmap_unlockPixels(env, frame->bitmapGlobal);
    env->DeleteGlobalRef(frame->bitmapGlobal);
  }
  delete frame;
}
#endif

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

extern "C" JNIEXPORT jlong JNICALL
Java_dev_zynth_skia_ZynthSkiaJSI_rasterBegin(
    JNIEnv *env,
    jclass,
    jobject bitmap,
    jint width,
    jint height) {
#if ZYNTH_SKIA_VENDOR_AVAILABLE
  if (!env || !bitmap || width <= 0 || height <= 0) return 0;

  AndroidBitmapInfo bitmapInfo{};
  if (AndroidBitmap_getInfo(env, bitmap, &bitmapInfo) != ANDROID_BITMAP_RESULT_SUCCESS) {
    return 0;
  }
  if (bitmapInfo.format != ANDROID_BITMAP_FORMAT_RGBA_8888) return 0;
  if (bitmapInfo.width != static_cast<std::uint32_t>(width) ||
      bitmapInfo.height != static_cast<std::uint32_t>(height)) {
    return 0;
  }

  void *pixels = nullptr;
  if (AndroidBitmap_lockPixels(env, bitmap, &pixels) != ANDROID_BITMAP_RESULT_SUCCESS ||
      pixels == nullptr) {
    return 0;
  }

  auto *frame = new (std::nothrow) SkiaRasterFrame();
  if (!frame) {
    AndroidBitmap_unlockPixels(env, bitmap);
    return 0;
  }
  frame->bitmapGlobal = env->NewGlobalRef(bitmap);
  frame->pixels = pixels;
  frame->surface = nullptr;
  frame->canvas = nullptr;
  frame->paintInitialized = false;
  frame->width = width;
  frame->height = height;

  if (!frame->bitmapGlobal) {
    AndroidBitmap_unlockPixels(env, bitmap);
    delete frame;
    return 0;
  }

  SkImageInfo imageInfo{};
  C_SkImageInfo_MakeN32Premul(width, height, nullptr, &imageInfo);
  frame->surface =
      C_SkSurfaces_WrapPixels(&imageInfo, pixels, bitmapInfo.stride, nullptr);
  if (!frame->surface) {
    destroyRasterFrame(env, frame);
    return 0;
  }

  frame->canvas = SkSurface_getCanvas(frame->surface);
  if (!frame->canvas) {
    destroyRasterFrame(env, frame);
    return 0;
  }

  SkPaint_SkPaint(&frame->paint);
  frame->paintInitialized = true;
  return reinterpret_cast<jlong>(frame);
#else
  (void)env;
  (void)bitmap;
  (void)width;
  (void)height;
  return 0;
#endif
}

extern "C" JNIEXPORT void JNICALL
Java_dev_zynth_skia_ZynthSkiaJSI_rasterEnd(
    JNIEnv *env,
    jclass,
    jlong handle) {
#if ZYNTH_SKIA_VENDOR_AVAILABLE
  auto *frame = reinterpret_cast<SkiaRasterFrame *>(handle);
  destroyRasterFrame(env, frame);
#else
  (void)env;
  (void)handle;
#endif
}

extern "C" JNIEXPORT void JNICALL
Java_dev_zynth_skia_ZynthSkiaJSI_rasterClear(
    JNIEnv *,
    jclass,
    jlong handle,
    jint color) {
#if ZYNTH_SKIA_VENDOR_AVAILABLE
  auto *frame = reinterpret_cast<SkiaRasterFrame *>(handle);
  drawRasterClear(frame, static_cast<std::uint32_t>(color));
#else
  (void)handle;
  (void)color;
#endif
}

extern "C" JNIEXPORT void JNICALL
Java_dev_zynth_skia_ZynthSkiaJSI_rasterDrawRect(
    JNIEnv *,
    jclass,
    jlong handle,
    jfloat x,
    jfloat y,
    jfloat width,
    jfloat height,
    jint color,
    jboolean stroke,
    jfloat strokeWidth) {
#if ZYNTH_SKIA_VENDOR_AVAILABLE
  auto *frame = reinterpret_cast<SkiaRasterFrame *>(handle);
  if (!frame || !frame->canvas) return;
  applyRasterPaint(
      frame,
      static_cast<std::uint32_t>(color),
      stroke == JNI_TRUE,
      strokeWidth);
  const SkRect rect = {x, y, x + width, y + height};
  SkCanvas_drawRect(frame->canvas, &rect, &frame->paint);
#else
  (void)handle;
  (void)x;
  (void)y;
  (void)width;
  (void)height;
  (void)color;
  (void)stroke;
  (void)strokeWidth;
#endif
}

extern "C" JNIEXPORT void JNICALL
Java_dev_zynth_skia_ZynthSkiaJSI_rasterDrawCircle(
    JNIEnv *,
    jclass,
    jlong handle,
    jfloat cx,
    jfloat cy,
    jfloat radius,
    jint color,
    jboolean stroke,
    jfloat strokeWidth) {
#if ZYNTH_SKIA_VENDOR_AVAILABLE
  auto *frame = reinterpret_cast<SkiaRasterFrame *>(handle);
  if (!frame || !frame->canvas) return;
  applyRasterPaint(
      frame,
      static_cast<std::uint32_t>(color),
      stroke == JNI_TRUE,
      strokeWidth);
  SkCanvas_drawCircle(frame->canvas, cx, cy, radius, &frame->paint);
#else
  (void)handle;
  (void)cx;
  (void)cy;
  (void)radius;
  (void)color;
  (void)stroke;
  (void)strokeWidth;
#endif
}

extern "C" JNIEXPORT void JNICALL
Java_dev_zynth_skia_ZynthSkiaJSI_rasterDrawLine(
    JNIEnv *,
    jclass,
    jlong handle,
    jfloat x1,
    jfloat y1,
    jfloat x2,
    jfloat y2,
    jint color,
    jfloat strokeWidth) {
#if ZYNTH_SKIA_VENDOR_AVAILABLE
  auto *frame = reinterpret_cast<SkiaRasterFrame *>(handle);
  if (!frame || !frame->canvas) return;
  applyRasterPaint(frame, static_cast<std::uint32_t>(color), true, strokeWidth);
  SkCanvas_drawLine(frame->canvas, x1, y1, x2, y2, &frame->paint);
#else
  (void)handle;
  (void)x1;
  (void)y1;
  (void)x2;
  (void)y2;
  (void)color;
  (void)strokeWidth;
#endif
}
