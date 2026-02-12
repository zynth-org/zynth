#import "ZynthSkiaRendererBridge.h"
#import "ZynthJSIPluginRegistry.h"

#import <mutex>
#import <memory>
#import <string>
#import <unordered_map>
#import <vector>
#import <algorithm>
#import <cstring>
#include <cmath>

#import "include/core/SkCanvas.h"
#import "include/core/SkColor.h"
#import "include/core/SkData.h"
#import "include/core/SkFont.h"
#import "include/core/SkFontMgr.h"
#import "include/core/SkImage.h"
#import "include/core/SkImageInfo.h"
#import "include/core/SkPaint.h"
#import "include/core/SkPath.h"
#import "include/core/SkString.h"
#import "include/core/SkSurface.h"
#import "include/core/SkTypeface.h"
#import "include/effects/SkRuntimeEffect.h"
#if __has_include("include/ports/SkFontMgr_mac_ct.h")
#import "include/ports/SkFontMgr_mac_ct.h"
#endif

namespace {

enum PackedOpcode {
  PackedOpcodeClear = 1,
  PackedOpcodeRect = 2,
  PackedOpcodeCircle = 3,
  PackedOpcodeLine = 4,
  PackedOpcodePath = 5,
  PackedOpcodeRuntimeShaderRect = 6,
  PackedOpcodeRuntimeShaderCircle = 7,
  PackedOpcodeRuntimeShaderPath = 8,
  PackedOpcodeText = 9,
};

enum PackedColorType {
  PackedColorTypeInt = 1,
  PackedColorTypeString = 2,
};

enum PackedStyle {
  PackedStyleFill = 0,
  PackedStyleStroke = 1,
};

enum PackedStrokeCap {
  PackedStrokeCapButt = 0,
  PackedStrokeCapRound = 1,
  PackedStrokeCapSquare = 2,
};

enum PackedStrokeJoin {
  PackedStrokeJoinMiter = 0,
  PackedStrokeJoinRound = 1,
  PackedStrokeJoinBevel = 2,
};

enum PackedPathVerb {
  PackedPathVerbMoveTo = 0,
  PackedPathVerbLineTo = 1,
  PackedPathVerbQuadTo = 2,
  PackedPathVerbCubicTo = 3,
  PackedPathVerbClose = 4,
};

constexpr int PackedStreamMagic = 900719;
constexpr int PackedStreamVersion = 2;
constexpr int PackedScalarLiteral = 0;
constexpr int PackedScalarSharedSignal = 1;
constexpr int PackedScalarInterpolation = 2;
constexpr int ExtrapolateClamp = 0;
constexpr int ExtrapolateExtend = 1;
constexpr int ExtrapolateIdentity = 2;

struct CommandBuffer {
  std::vector<double> ops;
  std::vector<std::string> stringTable;
};

struct SurfaceState {
  bool frameLoopEnabled = false;
  std::shared_ptr<CommandBuffer> front;
  std::shared_ptr<CommandBuffer> back;
  bool hasPending = false;
};

std::mutex gSkiaMutex;
std::unordered_map<int, SurfaceState> gSkiaSurfaces;
std::mutex gSignalSubscriptionsMutex;
std::unordered_map<int, std::vector<int>> gSurfaceSignalIds;
std::unordered_map<int, std::vector<int>> gSignalSurfaceIds;
void *gSkiaRuntimeState = nullptr;
thread_local std::vector<int> *gSignalCollector = nullptr;
std::mutex gRuntimeEffectCacheMutex;
std::unordered_map<std::string, sk_sp<SkRuntimeEffect>> gRuntimeEffectCache;

std::mutex gTypefaceCacheMutex;
std::unordered_map<std::string, sk_sp<SkTypeface>> gTypefaceCache;

static sk_sp<SkFontMgr> getSystemFontMgr() {
#if __has_include("include/ports/SkFontMgr_mac_ct.h")
  return SkFontMgr_New_CoreText(nullptr);
#else
  return SkFontMgr::RefEmpty();
#endif
}

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

static SkColor readPackedColor(const CommandBuffer &buffer,
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
    if (stringIndex < 0 || stringIndex >= static_cast<int>(buffer.stringTable.size())) {
      return SK_ColorTRANSPARENT;
    }
    NSString *colorString =
        [NSString stringWithUTF8String:buffer.stringTable[stringIndex].c_str()];
    return static_cast<SkColor>(parseHexColorString(colorString));
  }

  index += 1;
  return SK_ColorTRANSPARENT;
}

static const std::string *readPackedString(const CommandBuffer &buffer, int idx) {
  if (idx < 0 || idx >= static_cast<int>(buffer.stringTable.size())) {
    return nullptr;
  }
  return &buffer.stringTable[static_cast<size_t>(idx)];
}

static void normalizeUniqueIds(std::vector<int> &ids) {
  std::sort(ids.begin(), ids.end());
  ids.erase(std::unique(ids.begin(), ids.end()), ids.end());
}

static void removeSurfaceSignalSubscriptionsLocked(int nodeId) {
  auto foundSurface = gSurfaceSignalIds.find(nodeId);
  if (foundSurface == gSurfaceSignalIds.end()) return;
  for (int signalId : foundSurface->second) {
    auto it = gSignalSurfaceIds.find(signalId);
    if (it == gSignalSurfaceIds.end()) continue;
    auto &nodes = it->second;
    nodes.erase(std::remove(nodes.begin(), nodes.end(), nodeId), nodes.end());
    if (nodes.empty()) {
      gSignalSurfaceIds.erase(it);
    }
  }
  gSurfaceSignalIds.erase(foundSurface);
}

static void updateSurfaceSignalSubscriptions(int nodeId, std::vector<int> ids) {
  normalizeUniqueIds(ids);
  std::lock_guard<std::mutex> lock(gSignalSubscriptionsMutex);
  removeSurfaceSignalSubscriptionsLocked(nodeId);
  if (ids.empty()) return;
  gSurfaceSignalIds[nodeId] = ids;
  for (int signalId : ids) {
    auto &nodes = gSignalSurfaceIds[signalId];
    nodes.push_back(nodeId);
    normalizeUniqueIds(nodes);
  }
}

static void consumePackedHeader(const std::vector<double> &ops,
                                size_t &index,
                                bool &taggedScalars) {
  taggedScalars = false;
  if (ops.size() < 2) return;
  int maybeMagic = static_cast<int>(ops[0]);
  if (maybeMagic != PackedStreamMagic) return;
  int version = static_cast<int>(ops[1]);
  index = 2;
  taggedScalars = version >= PackedStreamVersion;
}

static float readPackedScalar(const std::vector<double> &ops,
                              size_t &index,
                              bool taggedScalars,
                              float fallback = 0.0f) {
  if (index >= ops.size()) return fallback;
  if (!taggedScalars) {
    return static_cast<float>(ops[index++]);
  }

  int kind = static_cast<int>(ops[index++]);
  if (kind == PackedScalarLiteral) {
    if (index >= ops.size()) return fallback;
    return static_cast<float>(ops[index++]);
  }
  if (kind == PackedScalarSharedSignal) {
    if (index + 1 >= ops.size()) return fallback;
    int signalId = static_cast<int>(ops[index++]);
    double snapshot = ops[index++];
    if (gSignalCollector && signalId > 0) {
      gSignalCollector->push_back(signalId);
    }
    bool found = false;
    double resolved = ZynthGetSharedSignal(gSkiaRuntimeState, signalId, &found);
    if (!found || !std::isfinite(resolved)) {
      resolved = snapshot;
    }
    return static_cast<float>(resolved);
  }
  if (kind == PackedScalarInterpolation) {
    if (index + 3 >= ops.size()) return fallback;
    int signalId = static_cast<int>(ops[index++]);
    double snapshot = ops[index++];
    int count = static_cast<int>(ops[index++]);
    if (count < 2) return static_cast<float>(snapshot);
    if (index + static_cast<size_t>(count * 2 + 2) > ops.size()) return fallback;
    std::vector<double> inputRange;
    std::vector<double> outputRange;
    inputRange.reserve(static_cast<size_t>(count));
    outputRange.reserve(static_cast<size_t>(count));
    for (int i = 0; i < count; i += 1) {
      inputRange.push_back(ops[index++]);
    }
    for (int i = 0; i < count; i += 1) {
      outputRange.push_back(ops[index++]);
    }
    int leftMode = static_cast<int>(ops[index++]);
    int rightMode = static_cast<int>(ops[index++]);

    if (gSignalCollector && signalId > 0) {
      gSignalCollector->push_back(signalId);
    }
    bool found = false;
    double source = ZynthGetSharedSignal(gSkiaRuntimeState, signalId, &found);
    if (!found || !std::isfinite(source)) {
      source = snapshot;
    }
    if (!std::isfinite(source)) return fallback;

    if (source <= inputRange.front()) {
      if (leftMode == ExtrapolateIdentity) return static_cast<float>(source);
      if (leftMode == ExtrapolateClamp) return static_cast<float>(outputRange.front());
    }
    if (source >= inputRange.back()) {
      if (rightMode == ExtrapolateIdentity) return static_cast<float>(source);
      if (rightMode == ExtrapolateClamp) return static_cast<float>(outputRange.back());
    }

    int segment = 0;
    for (int i = 0; i < count - 1; i += 1) {
      double start = inputRange[static_cast<size_t>(i)];
      double end = inputRange[static_cast<size_t>(i + 1)];
      if (source >= start && source <= end) {
        segment = i;
        break;
      }
      if (source > end) {
        segment = i;
      }
    }

    double inMin = inputRange[static_cast<size_t>(segment)];
    double inMax = inputRange[static_cast<size_t>(segment + 1)];
    double outMin = outputRange[static_cast<size_t>(segment)];
    double outMax = outputRange[static_cast<size_t>(segment + 1)];
    double span = inMax - inMin;
    if (!std::isfinite(span) || span == 0.0) return static_cast<float>(outMin);
    double t = (source - inMin) / span;
    return static_cast<float>(outMin + (outMax - outMin) * t);
  }
  return fallback;
}

static sk_sp<SkData> buildRuntimeUniformData(
    const sk_sp<SkRuntimeEffect> &effect,
    const std::unordered_map<std::string, std::vector<float>> &uniformValues) {
  if (!effect) return nullptr;
  const size_t uniformSize = effect->uniformSize();
  std::vector<uint8_t> bytes(uniformSize, 0);

  for (const SkRuntimeEffect::Uniform &uniform : effect->uniforms()) {
    const auto found = uniformValues.find(std::string(uniform.name));
    if (found == uniformValues.end()) {
      continue;
    }
    const std::vector<float> &values = found->second;
    if (values.empty()) continue;

    const size_t slotCount = uniform.sizeInBytes() / sizeof(float);
    if (slotCount == 0) continue;
    const size_t copyCount = std::min(slotCount, values.size());
    const size_t offset = uniform.offset;
    if (offset + uniform.sizeInBytes() > bytes.size()) {
      continue;
    }
    memcpy(bytes.data() + offset, values.data(), copyCount * sizeof(float));
  }

  return SkData::MakeWithCopy(bytes.data(), bytes.size());
}

static sk_sp<SkRuntimeEffect> getCachedRuntimeEffect(const std::string &source) {
  if (source.empty()) return nullptr;
  {
    std::lock_guard<std::mutex> lock(gRuntimeEffectCacheMutex);
    auto found = gRuntimeEffectCache.find(source);
    if (found != gRuntimeEffectCache.end()) {
      return found->second;
    }
  }

  SkRuntimeEffect::Result result = SkRuntimeEffect::MakeForShader(SkString(source.c_str()));
  if (!result.effect) {
    return nullptr;
  }

  {
    std::lock_guard<std::mutex> lock(gRuntimeEffectCacheMutex);
    if (gRuntimeEffectCache.size() >= 128) {
      gRuntimeEffectCache.clear();
    }
    gRuntimeEffectCache[source] = result.effect;
  }
  return result.effect;
}

static SkPaint::Cap decodeStrokeCap(int packedCap) {
  switch (packedCap) {
    case PackedStrokeCapRound:
      return SkPaint::kRound_Cap;
    case PackedStrokeCapSquare:
      return SkPaint::kSquare_Cap;
    case PackedStrokeCapButt:
    default:
      return SkPaint::kButt_Cap;
  }
}

static SkPaint::Join decodeStrokeJoin(int packedJoin) {
  switch (packedJoin) {
    case PackedStrokeJoinRound:
      return SkPaint::kRound_Join;
    case PackedStrokeJoinBevel:
      return SkPaint::kBevel_Join;
    case PackedStrokeJoinMiter:
    default:
      return SkPaint::kMiter_Join;
  }
}

static void configurePaint(SkPaint &paint,
                           SkColor color,
                           float strokeWidth,
                           int style,
                           bool antiAlias,
                           float opacity,
                           int strokeCap,
                           int strokeJoin,
                           float strokeMiter) {
  paint.setAntiAlias(antiAlias);
  paint.setColor(color);
  paint.setAlphaf(std::max(0.0f, std::min(1.0f, opacity)));
  paint.setStrokeWidth(strokeWidth);
  paint.setStyle(style == PackedStyleStroke ? SkPaint::kStroke_Style
                                            : SkPaint::kFill_Style);
  paint.setStrokeCap(decodeStrokeCap(strokeCap));
  paint.setStrokeJoin(decodeStrokeJoin(strokeJoin));
  paint.setStrokeMiter(strokeMiter);
}

static int normalizeFontWeight(NSString *weight) {
  if (weight == nil) return 400;
  NSString *trimmed = [weight stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (trimmed.length == 0) return 400;
  if ([trimmed caseInsensitiveCompare:@"bold"] == NSOrderedSame) return 700;
  if ([trimmed caseInsensitiveCompare:@"normal"] == NSOrderedSame) return 400;
  NSInteger numeric = [trimmed integerValue];
  if (numeric < 100) numeric = 100;
  if (numeric > 900) numeric = 900;
  numeric = (numeric / 100) * 100;
  return static_cast<int>(numeric);
}

static SkFontStyle::Slant normalizeFontSlant(NSString *style) {
  if (style == nil) return SkFontStyle::kUpright_Slant;
  NSString *trimmed = [style stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if ([trimmed caseInsensitiveCompare:@"italic"] == NSOrderedSame
      || [trimmed caseInsensitiveCompare:@"oblique"] == NSOrderedSame) {
    return SkFontStyle::kItalic_Slant;
  }
  return SkFontStyle::kUpright_Slant;
}

static sk_sp<SkTypeface> resolveTypeface(NSString *familyName, NSString *fontStyle, NSString *fontWeight) {
  if (familyName != nil && familyName.length > 0) {
    std::string name = [familyName UTF8String];
    std::lock_guard<std::mutex> lock(gTypefaceCacheMutex);
    auto it = gTypefaceCache.find(name);
    if (it != gTypefaceCache.end()) {
      return it->second;
    }
  }

  auto fontMgr = getSystemFontMgr();
  SkFontStyle style(normalizeFontWeight(fontWeight), SkFontStyle::kNormal_Width, normalizeFontSlant(fontStyle));
  const char *family = (familyName != nil && familyName.length > 0)
    ? [familyName UTF8String]
    : nullptr;
    
  auto typeface = fontMgr->matchFamilyStyle(family, style);
  
  if (!typeface && family != nullptr) {
    typeface = fontMgr->matchFamilyStyle("Helvetica", style);
  }

  return typeface;
}

static bool renderSurfaceState(const CommandBuffer &buffer,
                               int width,
                               int height,
                               SkColor clearColor,
                               std::vector<uint8_t> &outPixels,
                               size_t &outRowBytes,
                               std::vector<int> *usedSignalIds = nullptr) {
  if (width <= 0 || height <= 0) return false;

  SkImageInfo info = SkImageInfo::MakeN32Premul(width, height);
  sk_sp<SkSurface> surface = SkSurfaces::Raster(info);
  if (!surface) return false;

  SkCanvas *canvas = surface->getCanvas();
  canvas->clear(clearColor);
  std::vector<int> *previousCollector = gSignalCollector;
  gSignalCollector = usedSignalIds;

  size_t i = 0;
  bool taggedScalars = false;
  consumePackedHeader(buffer.ops, i, taggedScalars);
  while (i < buffer.ops.size()) {
    int opcode = static_cast<int>(buffer.ops[i++]);

    if (opcode == PackedOpcodeClear) {
      SkColor color = readPackedColor(buffer, buffer.ops, i);
      canvas->clear(color);
      continue;
    }

    if (opcode == PackedOpcodeRect) {
      float x = readPackedScalar(buffer.ops, i, taggedScalars);
      float y = readPackedScalar(buffer.ops, i, taggedScalars);
      float w = readPackedScalar(buffer.ops, i, taggedScalars);
      float h = readPackedScalar(buffer.ops, i, taggedScalars);
      SkColor color = readPackedColor(buffer, buffer.ops, i);
      float strokeWidth = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      if (i + 2 >= buffer.ops.size()) break;
      int style = static_cast<int>(buffer.ops[i++]);
      bool antiAlias = static_cast<int>(buffer.ops[i++]) != 0;
      float opacity = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      if (i + 1 >= buffer.ops.size()) break;
      int strokeCap = static_cast<int>(buffer.ops[i++]);
      int strokeJoin = static_cast<int>(buffer.ops[i++]);
      float strokeMiter = readPackedScalar(buffer.ops, i, taggedScalars, 4.0f);

      SkPaint paint;
      configurePaint(
          paint,
          color,
          strokeWidth,
          style,
          antiAlias,
          opacity,
          strokeCap,
          strokeJoin,
          strokeMiter);
      canvas->drawRect(SkRect::MakeXYWH(x, y, w, h), paint);
      continue;
    }

    if (opcode == PackedOpcodeCircle) {
      float cx = readPackedScalar(buffer.ops, i, taggedScalars);
      float cy = readPackedScalar(buffer.ops, i, taggedScalars);
      float r = readPackedScalar(buffer.ops, i, taggedScalars);
      SkColor color = readPackedColor(buffer, buffer.ops, i);
      float strokeWidth = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      if (i + 2 >= buffer.ops.size()) break;
      int style = static_cast<int>(buffer.ops[i++]);
      bool antiAlias = static_cast<int>(buffer.ops[i++]) != 0;
      float opacity = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      if (i + 1 >= buffer.ops.size()) break;
      int strokeCap = static_cast<int>(buffer.ops[i++]);
      int strokeJoin = static_cast<int>(buffer.ops[i++]);
      float strokeMiter = readPackedScalar(buffer.ops, i, taggedScalars, 4.0f);

      SkPaint paint;
      configurePaint(
          paint,
          color,
          strokeWidth,
          style,
          antiAlias,
          opacity,
          strokeCap,
          strokeJoin,
          strokeMiter);
      canvas->drawCircle(cx, cy, r, paint);
      continue;
    }

    if (opcode == PackedOpcodeLine) {
      float x1 = readPackedScalar(buffer.ops, i, taggedScalars);
      float y1 = readPackedScalar(buffer.ops, i, taggedScalars);
      float x2 = readPackedScalar(buffer.ops, i, taggedScalars);
      float y2 = readPackedScalar(buffer.ops, i, taggedScalars);
      SkColor color = readPackedColor(buffer, buffer.ops, i);
      float strokeWidth = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      if (i + 1 >= buffer.ops.size()) break;
      bool antiAlias = static_cast<int>(buffer.ops[i++]) != 0;
      float opacity = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      if (i + 1 >= buffer.ops.size()) break;
      int strokeCap = static_cast<int>(buffer.ops[i++]);
      int strokeJoin = static_cast<int>(buffer.ops[i++]);
      float strokeMiter = readPackedScalar(buffer.ops, i, taggedScalars, 4.0f);

      SkPaint paint;
      configurePaint(
          paint,
          color,
          strokeWidth,
          PackedStyleStroke,
          antiAlias,
          opacity,
          strokeCap,
          strokeJoin,
          strokeMiter);
      canvas->drawLine(x1, y1, x2, y2, paint);
      continue;
    }

    if (opcode == PackedOpcodePath) {
      SkColor color = readPackedColor(buffer, buffer.ops, i);
      float strokeWidth = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      if (i + 2 >= buffer.ops.size()) break;
      int style = static_cast<int>(buffer.ops[i++]);
      bool antiAlias = static_cast<int>(buffer.ops[i++]) != 0;
      float opacity = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      if (i + 1 >= buffer.ops.size()) break;
      int strokeCap = static_cast<int>(buffer.ops[i++]);
      int strokeJoin = static_cast<int>(buffer.ops[i++]);
      float strokeMiter = readPackedScalar(buffer.ops, i, taggedScalars, 4.0f);
      if (i >= buffer.ops.size()) break;
      int commandCount = static_cast<int>(buffer.ops[i++]);
      if (commandCount < 0) break;

      SkPath path;
      for (int cmd = 0; cmd < commandCount; cmd += 1) {
        if (i >= buffer.ops.size()) break;
        int verb = static_cast<int>(buffer.ops[i++]);
        if (verb == PackedPathVerbMoveTo || verb == PackedPathVerbLineTo) {
          float x = readPackedScalar(buffer.ops, i, taggedScalars);
          float y = readPackedScalar(buffer.ops, i, taggedScalars);
          if (verb == PackedPathVerbMoveTo) {
            path.moveTo(x, y);
          } else {
            path.lineTo(x, y);
          }
          continue;
        }
        if (verb == PackedPathVerbQuadTo) {
          float cpx = readPackedScalar(buffer.ops, i, taggedScalars);
          float cpy = readPackedScalar(buffer.ops, i, taggedScalars);
          float x = readPackedScalar(buffer.ops, i, taggedScalars);
          float y = readPackedScalar(buffer.ops, i, taggedScalars);
          path.quadTo(cpx, cpy, x, y);
          continue;
        }
        if (verb == PackedPathVerbCubicTo) {
          float cp1x = readPackedScalar(buffer.ops, i, taggedScalars);
          float cp1y = readPackedScalar(buffer.ops, i, taggedScalars);
          float cp2x = readPackedScalar(buffer.ops, i, taggedScalars);
          float cp2y = readPackedScalar(buffer.ops, i, taggedScalars);
          float x = readPackedScalar(buffer.ops, i, taggedScalars);
          float y = readPackedScalar(buffer.ops, i, taggedScalars);
          path.cubicTo(cp1x, cp1y, cp2x, cp2y, x, y);
          continue;
        }
        if (verb == PackedPathVerbClose) {
          path.close();
          continue;
        }
        break;
      }

      SkPaint paint;
      configurePaint(
          paint,
          color,
          strokeWidth,
          style,
          antiAlias,
          opacity,
          strokeCap,
          strokeJoin,
          strokeMiter);
      canvas->drawPath(path, paint);
      continue;
    }

    if (opcode == PackedOpcodeText) {
      float x = readPackedScalar(buffer.ops, i, taggedScalars);
      float y = readPackedScalar(buffer.ops, i, taggedScalars);
      SkColor color = readPackedColor(buffer, buffer.ops, i);
      float fontSize = readPackedScalar(buffer.ops, i, taggedScalars, 14.0f);
      if (i + 5 >= buffer.ops.size()) break;
      bool antiAlias = static_cast<int>(buffer.ops[i++]) != 0;
      float opacity = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      int familyIndex = static_cast<int>(buffer.ops[i++]);
      int styleIndex = static_cast<int>(buffer.ops[i++]);
      int weightIndex = static_cast<int>(buffer.ops[i++]);
      int textIndex = static_cast<int>(buffer.ops[i++]);
      bool hasMatrix = static_cast<int>(buffer.ops[i++]) != 0;

      const std::string *familyPtr = readPackedString(buffer, familyIndex);
      const std::string *stylePtr = readPackedString(buffer, styleIndex);
      const std::string *weightPtr = readPackedString(buffer, weightIndex);
      const std::string *textPtr = readPackedString(buffer, textIndex);
      if (!textPtr) {
        continue;
      }

      NSString *familyName = familyPtr
        ? [NSString stringWithUTF8String:familyPtr->c_str()]
        : @"";
      NSString *fontStyle = stylePtr
        ? [NSString stringWithUTF8String:stylePtr->c_str()]
        : @"normal";
      NSString *fontWeight = weightPtr
        ? [NSString stringWithUTF8String:weightPtr->c_str()]
        : @"normal";

      sk_sp<SkTypeface> typeface = resolveTypeface(familyName, fontStyle, fontWeight);

      if (hasMatrix) {
        if (i + 5 >= buffer.ops.size()) break;
        const float a = static_cast<float>(buffer.ops[i++]);
        const float b = static_cast<float>(buffer.ops[i++]);
        const float c = static_cast<float>(buffer.ops[i++]);
        const float d = static_cast<float>(buffer.ops[i++]);
        const float tx = static_cast<float>(buffer.ops[i++]);
        const float ty = static_cast<float>(buffer.ops[i++]);
        SkMatrix matrix = SkMatrix::MakeAll(a, c, tx, b, d, ty, 0, 0, 1);
        canvas->save();
        canvas->concat(matrix);
      }

      SkFont font;
      font.setSize(std::max(0.0f, fontSize));
      if (typeface) {
        font.setTypeface(typeface);
      }
      font.setSubpixel(true);
      font.setEdging(antiAlias ? SkFont::Edging::kAntiAlias : SkFont::Edging::kAlias);
      SkPaint paint;
      paint.setColor(color);
      paint.setAlphaf(std::max(0.0f, std::min(1.0f, opacity)));
      paint.setAntiAlias(antiAlias);
      paint.setStyle(SkPaint::kFill_Style);
      canvas->drawString(SkString(textPtr->c_str()), x, y, font, paint);
      if (hasMatrix) {
        canvas->restore();
      }
      continue;
    }

    if (opcode == PackedOpcodeRuntimeShaderRect) {
      float x = readPackedScalar(buffer.ops, i, taggedScalars);
      float y = readPackedScalar(buffer.ops, i, taggedScalars);
      float w = readPackedScalar(buffer.ops, i, taggedScalars);
      float h = readPackedScalar(buffer.ops, i, taggedScalars);
      if (i >= buffer.ops.size()) break;
      bool antiAlias = static_cast<int>(buffer.ops[i++]) != 0;
      float opacity = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      if (i + 1 >= buffer.ops.size()) break;
      int sourceIndex = static_cast<int>(buffer.ops[i++]);
      int uniformCount = static_cast<int>(buffer.ops[i++]);
      if (uniformCount < 0) break;

      const std::string *sourcePtr = readPackedString(buffer, sourceIndex);
      if (!sourcePtr) {
        continue;
      }

      std::unordered_map<std::string, std::vector<float>> uniforms;
      for (int uniformIndex = 0; uniformIndex < uniformCount; uniformIndex += 1) {
        if (i + 1 >= buffer.ops.size()) break;
        int nameIndex = static_cast<int>(buffer.ops[i++]);
        int valueCount = static_cast<int>(buffer.ops[i++]);
        if (valueCount < 0) break;
        const std::string *namePtr = readPackedString(buffer, nameIndex);
        std::vector<float> values;
        values.reserve(static_cast<size_t>(valueCount));
        for (int valueIndex = 0; valueIndex < valueCount; valueIndex += 1) {
          values.push_back(readPackedScalar(buffer.ops, i, taggedScalars));
        }
        if (namePtr) {
          uniforms[*namePtr] = std::move(values);
        }
      }

      const sk_sp<SkRuntimeEffect> effect = getCachedRuntimeEffect(*sourcePtr);
      if (!effect) {
        continue;
      }

      sk_sp<SkData> uniformData = buildRuntimeUniformData(effect, uniforms);
      if (!uniformData) {
        continue;
      }

      sk_sp<SkShader> runtimeShader = effect->makeShader(uniformData, nullptr, 0, nullptr);
      if (!runtimeShader) {
        continue;
      }

      SkPaint paint;
      paint.setAntiAlias(antiAlias);
      paint.setShader(runtimeShader);
      paint.setAlphaf(std::max(0.0f, std::min(1.0f, opacity)));
      paint.setStyle(SkPaint::kFill_Style);
      canvas->drawRect(SkRect::MakeXYWH(x, y, w, h), paint);
      continue;
    }

    if (opcode == PackedOpcodeRuntimeShaderCircle) {
      float cx = readPackedScalar(buffer.ops, i, taggedScalars);
      float cy = readPackedScalar(buffer.ops, i, taggedScalars);
      float r = readPackedScalar(buffer.ops, i, taggedScalars);
      if (i >= buffer.ops.size()) break;
      bool antiAlias = static_cast<int>(buffer.ops[i++]) != 0;
      float opacity = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      if (i + 1 >= buffer.ops.size()) break;
      int sourceIndex = static_cast<int>(buffer.ops[i++]);
      int uniformCount = static_cast<int>(buffer.ops[i++]);
      if (uniformCount < 0) break;

      const std::string *sourcePtr = readPackedString(buffer, sourceIndex);
      if (!sourcePtr) {
        continue;
      }

      std::unordered_map<std::string, std::vector<float>> uniforms;
      for (int uniformIndex = 0; uniformIndex < uniformCount; uniformIndex += 1) {
        if (i + 1 >= buffer.ops.size()) break;
        int nameIndex = static_cast<int>(buffer.ops[i++]);
        int valueCount = static_cast<int>(buffer.ops[i++]);
        if (valueCount < 0) break;
        const std::string *namePtr = readPackedString(buffer, nameIndex);
        std::vector<float> values;
        values.reserve(static_cast<size_t>(valueCount));
        for (int valueIndex = 0; valueIndex < valueCount; valueIndex += 1) {
          values.push_back(readPackedScalar(buffer.ops, i, taggedScalars));
        }
        if (namePtr) {
          uniforms[*namePtr] = std::move(values);
        }
      }

      const sk_sp<SkRuntimeEffect> effect = getCachedRuntimeEffect(*sourcePtr);
      if (!effect) {
        continue;
      }

      sk_sp<SkData> uniformData = buildRuntimeUniformData(effect, uniforms);
      if (!uniformData) {
        continue;
      }

      sk_sp<SkShader> runtimeShader = effect->makeShader(uniformData, nullptr, 0, nullptr);
      if (!runtimeShader) {
        continue;
      }

      SkPaint paint;
      paint.setAntiAlias(antiAlias);
      paint.setShader(runtimeShader);
      paint.setAlphaf(std::max(0.0f, std::min(1.0f, opacity)));
      paint.setStyle(SkPaint::kFill_Style);
      canvas->drawCircle(cx, cy, r, paint);
      continue;
    }

    if (opcode == PackedOpcodeRuntimeShaderPath) {
      if (i + 2 >= buffer.ops.size()) break;
      bool antiAlias = static_cast<int>(buffer.ops[i++]) != 0;
      float opacity = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      if (i + 1 >= buffer.ops.size()) break;
      int sourceIndex = static_cast<int>(buffer.ops[i++]);
      int uniformCount = static_cast<int>(buffer.ops[i++]);
      if (uniformCount < 0) break;

      const std::string *sourcePtr = readPackedString(buffer, sourceIndex);
      if (!sourcePtr) {
        continue;
      }

      std::unordered_map<std::string, std::vector<float>> uniforms;
      for (int uniformIndex = 0; uniformIndex < uniformCount; uniformIndex += 1) {
        if (i + 1 >= buffer.ops.size()) break;
        int nameIndex = static_cast<int>(buffer.ops[i++]);
        int valueCount = static_cast<int>(buffer.ops[i++]);
        if (valueCount < 0) break;
        const std::string *namePtr = readPackedString(buffer, nameIndex);
        std::vector<float> values;
        values.reserve(static_cast<size_t>(valueCount));
        for (int valueIndex = 0; valueIndex < valueCount; valueIndex += 1) {
          values.push_back(readPackedScalar(buffer.ops, i, taggedScalars));
        }
        if (namePtr) {
          uniforms[*namePtr] = std::move(values);
        }
      }

      if (i >= buffer.ops.size()) break;
      int commandCount = static_cast<int>(buffer.ops[i++]);
      if (commandCount < 0) break;
      SkPath path;
      for (int cmd = 0; cmd < commandCount; cmd += 1) {
        if (i >= buffer.ops.size()) break;
        int verb = static_cast<int>(buffer.ops[i++]);
        if (verb == PackedPathVerbMoveTo || verb == PackedPathVerbLineTo) {
          float x = readPackedScalar(buffer.ops, i, taggedScalars);
          float y = readPackedScalar(buffer.ops, i, taggedScalars);
          if (verb == PackedPathVerbMoveTo) {
            path.moveTo(x, y);
          } else {
            path.lineTo(x, y);
          }
          continue;
        }
        if (verb == PackedPathVerbQuadTo) {
          float cpx = readPackedScalar(buffer.ops, i, taggedScalars);
          float cpy = readPackedScalar(buffer.ops, i, taggedScalars);
          float x = readPackedScalar(buffer.ops, i, taggedScalars);
          float y = readPackedScalar(buffer.ops, i, taggedScalars);
          path.quadTo(cpx, cpy, x, y);
          continue;
        }
        if (verb == PackedPathVerbCubicTo) {
          float cp1x = readPackedScalar(buffer.ops, i, taggedScalars);
          float cp1y = readPackedScalar(buffer.ops, i, taggedScalars);
          float cp2x = readPackedScalar(buffer.ops, i, taggedScalars);
          float cp2y = readPackedScalar(buffer.ops, i, taggedScalars);
          float x = readPackedScalar(buffer.ops, i, taggedScalars);
          float y = readPackedScalar(buffer.ops, i, taggedScalars);
          path.cubicTo(cp1x, cp1y, cp2x, cp2y, x, y);
          continue;
        }
        if (verb == PackedPathVerbClose) {
          path.close();
          continue;
        }
        break;
      }

      const sk_sp<SkRuntimeEffect> effect = getCachedRuntimeEffect(*sourcePtr);
      if (!effect) {
        continue;
      }

      sk_sp<SkData> uniformData = buildRuntimeUniformData(effect, uniforms);
      if (!uniformData) {
        continue;
      }

      sk_sp<SkShader> runtimeShader = effect->makeShader(uniformData, nullptr, 0, nullptr);
      if (!runtimeShader) {
        continue;
      }

      SkPaint paint;
      paint.setAntiAlias(antiAlias);
      paint.setShader(runtimeShader);
      paint.setAlphaf(std::max(0.0f, std::min(1.0f, opacity)));
      paint.setStyle(SkPaint::kFill_Style);
      canvas->drawPath(path, paint);
      continue;
    }

    break;
  }

  sk_sp<SkImage> image = surface->makeImageSnapshot();
  if (!image) return false;

  outRowBytes = static_cast<size_t>(width) * 4;
  outPixels.resize(outRowBytes * static_cast<size_t>(height));
  bool ok = image->readPixels(info, outPixels.data(), outRowBytes, 0, 0);
  gSignalCollector = previousCollector;
  if (usedSignalIds) {
    normalizeUniqueIds(*usedSignalIds);
  }
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
      outOps.push_back(command[@"antiAlias"] ? ([command[@"antiAlias"] boolValue] ? 1.0 : 0.0) : 1.0);
      outOps.push_back(command[@"opacity"] ? [command[@"opacity"] doubleValue] : 1.0);
      NSString *strokeCap = command[@"strokeCap"];
      if ([strokeCap isEqualToString:@"round"]) {
        outOps.push_back(PackedStrokeCapRound);
      } else if ([strokeCap isEqualToString:@"square"]) {
        outOps.push_back(PackedStrokeCapSquare);
      } else {
        outOps.push_back(PackedStrokeCapButt);
      }
      NSString *strokeJoin = command[@"strokeJoin"];
      if ([strokeJoin isEqualToString:@"round"]) {
        outOps.push_back(PackedStrokeJoinRound);
      } else if ([strokeJoin isEqualToString:@"bevel"]) {
        outOps.push_back(PackedStrokeJoinBevel);
      } else {
        outOps.push_back(PackedStrokeJoinMiter);
      }
      outOps.push_back(command[@"strokeMiter"] ? [command[@"strokeMiter"] doubleValue] : 4.0);
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
      outOps.push_back(command[@"antiAlias"] ? ([command[@"antiAlias"] boolValue] ? 1.0 : 0.0) : 1.0);
      outOps.push_back(command[@"opacity"] ? [command[@"opacity"] doubleValue] : 1.0);
      NSString *strokeCap = command[@"strokeCap"];
      if ([strokeCap isEqualToString:@"round"]) {
        outOps.push_back(PackedStrokeCapRound);
      } else if ([strokeCap isEqualToString:@"square"]) {
        outOps.push_back(PackedStrokeCapSquare);
      } else {
        outOps.push_back(PackedStrokeCapButt);
      }
      NSString *strokeJoin = command[@"strokeJoin"];
      if ([strokeJoin isEqualToString:@"round"]) {
        outOps.push_back(PackedStrokeJoinRound);
      } else if ([strokeJoin isEqualToString:@"bevel"]) {
        outOps.push_back(PackedStrokeJoinBevel);
      } else {
        outOps.push_back(PackedStrokeJoinMiter);
      }
      outOps.push_back(command[@"strokeMiter"] ? [command[@"strokeMiter"] doubleValue] : 4.0);
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
      outOps.push_back(command[@"antiAlias"] ? ([command[@"antiAlias"] boolValue] ? 1.0 : 0.0) : 1.0);
      outOps.push_back(command[@"opacity"] ? [command[@"opacity"] doubleValue] : 1.0);
      NSString *strokeCap = command[@"strokeCap"];
      if ([strokeCap isEqualToString:@"round"]) {
        outOps.push_back(PackedStrokeCapRound);
      } else if ([strokeCap isEqualToString:@"square"]) {
        outOps.push_back(PackedStrokeCapSquare);
      } else {
        outOps.push_back(PackedStrokeCapButt);
      }
      NSString *strokeJoin = command[@"strokeJoin"];
      if ([strokeJoin isEqualToString:@"round"]) {
        outOps.push_back(PackedStrokeJoinRound);
      } else if ([strokeJoin isEqualToString:@"bevel"]) {
        outOps.push_back(PackedStrokeJoinBevel);
      } else {
        outOps.push_back(PackedStrokeJoinMiter);
      }
      outOps.push_back(command[@"strokeMiter"] ? [command[@"strokeMiter"] doubleValue] : 4.0);
      continue;
    }

    if ([type isEqualToString:@"path"]) {
      NSArray<NSDictionary *> *pathCommands = command[@"commands"];
      if (![pathCommands isKindOfClass:[NSArray class]]) {
        continue;
      }

      outOps.push_back(PackedOpcodePath);
      pushColor(outOps, outStrings, index, command[@"color"]);
      outOps.push_back(command[@"strokeWidth"] ? [command[@"strokeWidth"] doubleValue] : 1.0);
      NSString *style = command[@"style"];
      outOps.push_back([style isEqualToString:@"stroke"] ? PackedStyleStroke : PackedStyleFill);
      outOps.push_back(command[@"antiAlias"] ? ([command[@"antiAlias"] boolValue] ? 1.0 : 0.0) : 1.0);
      outOps.push_back(command[@"opacity"] ? [command[@"opacity"] doubleValue] : 1.0);
      NSString *strokeCap = command[@"strokeCap"];
      if ([strokeCap isEqualToString:@"round"]) {
        outOps.push_back(PackedStrokeCapRound);
      } else if ([strokeCap isEqualToString:@"square"]) {
        outOps.push_back(PackedStrokeCapSquare);
      } else {
        outOps.push_back(PackedStrokeCapButt);
      }
      NSString *strokeJoin = command[@"strokeJoin"];
      if ([strokeJoin isEqualToString:@"round"]) {
        outOps.push_back(PackedStrokeJoinRound);
      } else if ([strokeJoin isEqualToString:@"bevel"]) {
        outOps.push_back(PackedStrokeJoinBevel);
      } else {
        outOps.push_back(PackedStrokeJoinMiter);
      }
      outOps.push_back(command[@"strokeMiter"] ? [command[@"strokeMiter"] doubleValue] : 4.0);
      outOps.push_back(static_cast<double>(pathCommands.count));

      for (NSDictionary *pathCommand in pathCommands) {
        NSString *pathType = pathCommand[@"type"];
        if (![pathType isKindOfClass:[NSString class]]) continue;
        if ([pathType isEqualToString:@"moveTo"]) {
          outOps.push_back(PackedPathVerbMoveTo);
          outOps.push_back([pathCommand[@"x"] doubleValue]);
          outOps.push_back([pathCommand[@"y"] doubleValue]);
          continue;
        }
        if ([pathType isEqualToString:@"lineTo"]) {
          outOps.push_back(PackedPathVerbLineTo);
          outOps.push_back([pathCommand[@"x"] doubleValue]);
          outOps.push_back([pathCommand[@"y"] doubleValue]);
          continue;
        }
        if ([pathType isEqualToString:@"quadTo"]) {
          outOps.push_back(PackedPathVerbQuadTo);
          outOps.push_back([pathCommand[@"cpx"] doubleValue]);
          outOps.push_back([pathCommand[@"cpy"] doubleValue]);
          outOps.push_back([pathCommand[@"x"] doubleValue]);
          outOps.push_back([pathCommand[@"y"] doubleValue]);
          continue;
        }
        if ([pathType isEqualToString:@"cubicTo"]) {
          outOps.push_back(PackedPathVerbCubicTo);
          outOps.push_back([pathCommand[@"cp1x"] doubleValue]);
          outOps.push_back([pathCommand[@"cp1y"] doubleValue]);
          outOps.push_back([pathCommand[@"cp2x"] doubleValue]);
          outOps.push_back([pathCommand[@"cp2y"] doubleValue]);
          outOps.push_back([pathCommand[@"x"] doubleValue]);
          outOps.push_back([pathCommand[@"y"] doubleValue]);
          continue;
        }
        if ([pathType isEqualToString:@"close"]) {
          outOps.push_back(PackedPathVerbClose);
        }
      }
      continue;
    }

    if ([type isEqualToString:@"text"]) {
      outOps.push_back(PackedOpcodeText);
      outOps.push_back([command[@"x"] doubleValue]);
      outOps.push_back([command[@"y"] doubleValue]);
      pushColor(outOps, outStrings, index, command[@"color"]);
      outOps.push_back(command[@"fontSize"] ? [command[@"fontSize"] doubleValue] : 14.0);
      outOps.push_back(command[@"antiAlias"] ? ([command[@"antiAlias"] boolValue] ? 1.0 : 0.0) : 1.0);
      outOps.push_back(command[@"opacity"] ? [command[@"opacity"] doubleValue] : 1.0);
      NSString *fontFamily = [command[@"fontFamily"] isKindOfClass:[NSString class]]
        ? command[@"fontFamily"]
        : @"";
      NSString *fontStyle = [command[@"fontStyle"] isKindOfClass:[NSString class]]
        ? command[@"fontStyle"]
        : @"normal";
      NSString *fontWeight = [command[@"fontWeight"] isKindOfClass:[NSString class]]
        ? command[@"fontWeight"]
        : ([command[@"fontWeight"] respondsToSelector:@selector(stringValue)]
            ? [command[@"fontWeight"] stringValue]
            : @"normal");
      NSString *text = [command[@"text"] isKindOfClass:[NSString class]]
        ? command[@"text"]
        : @"";
      outOps.push_back(addString(outStrings, index, fontFamily));
      outOps.push_back(addString(outStrings, index, fontStyle));
      outOps.push_back(addString(outStrings, index, fontWeight));
      outOps.push_back(addString(outStrings, index, text));
      NSArray *matrix = command[@"matrix"];
      if ([matrix isKindOfClass:[NSArray class]] && matrix.count == 6) {
        outOps.push_back(1.0);
        for (NSNumber *value in matrix) {
          outOps.push_back([value doubleValue]);
        }
      } else {
        outOps.push_back(0.0);
      }
      continue;
    }

    if ([type isEqualToString:@"runtimeShaderRect"]) {
      NSDictionary *uniforms = command[@"uniforms"];
      if (![uniforms isKindOfClass:[NSDictionary class]]) {
        uniforms = @{};
      }

      outOps.push_back(PackedOpcodeRuntimeShaderRect);
      outOps.push_back([command[@"x"] doubleValue]);
      outOps.push_back([command[@"y"] doubleValue]);
      outOps.push_back([command[@"width"] doubleValue]);
      outOps.push_back([command[@"height"] doubleValue]);
      outOps.push_back(command[@"antiAlias"] ? ([command[@"antiAlias"] boolValue] ? 1.0 : 0.0) : 1.0);
      outOps.push_back(command[@"opacity"] ? [command[@"opacity"] doubleValue] : 1.0);

      NSString *source = command[@"source"];
      int sourceIndex = addString(outStrings, index, [source isKindOfClass:[NSString class]] ? source : @"");
      outOps.push_back(sourceIndex);

      NSArray<NSString *> *names = [uniforms allKeys];
      outOps.push_back(static_cast<double>(names.count));
      for (NSString *name in names) {
        int nameIndex = addString(outStrings, index, name);
        outOps.push_back(nameIndex);

        id value = uniforms[name];
        if ([value isKindOfClass:[NSArray class]]) {
          NSArray *array = (NSArray *)value;
          outOps.push_back(static_cast<double>(array.count));
          for (id item in array) {
            outOps.push_back([item doubleValue]);
          }
          continue;
        }
        outOps.push_back(1.0);
        outOps.push_back([value doubleValue]);
      }
      continue;
    }

    if ([type isEqualToString:@"runtimeShaderCircle"]) {
      NSDictionary *uniforms = command[@"uniforms"];
      if (![uniforms isKindOfClass:[NSDictionary class]]) {
        uniforms = @{};
      }

      outOps.push_back(PackedOpcodeRuntimeShaderCircle);
      outOps.push_back([command[@"cx"] doubleValue]);
      outOps.push_back([command[@"cy"] doubleValue]);
      outOps.push_back([command[@"r"] doubleValue]);
      outOps.push_back(command[@"antiAlias"] ? ([command[@"antiAlias"] boolValue] ? 1.0 : 0.0) : 1.0);
      outOps.push_back(command[@"opacity"] ? [command[@"opacity"] doubleValue] : 1.0);

      NSString *source = command[@"source"];
      int sourceIndex = addString(outStrings, index, [source isKindOfClass:[NSString class]] ? source : @"");
      outOps.push_back(sourceIndex);

      NSArray<NSString *> *names = [uniforms allKeys];
      outOps.push_back(static_cast<double>(names.count));
      for (NSString *name in names) {
        int nameIndex = addString(outStrings, index, name);
        outOps.push_back(nameIndex);

        id value = uniforms[name];
        if ([value isKindOfClass:[NSArray class]]) {
          NSArray *array = (NSArray *)value;
          outOps.push_back(static_cast<double>(array.count));
          for (id item in array) {
            outOps.push_back([item doubleValue]);
          }
          continue;
        }
        outOps.push_back(1.0);
        outOps.push_back([value doubleValue]);
      }
      continue;
    }

    if ([type isEqualToString:@"runtimeShaderPath"]) {
      NSDictionary *uniforms = command[@"uniforms"];
      if (![uniforms isKindOfClass:[NSDictionary class]]) {
        uniforms = @{};
      }
      NSArray<NSDictionary *> *pathCommands = command[@"commands"];
      if (![pathCommands isKindOfClass:[NSArray class]]) {
        pathCommands = @[];
      }

      outOps.push_back(PackedOpcodeRuntimeShaderPath);
      outOps.push_back(command[@"antiAlias"] ? ([command[@"antiAlias"] boolValue] ? 1.0 : 0.0) : 1.0);
      outOps.push_back(command[@"opacity"] ? [command[@"opacity"] doubleValue] : 1.0);

      NSString *source = command[@"source"];
      int sourceIndex = addString(outStrings, index, [source isKindOfClass:[NSString class]] ? source : @"");
      outOps.push_back(sourceIndex);

      NSArray<NSString *> *names = [uniforms allKeys];
      outOps.push_back(static_cast<double>(names.count));
      for (NSString *name in names) {
        int nameIndex = addString(outStrings, index, name);
        outOps.push_back(nameIndex);

        id value = uniforms[name];
        if ([value isKindOfClass:[NSArray class]]) {
          NSArray *array = (NSArray *)value;
          outOps.push_back(static_cast<double>(array.count));
          for (id item in array) {
            outOps.push_back([item doubleValue]);
          }
          continue;
        }
        outOps.push_back(1.0);
        outOps.push_back([value doubleValue]);
      }

      outOps.push_back(static_cast<double>(pathCommands.count));
      for (NSDictionary *pathCommand in pathCommands) {
        NSString *pathType = pathCommand[@"type"];
        if (![pathType isKindOfClass:[NSString class]]) continue;
        if ([pathType isEqualToString:@"moveTo"]) {
          outOps.push_back(PackedPathVerbMoveTo);
          outOps.push_back([pathCommand[@"x"] doubleValue]);
          outOps.push_back([pathCommand[@"y"] doubleValue]);
          continue;
        }
        if ([pathType isEqualToString:@"lineTo"]) {
          outOps.push_back(PackedPathVerbLineTo);
          outOps.push_back([pathCommand[@"x"] doubleValue]);
          outOps.push_back([pathCommand[@"y"] doubleValue]);
          continue;
        }
        if ([pathType isEqualToString:@"quadTo"]) {
          outOps.push_back(PackedPathVerbQuadTo);
          outOps.push_back([pathCommand[@"cpx"] doubleValue]);
          outOps.push_back([pathCommand[@"cpy"] doubleValue]);
          outOps.push_back([pathCommand[@"x"] doubleValue]);
          outOps.push_back([pathCommand[@"y"] doubleValue]);
          continue;
        }
        if ([pathType isEqualToString:@"cubicTo"]) {
          outOps.push_back(PackedPathVerbCubicTo);
          outOps.push_back([pathCommand[@"cp1x"] doubleValue]);
          outOps.push_back([pathCommand[@"cp1y"] doubleValue]);
          outOps.push_back([pathCommand[@"cp2x"] doubleValue]);
          outOps.push_back([pathCommand[@"cp2y"] doubleValue]);
          outOps.push_back([pathCommand[@"x"] doubleValue]);
          outOps.push_back([pathCommand[@"y"] doubleValue]);
          continue;
        }
        if ([pathType isEqualToString:@"close"]) {
          outOps.push_back(PackedPathVerbClose);
        }
      }
      continue;
    }
  }

  return true;
}

} // namespace

@implementation ZynthSkiaRendererBridge

+ (BOOL)createSurface:(NSInteger)nodeId {
  if (nodeId <= 0) return NO;
  {
    std::lock_guard<std::mutex> lock(gSkiaMutex);
    SurfaceState state;
    state.front = std::make_shared<CommandBuffer>();
    gSkiaSurfaces[static_cast<int>(nodeId)] = std::move(state);
  }
  updateSurfaceSignalSubscriptions(static_cast<int>(nodeId), {});
  return YES;
}

+ (BOOL)disposeSurface:(NSInteger)nodeId {
  if (nodeId <= 0) return NO;
  {
    std::lock_guard<std::mutex> lock(gSkiaMutex);
    gSkiaSurfaces.erase(static_cast<int>(nodeId));
  }
  updateSurfaceSignalSubscriptions(static_cast<int>(nodeId), {});
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

  auto buffer = std::make_shared<CommandBuffer>();
  buffer->ops.assign(ops, ops + opCount);
  buffer->stringTable.clear();
  buffer->stringTable.reserve(stringTable.count);
  for (NSString *value in stringTable) {
    if (![value isKindOfClass:[NSString class]]) {
      buffer->stringTable.emplace_back();
      continue;
    }
    buffer->stringTable.emplace_back([value UTF8String]);
  }
  it->second.back = std::move(buffer);
  it->second.hasPending = true;

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
  auto buffer = std::make_shared<CommandBuffer>();
  buffer->ops = std::move(ops);
  buffer->stringTable = std::move(strings);
  it->second.back = std::move(buffer);
  it->second.hasPending = true;
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

  std::shared_ptr<CommandBuffer> buffer;
  {
    std::lock_guard<std::mutex> lock(gSkiaMutex);
    auto it = gSkiaSurfaces.find(static_cast<int>(nodeId));
    if (it == gSkiaSurfaces.end()) return nil;
    if (it->second.hasPending && it->second.back != nullptr) {
      it->second.front.swap(it->second.back);
      it->second.back.reset();
      it->second.hasPending = false;
    }
    buffer = it->second.front;
  }
  if (buffer == nullptr) return nil;

  std::vector<uint8_t> pixels;
  size_t rowBytes = 0;
  std::vector<int> usedSignalIds;
  if (!renderSurfaceState(*buffer,
                          static_cast<int>(width),
                          static_cast<int>(height),
                          static_cast<SkColor>(clearColor),
                          pixels,
                          rowBytes,
                          &usedSignalIds)) {
    return nil;
  }
  updateSurfaceSignalSubscriptions(static_cast<int>(nodeId), std::move(usedSignalIds));

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

+ (void)setRuntimeState:(void *)state {
  gSkiaRuntimeState = state;
  if (state == nullptr) {
    std::lock_guard<std::mutex> lock(gRuntimeEffectCacheMutex);
    gRuntimeEffectCache.clear();
  }
}

+ (NSArray<NSNumber *> *)surfaceNodeIdsForSignalId:(int)signalId {
  if (signalId <= 0) return @[];
  std::vector<int> nodeIds;
  {
    std::lock_guard<std::mutex> lock(gSignalSubscriptionsMutex);
    auto found = gSignalSurfaceIds.find(signalId);
    if (found != gSignalSurfaceIds.end()) {
      nodeIds = found->second;
    }
  }
  NSMutableArray<NSNumber *> *result = [NSMutableArray arrayWithCapacity:nodeIds.size()];
  for (int nodeId : nodeIds) {
    [result addObject:@(nodeId)];
  }
  return result;
}

+ (BOOL)hasSurface:(NSInteger)nodeId {
  if (nodeId <= 0) return NO;
  std::lock_guard<std::mutex> lock(gSkiaMutex);
  return gSkiaSurfaces.find(static_cast<int>(nodeId)) != gSkiaSurfaces.end();
}

+ (double)measureText:(NSString *)text
           familyName:(NSString *)familyName
             fontSize:(double)fontSize
            fontStyle:(NSString *)fontStyle
           fontWeight:(NSString *)fontWeight {
  NSString *content = [text isKindOfClass:[NSString class]] ? text : @"";
  if (content.length == 0 || fontSize <= 0) return 0.0;
  sk_sp<SkTypeface> typeface = resolveTypeface(familyName, fontStyle, fontWeight);
  std::string utf8 = std::string([content UTF8String]);
  SkFont font;
  font.setSize(static_cast<float>(fontSize));
  if (typeface) {
    font.setTypeface(typeface);
  }
  font.setSubpixel(true);
  return static_cast<double>(font.measureText(utf8.data(), utf8.size(), SkTextEncoding::kUTF8));
}

+ (NSArray<NSString *> *)listFontFamilies {
  NSMutableArray<NSString *> *all = [[UIFont familyNames] mutableCopy];
  {
    std::lock_guard<std::mutex> lock(gTypefaceCacheMutex);
    for (const auto &it : gTypefaceCache) {
      NSString *name = [NSString stringWithUTF8String:it.first.c_str()];
      if (![all containsObject:name]) {
        [all addObject:name];
      }
    }
  }
  return [all sortedArrayUsingSelector:@selector(localizedCaseInsensitiveCompare:)];
}

+ (BOOL)registerFont:(NSString *)familyName data:(NSData *)data {
  if (familyName == nil || data == nil) return NO;
  sk_sp<SkData> skData = SkData::MakeWithCopy(data.bytes, data.length);
  if (!skData) return NO;

  sk_sp<SkTypeface> typeface;
#if __has_include("include/ports/SkFontMgr_mac_ct.h")
  sk_sp<SkFontMgr> fontMgr = SkFontMgr_New_CoreText(nullptr);
  if (fontMgr) {
    typeface = fontMgr->makeFromData(skData);
  }
#endif

  if (!typeface) return NO;

  {
    std::lock_guard<std::mutex> lock(gTypefaceCacheMutex);
    gTypefaceCache[[familyName UTF8String]] = std::move(typeface);
  }
  return YES;
}

+ (BOOL)registerFont:(NSString *)familyName path:(NSString *)path {
  if (familyName == nil || path == nil) return NO;
  
  sk_sp<SkTypeface> typeface;
#if __has_include("include/ports/SkFontMgr_mac_ct.h")
  sk_sp<SkFontMgr> fontMgr = SkFontMgr_New_CoreText(nullptr);
  if (fontMgr) {
    typeface = fontMgr->makeFromFile([path UTF8String]);
  }
#endif

  if (!typeface) return NO;

  {
    std::lock_guard<std::mutex> lock(gTypefaceCacheMutex);
    gTypefaceCache[[familyName UTF8String]] = std::move(typeface);
  }
  return YES;
}

@end
