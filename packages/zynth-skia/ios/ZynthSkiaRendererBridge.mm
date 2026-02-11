#import "ZynthSkiaRendererBridge.h"

#import <mutex>
#import <string>
#import <unordered_map>
#import <vector>

#import "include/core/SkCanvas.h"
#import "include/core/SkColor.h"
#import "include/core/SkData.h"
#import "include/core/SkImage.h"
#import "include/core/SkImageInfo.h"
#import "include/core/SkPaint.h"
#import "include/core/SkSurface.h"

namespace {

enum PackedOpcode {
  PackedOpcodeClear = 1,
  PackedOpcodeRect = 2,
  PackedOpcodeCircle = 3,
  PackedOpcodeLine = 4,
};

enum PackedColorType {
  PackedColorTypeInt = 1,
  PackedColorTypeString = 2,
};

enum PackedStyle {
  PackedStyleFill = 0,
  PackedStyleStroke = 1,
};

struct SurfaceState {
  bool frameLoopEnabled = false;
  std::vector<double> ops;
  std::vector<std::string> stringTable;
};

std::mutex gSkiaMutex;
std::unordered_map<int, SurfaceState> gSkiaSurfaces;

static uint32_t parseHexColorString(NSString *value) {
  if (value == nil) return 0x00000000;
  NSString *trim = [value stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (![trim hasPrefix:@"#"]) return 0x00000000;
  NSString *hex = [trim substringFromIndex:1];
  unsigned int parsed = 0;
  NSScanner *scanner = [NSScanner scannerWithString:hex];
  if (![scanner scanHexInt:&parsed]) return 0x00000000;
  if (hex.length == 6) {
    return 0xFF000000u | parsed;
  }
  if (hex.length == 8) {
    return parsed;
  }
  return 0x00000000;
}

static SkColor readPackedColor(const SurfaceState &state,
                               const std::vector<double> &ops,
                               size_t &index) {
  if (index >= ops.size()) return SK_ColorTRANSPARENT;
  int colorType = static_cast<int>(ops[index++]);
  if (index >= ops.size()) return SK_ColorTRANSPARENT;

  if (colorType == PackedColorTypeInt) {
    int32_t raw = static_cast<int32_t>(ops[index++]);
    return static_cast<SkColor>(raw);
  }

  if (colorType == PackedColorTypeString) {
    int stringIndex = static_cast<int>(ops[index++]);
    if (stringIndex < 0 || stringIndex >= static_cast<int>(state.stringTable.size())) {
      return SK_ColorTRANSPARENT;
    }
    NSString *colorString =
        [NSString stringWithUTF8String:state.stringTable[stringIndex].c_str()];
    return static_cast<SkColor>(parseHexColorString(colorString));
  }

  index += 1;
  return SK_ColorTRANSPARENT;
}

static bool renderSurfaceState(const SurfaceState &state,
                               int width,
                               int height,
                               SkColor clearColor,
                               std::vector<uint8_t> &outPixels,
                               size_t &outRowBytes) {
  if (width <= 0 || height <= 0) return false;

  SkImageInfo info = SkImageInfo::MakeN32Premul(width, height);
  sk_sp<SkSurface> surface = SkSurfaces::Raster(info);
  if (!surface) return false;

  SkCanvas *canvas = surface->getCanvas();
  canvas->clear(clearColor);

  size_t i = 0;
  while (i < state.ops.size()) {
    int opcode = static_cast<int>(state.ops[i++]);

    if (opcode == PackedOpcodeClear) {
      SkColor color = readPackedColor(state, state.ops, i);
      canvas->clear(color);
      continue;
    }

    if (opcode == PackedOpcodeRect) {
      if (i + 5 >= state.ops.size()) break;
      float x = static_cast<float>(state.ops[i++]);
      float y = static_cast<float>(state.ops[i++]);
      float w = static_cast<float>(state.ops[i++]);
      float h = static_cast<float>(state.ops[i++]);
      SkColor color = readPackedColor(state, state.ops, i);
      if (i + 1 >= state.ops.size()) break;
      float strokeWidth = static_cast<float>(state.ops[i++]);
      int style = static_cast<int>(state.ops[i++]);

      SkPaint paint;
      paint.setAntiAlias(true);
      paint.setColor(color);
      paint.setStrokeWidth(strokeWidth);
      paint.setStyle(style == PackedStyleStroke ? SkPaint::kStroke_Style
                                                : SkPaint::kFill_Style);
      canvas->drawRect(SkRect::MakeXYWH(x, y, w, h), paint);
      continue;
    }

    if (opcode == PackedOpcodeCircle) {
      if (i + 4 >= state.ops.size()) break;
      float cx = static_cast<float>(state.ops[i++]);
      float cy = static_cast<float>(state.ops[i++]);
      float r = static_cast<float>(state.ops[i++]);
      SkColor color = readPackedColor(state, state.ops, i);
      if (i + 1 >= state.ops.size()) break;
      float strokeWidth = static_cast<float>(state.ops[i++]);
      int style = static_cast<int>(state.ops[i++]);

      SkPaint paint;
      paint.setAntiAlias(true);
      paint.setColor(color);
      paint.setStrokeWidth(strokeWidth);
      paint.setStyle(style == PackedStyleStroke ? SkPaint::kStroke_Style
                                                : SkPaint::kFill_Style);
      canvas->drawCircle(cx, cy, r, paint);
      continue;
    }

    if (opcode == PackedOpcodeLine) {
      if (i + 5 >= state.ops.size()) break;
      float x1 = static_cast<float>(state.ops[i++]);
      float y1 = static_cast<float>(state.ops[i++]);
      float x2 = static_cast<float>(state.ops[i++]);
      float y2 = static_cast<float>(state.ops[i++]);
      SkColor color = readPackedColor(state, state.ops, i);
      if (i >= state.ops.size()) break;
      float strokeWidth = static_cast<float>(state.ops[i++]);

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

  sk_sp<SkImage> image = surface->makeImageSnapshot();
  if (!image) return false;

  outRowBytes = static_cast<size_t>(width) * 4;
  outPixels.resize(outRowBytes * static_cast<size_t>(height));
  bool ok = image->readPixels(info, outPixels.data(), outRowBytes, 0, 0);
  return ok;
}

static int addString(std::vector<std::string> &table,
                     std::unordered_map<std::string, int> &index,
                     NSString *value) {
  std::string utf8 = value ? std::string([value UTF8String]) : std::string();
  auto found = index.find(utf8);
  if (found != index.end()) return found->second;
  int next = static_cast<int>(table.size());
  table.push_back(utf8);
  index[utf8] = next;
  return next;
}

static void pushColor(std::vector<double> &ops,
                      std::vector<std::string> &table,
                      std::unordered_map<std::string, int> &index,
                      NSString *color) {
  uint32_t parsed = parseHexColorString(color ?: @"");
  if (parsed != 0x00000000 || [color hasPrefix:@"#"]) {
    ops.push_back(PackedColorTypeInt);
    ops.push_back(static_cast<double>(static_cast<int32_t>(parsed)));
    return;
  }
  int strIndex = addString(table, index, color ?: @"");
  ops.push_back(PackedColorTypeString);
  ops.push_back(strIndex);
}

static bool encodeCommands(NSArray<NSDictionary *> *commands,
                           std::vector<double> &outOps,
                           std::vector<std::string> &outStrings) {
  if (commands == nil) return false;
  std::unordered_map<std::string, int> index;

  for (NSDictionary *command in commands) {
    NSString *type = command[@"type"];
    if (![type isKindOfClass:[NSString class]]) continue;

    if ([type isEqualToString:@"clear"]) {
      outOps.push_back(PackedOpcodeClear);
      pushColor(outOps, outStrings, index, command[@"color"]);
      continue;
    }

    if ([type isEqualToString:@"rect"]) {
      outOps.push_back(PackedOpcodeRect);
      outOps.push_back([command[@"x"] doubleValue]);
      outOps.push_back([command[@"y"] doubleValue]);
      outOps.push_back([command[@"width"] doubleValue]);
      outOps.push_back([command[@"height"] doubleValue]);
      pushColor(outOps, outStrings, index, command[@"color"]);
      outOps.push_back(command[@"strokeWidth"] ? [command[@"strokeWidth"] doubleValue] : 1.0);
      NSString *style = command[@"style"];
      outOps.push_back([style isEqualToString:@"stroke"] ? PackedStyleStroke : PackedStyleFill);
      continue;
    }

    if ([type isEqualToString:@"circle"]) {
      outOps.push_back(PackedOpcodeCircle);
      outOps.push_back([command[@"cx"] doubleValue]);
      outOps.push_back([command[@"cy"] doubleValue]);
      outOps.push_back([command[@"r"] doubleValue]);
      pushColor(outOps, outStrings, index, command[@"color"]);
      outOps.push_back(command[@"strokeWidth"] ? [command[@"strokeWidth"] doubleValue] : 1.0);
      NSString *style = command[@"style"];
      outOps.push_back([style isEqualToString:@"stroke"] ? PackedStyleStroke : PackedStyleFill);
      continue;
    }

    if ([type isEqualToString:@"line"]) {
      outOps.push_back(PackedOpcodeLine);
      outOps.push_back([command[@"x1"] doubleValue]);
      outOps.push_back([command[@"y1"] doubleValue]);
      outOps.push_back([command[@"x2"] doubleValue]);
      outOps.push_back([command[@"y2"] doubleValue]);
      pushColor(outOps, outStrings, index, command[@"color"]);
      outOps.push_back(command[@"strokeWidth"] ? [command[@"strokeWidth"] doubleValue] : 1.0);
    }
  }

  return true;
}

} // namespace

@implementation ZynthSkiaRendererBridge

+ (BOOL)createSurface:(NSInteger)nodeId {
  if (nodeId <= 0) return NO;
  std::lock_guard<std::mutex> lock(gSkiaMutex);
  gSkiaSurfaces[static_cast<int>(nodeId)] = SurfaceState{};
  return YES;
}

+ (BOOL)disposeSurface:(NSInteger)nodeId {
  if (nodeId <= 0) return NO;
  std::lock_guard<std::mutex> lock(gSkiaMutex);
  gSkiaSurfaces.erase(static_cast<int>(nodeId));
  return YES;
}

+ (BOOL)setFrameLoopEnabled:(BOOL)enabled forNode:(NSInteger)nodeId {
  if (nodeId <= 0) return NO;
  std::lock_guard<std::mutex> lock(gSkiaMutex);
  auto it = gSkiaSurfaces.find(static_cast<int>(nodeId));
  if (it == gSkiaSurfaces.end()) return NO;
  it->second.frameLoopEnabled = enabled;
  return YES;
}

+ (BOOL)submitPacked:(const double *)ops
             opCount:(NSInteger)opCount
         stringTable:(NSArray<NSString *> *)stringTable
             forNode:(NSInteger)nodeId {
  if (nodeId <= 0 || ops == nullptr || opCount < 0) return NO;

  std::lock_guard<std::mutex> lock(gSkiaMutex);
  auto it = gSkiaSurfaces.find(static_cast<int>(nodeId));
  if (it == gSkiaSurfaces.end()) return NO;

  SurfaceState &state = it->second;
  state.ops.assign(ops, ops + opCount);
  state.stringTable.clear();
  state.stringTable.reserve(stringTable.count);
  for (NSString *value in stringTable) {
    if (![value isKindOfClass:[NSString class]]) {
      state.stringTable.emplace_back();
      continue;
    }
    state.stringTable.emplace_back([value UTF8String]);
  }

  return YES;
}

+ (BOOL)submitCommands:(NSArray<NSDictionary *> *)commands forNode:(NSInteger)nodeId {
  if (nodeId <= 0 || commands == nil) return NO;
  std::vector<double> ops;
  std::vector<std::string> strings;
  if (!encodeCommands(commands, ops, strings)) return NO;

  std::lock_guard<std::mutex> lock(gSkiaMutex);
  auto it = gSkiaSurfaces.find(static_cast<int>(nodeId));
  if (it == gSkiaSurfaces.end()) return NO;
  it->second.ops = std::move(ops);
  it->second.stringTable = std::move(strings);
  return YES;
}

+ (BOOL)submitFrame:(NSDictionary *)frame forNode:(NSInteger)nodeId {
  if (nodeId <= 0 || frame == nil) return NO;
  id commands = frame[@"commands"];
  if (![commands isKindOfClass:[NSArray class]]) return NO;
  return [self submitCommands:(NSArray<NSDictionary *> *)commands forNode:nodeId];
}

+ (UIImage *)renderImageForNode:(NSInteger)nodeId
                          width:(NSInteger)width
                         height:(NSInteger)height
                     clearColor:(uint32_t)clearColor {
  if (nodeId <= 0 || width <= 0 || height <= 0) return nil;

  SurfaceState state;
  {
    std::lock_guard<std::mutex> lock(gSkiaMutex);
    auto it = gSkiaSurfaces.find(static_cast<int>(nodeId));
    if (it == gSkiaSurfaces.end()) return nil;
    state = it->second;
  }

  std::vector<uint8_t> pixels;
  size_t rowBytes = 0;
  if (!renderSurfaceState(state,
                          static_cast<int>(width),
                          static_cast<int>(height),
                          static_cast<SkColor>(clearColor),
                          pixels,
                          rowBytes)) {
    return nil;
  }

  NSData *data = [NSData dataWithBytes:pixels.data() length:pixels.size()];
  CGDataProviderRef provider = CGDataProviderCreateWithCFData((CFDataRef)data);
  if (provider == nullptr) return nil;

  CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
  // Skia readPixels for N32 here is consumed as RGBA; use premultiplied-last to avoid RB swap.
  CGBitmapInfo bitmapInfo = (CGBitmapInfo)(kCGBitmapByteOrder32Big | kCGImageAlphaPremultipliedLast);
  CGImageRef imageRef = CGImageCreate(width,
                                      height,
                                      8,
                                      32,
                                      rowBytes,
                                      colorSpace,
                                      bitmapInfo,
                                      provider,
                                      nullptr,
                                      false,
                                      kCGRenderingIntentDefault);
  CGColorSpaceRelease(colorSpace);
  CGDataProviderRelease(provider);

  if (imageRef == nullptr) return nil;
  UIImage *image = [UIImage imageWithCGImage:imageRef scale:UIScreen.mainScreen.scale orientation:UIImageOrientationUp];
  CGImageRelease(imageRef);
  return image;
}

+ (BOOL)hasSurface:(NSInteger)nodeId {
  if (nodeId <= 0) return NO;
  std::lock_guard<std::mutex> lock(gSkiaMutex);
  return gSkiaSurfaces.find(static_cast<int>(nodeId)) != gSkiaSurfaces.end();
}

@end
