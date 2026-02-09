#import <cstddef>
#import <cstdint>
#import <new>

namespace {

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
    SkSurface *self_) __asm("__ZN9SkSurface9getCanvasEv");

extern "C" void SkPaint_SkPaint(
    SkPaint *self_) __asm("__ZN7SkPaintC1Ev");
extern "C" void SkPaint_SkPaint_destructor(
    SkPaint *self_) __asm("__ZN7SkPaintD1Ev");
extern "C" void SkPaint_setStyle(
    SkPaint *self_,
    SkPaintStyle style) __asm("__ZN7SkPaint8setStyleENS_5StyleE");
extern "C" void SkPaint_setColor(
    SkPaint *self_,
    std::uint32_t color) __asm("__ZN7SkPaint8setColorEj");
extern "C" void SkPaint_setStrokeWidth(
    SkPaint *self_,
    float width) __asm("__ZN7SkPaint14setStrokeWidthEf");

extern "C" void SkCanvas_drawLine(
    SkCanvas *self_,
    float x0,
    float y0,
    float x1,
    float y1,
    const SkPaint *paint) __asm("__ZN8SkCanvas8drawLineEffffRK7SkPaint");
extern "C" void SkCanvas_drawRect(
    SkCanvas *self_,
    const SkRect *rect,
    const SkPaint *paint) __asm("__ZN8SkCanvas8drawRectERK6SkRectRK7SkPaint");
extern "C" void SkCanvas_drawCircle(
    SkCanvas *self_,
    float cx,
    float cy,
    float radius,
    const SkPaint *paint) __asm("__ZN8SkCanvas10drawCircleEfffRK7SkPaint");

struct ZynthSkiaRasterFrame {
  SkSurface *surface;
  SkCanvas *canvas;
  SkPaint paint;
  std::int32_t width;
  std::int32_t height;
};

inline void applyPaint(
    ZynthSkiaRasterFrame *frame,
    std::uint32_t argb,
    bool stroke,
    float strokeWidth) {
  if (!frame) return;
  SkPaint_setColor(&frame->paint, argb);
  SkPaint_setStyle(&frame->paint, stroke ? SkPaintStyle::Stroke : SkPaintStyle::Fill);
  SkPaint_setStrokeWidth(&frame->paint, strokeWidth > 0.0f ? strokeWidth : 1.0f);
}

inline void drawClearRect(ZynthSkiaRasterFrame *frame, std::uint32_t argb) {
  if (!frame || !frame->canvas) return;
  applyPaint(frame, argb, false, 1.0f);
  const SkRect bounds = {
      0.0f,
      0.0f,
      static_cast<float>(frame->width),
      static_cast<float>(frame->height),
  };
  SkCanvas_drawRect(frame->canvas, &bounds, &frame->paint);
}

}  // namespace

extern "C" void *ZynthSkiaRasterCreateFrame(
    std::int32_t width,
    std::int32_t height,
    void *pixels,
    std::size_t rowBytes) {
  if (width <= 0 || height <= 0 || pixels == nullptr) return nullptr;

  auto *frame = new (std::nothrow) ZynthSkiaRasterFrame();
  if (!frame) return nullptr;
  frame->surface = nullptr;
  frame->canvas = nullptr;
  frame->width = width;
  frame->height = height;

  SkImageInfo info{};
  C_SkImageInfo_MakeN32Premul(width, height, nullptr, &info);
  frame->surface = C_SkSurfaces_WrapPixels(&info, pixels, rowBytes, nullptr);
  if (!frame->surface) {
    delete frame;
    return nullptr;
  }

  frame->canvas = SkSurface_getCanvas(frame->surface);
  if (!frame->canvas) {
    C_SkRefCntBase_unref(reinterpret_cast<const SkRefCntBase *>(frame->surface));
    delete frame;
    return nullptr;
  }

  SkPaint_SkPaint(&frame->paint);
  return frame;
}

extern "C" void ZynthSkiaRasterDestroyFrame(void *rawFrame) {
  auto *frame = reinterpret_cast<ZynthSkiaRasterFrame *>(rawFrame);
  if (!frame) return;
  SkPaint_SkPaint_destructor(&frame->paint);
  if (frame->surface) {
    C_SkRefCntBase_unref(reinterpret_cast<const SkRefCntBase *>(frame->surface));
  }
  delete frame;
}

extern "C" void ZynthSkiaRasterClear(
    void *rawFrame,
    std::uint32_t argb) {
  auto *frame = reinterpret_cast<ZynthSkiaRasterFrame *>(rawFrame);
  drawClearRect(frame, argb);
}

extern "C" void ZynthSkiaRasterDrawRect(
    void *rawFrame,
    float x,
    float y,
    float width,
    float height,
    std::uint32_t argb,
    bool stroke,
    float strokeWidth) {
  auto *frame = reinterpret_cast<ZynthSkiaRasterFrame *>(rawFrame);
  if (!frame || !frame->canvas) return;
  applyPaint(frame, argb, stroke, strokeWidth);
  const SkRect rect = {
      x,
      y,
      x + width,
      y + height,
  };
  SkCanvas_drawRect(frame->canvas, &rect, &frame->paint);
}

extern "C" void ZynthSkiaRasterDrawCircle(
    void *rawFrame,
    float cx,
    float cy,
    float radius,
    std::uint32_t argb,
    bool stroke,
    float strokeWidth) {
  auto *frame = reinterpret_cast<ZynthSkiaRasterFrame *>(rawFrame);
  if (!frame || !frame->canvas) return;
  applyPaint(frame, argb, stroke, strokeWidth);
  SkCanvas_drawCircle(frame->canvas, cx, cy, radius, &frame->paint);
}

extern "C" void ZynthSkiaRasterDrawLine(
    void *rawFrame,
    float x1,
    float y1,
    float x2,
    float y2,
    std::uint32_t argb,
    float strokeWidth) {
  auto *frame = reinterpret_cast<ZynthSkiaRasterFrame *>(rawFrame);
  if (!frame || !frame->canvas) return;
  applyPaint(frame, argb, true, strokeWidth);
  SkCanvas_drawLine(frame->canvas, x1, y1, x2, y2, &frame->paint);
}
