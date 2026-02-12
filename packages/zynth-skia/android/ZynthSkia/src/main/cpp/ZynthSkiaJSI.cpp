#include <jni.h>
#include <android/bitmap.h>
#include <android/log.h>
#include <dlfcn.h>
#include <jsi/jsi.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#include "ZynthJSIPluginRegistry.h"

#include "include/core/SkCanvas.h"
#include "include/core/SkColor.h"
#include "include/core/SkData.h"
#include "include/core/SkFont.h"
#include "include/core/SkFontMgr.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkPaint.h"
#include "include/core/SkPath.h"
#include "include/core/SkRect.h"
#include "include/core/SkString.h"
#include "include/core/SkSurface.h"
#include "include/core/SkTypeface.h"
#include "include/effects/SkRuntimeEffect.h"
#include "include/ports/SkFontMgr_android.h"
#include "include/ports/SkFontScanner_FreeType.h"

using namespace facebook::jsi;

namespace {
constexpr const char *kTag = "ZynthSkia";
constexpr const char *kSkiaKey = "__zynth_skia";

constexpr int kOpcodeClear = 1;
constexpr int kOpcodeRect = 2;
constexpr int kOpcodeCircle = 3;
constexpr int kOpcodeLine = 4;
constexpr int kOpcodePath = 5;
constexpr int kOpcodeRuntimeShaderRect = 6;
constexpr int kOpcodeRuntimeShaderCircle = 7;
constexpr int kOpcodeRuntimeShaderPath = 8;
constexpr int kOpcodeText = 9;

constexpr int kColorTypeInt = 1;
constexpr int kColorTypeString = 2;

constexpr int kStyleFill = 0;
constexpr int kStyleStroke = 1;

constexpr int kStrokeCapButt = 0;
constexpr int kStrokeCapRound = 1;
constexpr int kStrokeCapSquare = 2;

constexpr int kStrokeJoinMiter = 0;
constexpr int kStrokeJoinRound = 1;
constexpr int kStrokeJoinBevel = 2;

constexpr int kPathVerbMoveTo = 0;
constexpr int kPathVerbLineTo = 1;
constexpr int kPathVerbQuadTo = 2;
constexpr int kPathVerbCubicTo = 3;
constexpr int kPathVerbClose = 4;

constexpr int kPackedStreamMagic = 900719;
constexpr int kPackedStreamVersion = 2;
constexpr int kPackedScalarLiteral = 0;
constexpr int kPackedScalarSharedSignal = 1;
constexpr int kPackedScalarInterpolation = 2;
constexpr int kExtrapolateClamp = 0;
constexpr int kExtrapolateExtend = 1;
constexpr int kExtrapolateIdentity = 2;

JavaVM *gVm = nullptr;
using RegisterInstallerFn = void (*)(ZynthJSIPluginInstaller installer);
RegisterInstallerFn gRegisterInstaller = nullptr;
using RegisterSharedSignalChangedFn = void (*)(ZynthSharedSignalChangedCallback callback);
RegisterSharedSignalChangedFn gRegisterSharedSignalChanged = nullptr;
using GetSharedSignalFn = double (*)(void *state, int signalId, bool *found);
GetSharedSignalFn gGetSharedSignal = nullptr;
void *gRuntimeState = nullptr;
bool gSharedSignalCallbackRegistered = false;

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
std::mutex gSignalSubscriptionMutex;
std::unordered_map<int, std::vector<int>> gSurfaceSignalIds;
std::unordered_map<int, std::vector<int>> gSignalSurfaceIds;
thread_local std::vector<int> *gSignalCollector = nullptr;
std::mutex gRuntimeEffectCacheMutex;
std::unordered_map<std::string, sk_sp<SkRuntimeEffect>> gRuntimeEffectCache;

std::mutex gTypefaceCacheMutex;
std::unordered_map<std::string, sk_sp<SkTypeface>> gTypefaceCache;

sk_sp<SkFontMgr> getSystemFontMgr() {
  static sk_sp<SkFontMgr> gFontMgr;
  static std::once_flag gFontMgrOnce;
  std::call_once(gFontMgrOnce, []() {
    gFontMgr = SkFontMgr_New_Android(nullptr, SkFontScanner_Make_FreeType());
    if (!gFontMgr) {
      gFontMgr = SkFontMgr::RefEmpty();
    }
  });
  return gFontMgr;
}

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

const std::string *readPackedString(const SurfaceState::CommandBuffer &buffer, int idx) {
  if (idx < 0 || idx >= static_cast<int>(buffer.stringTable.size())) {
    return nullptr;
  }
  return &buffer.stringTable[static_cast<size_t>(idx)];
}

double resolveSharedSignalValue(int signalId, double fallback, bool *resolved = nullptr) {
  if (resolved) *resolved = false;
  if (!gGetSharedSignal || !gRuntimeState || signalId <= 0) return fallback;
  bool found = false;
  const double value = gGetSharedSignal(gRuntimeState, signalId, &found);
  if (!found || !std::isfinite(value)) {
    return fallback;
  }
  if (resolved) *resolved = true;
  return value;
}

void normalizeUniqueIds(std::vector<int> &ids) {
  std::sort(ids.begin(), ids.end());
  ids.erase(std::unique(ids.begin(), ids.end()), ids.end());
}

void removeSurfaceSignalSubscriptionsLocked(int nodeId) {
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

void updateSurfaceSignalSubscriptions(int nodeId, std::vector<int> ids) {
  normalizeUniqueIds(ids);
  std::lock_guard<std::mutex> lock(gSignalSubscriptionMutex);
  removeSurfaceSignalSubscriptionsLocked(nodeId);
  if (ids.empty()) return;
  gSurfaceSignalIds[nodeId] = ids;
  for (int signalId : ids) {
    auto &nodes = gSignalSurfaceIds[signalId];
    nodes.push_back(nodeId);
    normalizeUniqueIds(nodes);
  }
}

bool consumePackedHeader(const std::vector<double> &ops, size_t &index, bool &taggedScalars) {
  taggedScalars = false;
  if (ops.size() < 2) return true;
  const int maybeMagic = static_cast<int>(ops[0]);
  if (maybeMagic != kPackedStreamMagic) return true;
  const int version = static_cast<int>(ops[1]);
  index = 2;
  taggedScalars = version >= kPackedStreamVersion;
  return true;
}

float readPackedScalar(
    const std::vector<double> &ops,
    size_t &index,
    bool taggedScalars,
    float fallback = 0.0f) {
  if (index >= ops.size()) return fallback;
  if (!taggedScalars) {
    return static_cast<float>(ops[index++]);
  }

  const int kind = static_cast<int>(ops[index++]);
  if (kind == kPackedScalarLiteral) {
    if (index >= ops.size()) return fallback;
    return static_cast<float>(ops[index++]);
  }
  if (kind == kPackedScalarSharedSignal) {
    if (index + 1 >= ops.size()) return fallback;
    const int signalId = static_cast<int>(ops[index++]);
    const double snapshot = ops[index++];
    if (gSignalCollector && signalId > 0) {
      gSignalCollector->push_back(signalId);
    }
    const double resolved = resolveSharedSignalValue(signalId, snapshot);
    return static_cast<float>(resolved);
  }
  if (kind == kPackedScalarInterpolation) {
    if (index + 3 >= ops.size()) return fallback;
    const int signalId = static_cast<int>(ops[index++]);
    const double snapshot = ops[index++];
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
    const int leftMode = static_cast<int>(ops[index++]);
    const int rightMode = static_cast<int>(ops[index++]);

    if (gSignalCollector && signalId > 0) {
      gSignalCollector->push_back(signalId);
    }
    const double source = resolveSharedSignalValue(signalId, snapshot);
    if (!std::isfinite(source)) return fallback;

    if (source <= inputRange.front()) {
      if (leftMode == kExtrapolateIdentity) return static_cast<float>(source);
      if (leftMode == kExtrapolateClamp) return static_cast<float>(outputRange.front());
    }
    if (source >= inputRange.back()) {
      if (rightMode == kExtrapolateIdentity) return static_cast<float>(source);
      if (rightMode == kExtrapolateClamp) return static_cast<float>(outputRange.back());
    }

    int segment = 0;
    for (int i = 0; i < count - 1; i += 1) {
      const double start = inputRange[static_cast<size_t>(i)];
      const double end = inputRange[static_cast<size_t>(i + 1)];
      if (source >= start && source <= end) {
        segment = i;
        break;
      }
      if (source > end) {
        segment = i;
      }
    }

    const double inMin = inputRange[static_cast<size_t>(segment)];
    const double inMax = inputRange[static_cast<size_t>(segment + 1)];
    const double outMin = outputRange[static_cast<size_t>(segment)];
    const double outMax = outputRange[static_cast<size_t>(segment + 1)];
    const double span = inMax - inMin;
    if (!std::isfinite(span) || span == 0.0) return static_cast<float>(outMin);
    const double t = (source - inMin) / span;
    return static_cast<float>(outMin + (outMax - outMin) * t);
  }
  return fallback;
}

sk_sp<SkData> buildRuntimeUniformData(
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

sk_sp<SkRuntimeEffect> getCachedRuntimeEffect(const std::string &source) {
  if (source.empty()) return nullptr;
  {
    std::lock_guard<std::mutex> lock(gRuntimeEffectCacheMutex);
    const auto found = gRuntimeEffectCache.find(source);
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

SkPaint::Cap decodeStrokeCap(int cap) {
  switch (cap) {
    case kStrokeCapRound:
      return SkPaint::kRound_Cap;
    case kStrokeCapSquare:
      return SkPaint::kSquare_Cap;
    case kStrokeCapButt:
    default:
      return SkPaint::kButt_Cap;
  }
}

SkPaint::Join decodeStrokeJoin(int join) {
  switch (join) {
    case kStrokeJoinRound:
      return SkPaint::kRound_Join;
    case kStrokeJoinBevel:
      return SkPaint::kBevel_Join;
    case kStrokeJoinMiter:
    default:
      return SkPaint::kMiter_Join;
  }
}

void configurePaint(
    SkPaint &paint,
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
  paint.setStyle(style == kStyleStroke ? SkPaint::kStroke_Style : SkPaint::kFill_Style);
  paint.setStrokeCap(decodeStrokeCap(strokeCap));
  paint.setStrokeJoin(decodeStrokeJoin(strokeJoin));
  paint.setStrokeMiter(strokeMiter);
}

int normalizeFontWeight(const std::string &weight) {
  if (weight.empty() || weight == "normal") return 400;
  if (weight == "bold") return 700;
  try {
    int parsed = std::stoi(weight);
    parsed = std::max(100, std::min(900, parsed));
    return (parsed / 100) * 100;
  } catch (...) {
    return 400;
  }
}

SkFontStyle::Slant normalizeFontSlant(const std::string &style) {
  if (style == "italic" || style == "oblique") {
    return SkFontStyle::kItalic_Slant;
  }
  return SkFontStyle::kUpright_Slant;
}

sk_sp<SkTypeface> resolveTypeface(
    const std::string &familyName,
    const std::string &fontStyle,
    const std::string &fontWeight) {
  if (!familyName.empty()) {
    std::lock_guard<std::mutex> lock(gTypefaceCacheMutex);
    auto it = gTypefaceCache.find(familyName);
    if (it != gTypefaceCache.end()) {
      return it->second;
    }
  }

  auto fontMgr = getSystemFontMgr();
  if (fontMgr) {
    SkFontStyle style(
        normalizeFontWeight(fontWeight),
        SkFontStyle::kNormal_Width,
        normalizeFontSlant(fontStyle));
    return fontMgr->matchFamilyStyle(familyName.empty() ? nullptr : familyName.c_str(), style);
  }
  return nullptr;
}

bool renderSurfaceState(
    const SurfaceState::CommandBuffer &buffer,
    SkCanvas *canvas,
    float density,
    SkColor clearColor,
    std::vector<int> *usedSignalIds = nullptr) {
  if (!canvas) return false;
  canvas->clear(clearColor);
  const float scale = density > 0.0f ? density : 1.0f;
  canvas->save();
  canvas->scale(scale, scale);
  std::vector<int> *previousCollector = gSignalCollector;
  gSignalCollector = usedSignalIds;

  size_t i = 0;
  bool taggedScalars = false;
  consumePackedHeader(buffer.ops, i, taggedScalars);
  while (i < buffer.ops.size()) {
    const int opcode = static_cast<int>(buffer.ops[i++]);

    if (opcode == kOpcodeClear) {
      canvas->clear(readPackedColor(buffer, buffer.ops, i));
      continue;
    }

    if (opcode == kOpcodeRect) {
      const float x = readPackedScalar(buffer.ops, i, taggedScalars);
      const float y = readPackedScalar(buffer.ops, i, taggedScalars);
      const float w = readPackedScalar(buffer.ops, i, taggedScalars);
      const float h = readPackedScalar(buffer.ops, i, taggedScalars);
      const SkColor color = readPackedColor(buffer, buffer.ops, i);
      const float strokeWidth = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      if (i + 2 >= buffer.ops.size()) break;
      const int style = static_cast<int>(buffer.ops[i++]);
      const bool antiAlias = static_cast<int>(buffer.ops[i++]) != 0;
      const float opacity = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      if (i + 1 >= buffer.ops.size()) break;
      const int strokeCap = static_cast<int>(buffer.ops[i++]);
      const int strokeJoin = static_cast<int>(buffer.ops[i++]);
      const float strokeMiter = readPackedScalar(buffer.ops, i, taggedScalars, 4.0f);

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

    if (opcode == kOpcodeCircle) {
      const float cx = readPackedScalar(buffer.ops, i, taggedScalars);
      const float cy = readPackedScalar(buffer.ops, i, taggedScalars);
      const float r = readPackedScalar(buffer.ops, i, taggedScalars);
      const SkColor color = readPackedColor(buffer, buffer.ops, i);
      const float strokeWidth = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      if (i + 2 >= buffer.ops.size()) break;
      const int style = static_cast<int>(buffer.ops[i++]);
      const bool antiAlias = static_cast<int>(buffer.ops[i++]) != 0;
      const float opacity = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      if (i + 1 >= buffer.ops.size()) break;
      const int strokeCap = static_cast<int>(buffer.ops[i++]);
      const int strokeJoin = static_cast<int>(buffer.ops[i++]);
      const float strokeMiter = readPackedScalar(buffer.ops, i, taggedScalars, 4.0f);

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

    if (opcode == kOpcodeLine) {
      const float x1 = readPackedScalar(buffer.ops, i, taggedScalars);
      const float y1 = readPackedScalar(buffer.ops, i, taggedScalars);
      const float x2 = readPackedScalar(buffer.ops, i, taggedScalars);
      const float y2 = readPackedScalar(buffer.ops, i, taggedScalars);
      const SkColor color = readPackedColor(buffer, buffer.ops, i);
      const float strokeWidth = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      if (i + 1 >= buffer.ops.size()) break;
      const bool antiAlias = static_cast<int>(buffer.ops[i++]) != 0;
      const float opacity = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      if (i + 1 >= buffer.ops.size()) break;
      const int strokeCap = static_cast<int>(buffer.ops[i++]);
      const int strokeJoin = static_cast<int>(buffer.ops[i++]);
      const float strokeMiter = readPackedScalar(buffer.ops, i, taggedScalars, 4.0f);

      SkPaint paint;
      configurePaint(
          paint,
          color,
          strokeWidth,
          kStyleStroke,
          antiAlias,
          opacity,
          strokeCap,
          strokeJoin,
          strokeMiter);
      canvas->drawLine(x1, y1, x2, y2, paint);
      continue;
    }

    if (opcode == kOpcodePath) {
      const SkColor color = readPackedColor(buffer, buffer.ops, i);
      const float strokeWidth = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      if (i + 2 >= buffer.ops.size()) break;
      const int style = static_cast<int>(buffer.ops[i++]);
      const bool antiAlias = static_cast<int>(buffer.ops[i++]) != 0;
      const float opacity = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      if (i + 1 >= buffer.ops.size()) break;
      const int strokeCap = static_cast<int>(buffer.ops[i++]);
      const int strokeJoin = static_cast<int>(buffer.ops[i++]);
      const float strokeMiter = readPackedScalar(buffer.ops, i, taggedScalars, 4.0f);
      if (i >= buffer.ops.size()) break;
      const int commandCount = static_cast<int>(buffer.ops[i++]);
      if (commandCount < 0) break;

      SkPath path;
      for (int cmd = 0; cmd < commandCount; cmd += 1) {
        if (i >= buffer.ops.size()) break;
        const int verb = static_cast<int>(buffer.ops[i++]);

        if (verb == kPathVerbMoveTo || verb == kPathVerbLineTo) {
          const float x = readPackedScalar(buffer.ops, i, taggedScalars);
          const float y = readPackedScalar(buffer.ops, i, taggedScalars);
          if (verb == kPathVerbMoveTo) {
            path.moveTo(x, y);
          } else {
            path.lineTo(x, y);
          }
          continue;
        }

        if (verb == kPathVerbQuadTo) {
          const float cpx = readPackedScalar(buffer.ops, i, taggedScalars);
          const float cpy = readPackedScalar(buffer.ops, i, taggedScalars);
          const float x = readPackedScalar(buffer.ops, i, taggedScalars);
          const float y = readPackedScalar(buffer.ops, i, taggedScalars);
          path.quadTo(cpx, cpy, x, y);
          continue;
        }

        if (verb == kPathVerbCubicTo) {
          const float cp1x = readPackedScalar(buffer.ops, i, taggedScalars);
          const float cp1y = readPackedScalar(buffer.ops, i, taggedScalars);
          const float cp2x = readPackedScalar(buffer.ops, i, taggedScalars);
          const float cp2y = readPackedScalar(buffer.ops, i, taggedScalars);
          const float x = readPackedScalar(buffer.ops, i, taggedScalars);
          const float y = readPackedScalar(buffer.ops, i, taggedScalars);
          path.cubicTo(cp1x, cp1y, cp2x, cp2y, x, y);
          continue;
        }

        if (verb == kPathVerbClose) {
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

    if (opcode == kOpcodeText) {
      const float x = readPackedScalar(buffer.ops, i, taggedScalars);
      const float y = readPackedScalar(buffer.ops, i, taggedScalars);
      const SkColor color = readPackedColor(buffer, buffer.ops, i);
      const float fontSize = readPackedScalar(buffer.ops, i, taggedScalars, 14.0f);
      if (i + 5 >= buffer.ops.size()) break;
      const bool antiAlias = static_cast<int>(buffer.ops[i++]) != 0;
      const float opacity = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      const int familyIndex = static_cast<int>(buffer.ops[i++]);
      const int styleIndex = static_cast<int>(buffer.ops[i++]);
      const int weightIndex = static_cast<int>(buffer.ops[i++]);
      const int textIndex = static_cast<int>(buffer.ops[i++]);
      const bool hasMatrix = static_cast<int>(buffer.ops[i++]) != 0;

      const std::string *familyPtr = readPackedString(buffer, familyIndex);
      const std::string *stylePtr = readPackedString(buffer, styleIndex);
      const std::string *weightPtr = readPackedString(buffer, weightIndex);
      const std::string *textPtr = readPackedString(buffer, textIndex);
      if (!textPtr) {
        continue;
      }

      sk_sp<SkTypeface> typeface = resolveTypeface(
          familyPtr ? *familyPtr : std::string(),
          stylePtr ? *stylePtr : std::string("normal"),
          weightPtr ? *weightPtr : std::string("normal"));

      if (hasMatrix) {
        if (i + 5 >= buffer.ops.size()) break;
        const float a = static_cast<float>(buffer.ops[i++]);
        const float b = static_cast<float>(buffer.ops[i++]);
        const float c = static_cast<float>(buffer.ops[i++]);
        const float d = static_cast<float>(buffer.ops[i++]);
        const float tx = static_cast<float>(buffer.ops[i++]);
        const float ty = static_cast<float>(buffer.ops[i++]);
        const SkMatrix matrix = SkMatrix::MakeAll(a, c, tx, b, d, ty, 0, 0, 1);
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

    if (opcode == kOpcodeRuntimeShaderRect) {
      const float x = readPackedScalar(buffer.ops, i, taggedScalars);
      const float y = readPackedScalar(buffer.ops, i, taggedScalars);
      const float w = readPackedScalar(buffer.ops, i, taggedScalars);
      const float h = readPackedScalar(buffer.ops, i, taggedScalars);
      if (i >= buffer.ops.size()) break;
      const bool antiAlias = static_cast<int>(buffer.ops[i++]) != 0;
      const float opacity = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      if (i + 1 >= buffer.ops.size()) break;
      const int sourceIndex = static_cast<int>(buffer.ops[i++]);
      const int uniformCount = static_cast<int>(buffer.ops[i++]);
      if (uniformCount < 0) break;

      const std::string *sourcePtr = readPackedString(buffer, sourceIndex);
      if (!sourcePtr) {
        continue;
      }

      std::unordered_map<std::string, std::vector<float>> uniforms;
      for (int uniformIndex = 0; uniformIndex < uniformCount; uniformIndex += 1) {
        if (i + 1 >= buffer.ops.size()) break;
        const int nameIndex = static_cast<int>(buffer.ops[i++]);
        const int valueCount = static_cast<int>(buffer.ops[i++]);
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

    if (opcode == kOpcodeRuntimeShaderCircle) {
      const float cx = readPackedScalar(buffer.ops, i, taggedScalars);
      const float cy = readPackedScalar(buffer.ops, i, taggedScalars);
      const float r = readPackedScalar(buffer.ops, i, taggedScalars);
      if (i >= buffer.ops.size()) break;
      const bool antiAlias = static_cast<int>(buffer.ops[i++]) != 0;
      const float opacity = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      if (i + 1 >= buffer.ops.size()) break;
      const int sourceIndex = static_cast<int>(buffer.ops[i++]);
      const int uniformCount = static_cast<int>(buffer.ops[i++]);
      if (uniformCount < 0) break;

      const std::string *sourcePtr = readPackedString(buffer, sourceIndex);
      if (!sourcePtr) {
        continue;
      }

      std::unordered_map<std::string, std::vector<float>> uniforms;
      for (int uniformIndex = 0; uniformIndex < uniformCount; uniformIndex += 1) {
        if (i + 1 >= buffer.ops.size()) break;
        const int nameIndex = static_cast<int>(buffer.ops[i++]);
        const int valueCount = static_cast<int>(buffer.ops[i++]);
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

    if (opcode == kOpcodeRuntimeShaderPath) {
      if (i + 2 >= buffer.ops.size()) break;
      const bool antiAlias = static_cast<int>(buffer.ops[i++]) != 0;
      const float opacity = readPackedScalar(buffer.ops, i, taggedScalars, 1.0f);
      if (i + 1 >= buffer.ops.size()) break;
      const int sourceIndex = static_cast<int>(buffer.ops[i++]);
      const int uniformCount = static_cast<int>(buffer.ops[i++]);
      if (uniformCount < 0) break;

      const std::string *sourcePtr = readPackedString(buffer, sourceIndex);
      if (!sourcePtr) {
        continue;
      }

      std::unordered_map<std::string, std::vector<float>> uniforms;
      for (int uniformIndex = 0; uniformIndex < uniformCount; uniformIndex += 1) {
        if (i + 1 >= buffer.ops.size()) break;
        const int nameIndex = static_cast<int>(buffer.ops[i++]);
        const int valueCount = static_cast<int>(buffer.ops[i++]);
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
      const int commandCount = static_cast<int>(buffer.ops[i++]);
      if (commandCount < 0) break;
      SkPath path;
      for (int cmd = 0; cmd < commandCount; cmd += 1) {
        if (i >= buffer.ops.size()) break;
        const int verb = static_cast<int>(buffer.ops[i++]);
        if (verb == kPathVerbMoveTo || verb == kPathVerbLineTo) {
          const float x = readPackedScalar(buffer.ops, i, taggedScalars);
          const float y = readPackedScalar(buffer.ops, i, taggedScalars);
          if (verb == kPathVerbMoveTo) {
            path.moveTo(x, y);
          } else {
            path.lineTo(x, y);
          }
          continue;
        }
        if (verb == kPathVerbQuadTo) {
          const float cpx = readPackedScalar(buffer.ops, i, taggedScalars);
          const float cpy = readPackedScalar(buffer.ops, i, taggedScalars);
          const float x = readPackedScalar(buffer.ops, i, taggedScalars);
          const float y = readPackedScalar(buffer.ops, i, taggedScalars);
          path.quadTo(cpx, cpy, x, y);
          continue;
        }
        if (verb == kPathVerbCubicTo) {
          const float cp1x = readPackedScalar(buffer.ops, i, taggedScalars);
          const float cp1y = readPackedScalar(buffer.ops, i, taggedScalars);
          const float cp2x = readPackedScalar(buffer.ops, i, taggedScalars);
          const float cp2y = readPackedScalar(buffer.ops, i, taggedScalars);
          const float x = readPackedScalar(buffer.ops, i, taggedScalars);
          const float y = readPackedScalar(buffer.ops, i, taggedScalars);
          path.cubicTo(cp1x, cp1y, cp2x, cp2y, x, y);
          continue;
        }
        if (verb == kPathVerbClose) {
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

  canvas->restore();
  gSignalCollector = previousCollector;
  if (usedSignalIds) {
    normalizeUniqueIds(*usedSignalIds);
  }
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
      const Value antiAlias = command.getProperty(rt, "antiAlias");
      outOps.push_back(antiAlias.isBool() ? (antiAlias.getBool() ? 1.0 : 0.0) : 1.0);
      outOps.push_back(readNumberProp(rt, command, "opacity", 1));
      const std::string strokeCap = readStringProp(rt, command, "strokeCap", "butt");
      outOps.push_back(
          static_cast<double>(
              strokeCap == "round" ? kStrokeCapRound
                                    : (strokeCap == "square" ? kStrokeCapSquare : kStrokeCapButt)));
      const std::string strokeJoin = readStringProp(rt, command, "strokeJoin", "miter");
      outOps.push_back(
          static_cast<double>(
              strokeJoin == "round" ? kStrokeJoinRound
                                     : (strokeJoin == "bevel" ? kStrokeJoinBevel : kStrokeJoinMiter)));
      outOps.push_back(readNumberProp(rt, command, "strokeMiter", 4));
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
      const Value antiAlias = command.getProperty(rt, "antiAlias");
      outOps.push_back(antiAlias.isBool() ? (antiAlias.getBool() ? 1.0 : 0.0) : 1.0);
      outOps.push_back(readNumberProp(rt, command, "opacity", 1));
      const std::string strokeCap = readStringProp(rt, command, "strokeCap", "butt");
      outOps.push_back(
          static_cast<double>(
              strokeCap == "round" ? kStrokeCapRound
                                    : (strokeCap == "square" ? kStrokeCapSquare : kStrokeCapButt)));
      const std::string strokeJoin = readStringProp(rt, command, "strokeJoin", "miter");
      outOps.push_back(
          static_cast<double>(
              strokeJoin == "round" ? kStrokeJoinRound
                                     : (strokeJoin == "bevel" ? kStrokeJoinBevel : kStrokeJoinMiter)));
      outOps.push_back(readNumberProp(rt, command, "strokeMiter", 4));
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
      const Value antiAlias = command.getProperty(rt, "antiAlias");
      outOps.push_back(antiAlias.isBool() ? (antiAlias.getBool() ? 1.0 : 0.0) : 1.0);
      outOps.push_back(readNumberProp(rt, command, "opacity", 1));
      const std::string strokeCap = readStringProp(rt, command, "strokeCap", "butt");
      outOps.push_back(
          static_cast<double>(
              strokeCap == "round" ? kStrokeCapRound
                                    : (strokeCap == "square" ? kStrokeCapSquare : kStrokeCapButt)));
      const std::string strokeJoin = readStringProp(rt, command, "strokeJoin", "miter");
      outOps.push_back(
          static_cast<double>(
              strokeJoin == "round" ? kStrokeJoinRound
                                     : (strokeJoin == "bevel" ? kStrokeJoinBevel : kStrokeJoinMiter)));
      outOps.push_back(readNumberProp(rt, command, "strokeMiter", 4));
      continue;
    }

    if (type == "path") {
      Value pathCommandsValue = command.getProperty(rt, "commands");
      if (!pathCommandsValue.isObject()) continue;
      Object pathCommandsObject = pathCommandsValue.asObject(rt);
      if (!pathCommandsObject.isArray(rt)) continue;
      Array pathCommands = pathCommandsObject.asArray(rt);

      outOps.push_back(static_cast<double>(kOpcodePath));
      pushPackedColor(outOps, outStrings, stringIndex, readStringProp(rt, command, "color"));
      outOps.push_back(readNumberProp(rt, command, "strokeWidth", 1));
      const std::string style = readStringProp(rt, command, "style", "fill");
      outOps.push_back(static_cast<double>(style == "stroke" ? kStyleStroke : kStyleFill));
      const Value antiAlias = command.getProperty(rt, "antiAlias");
      outOps.push_back(antiAlias.isBool() ? (antiAlias.getBool() ? 1.0 : 0.0) : 1.0);
      outOps.push_back(readNumberProp(rt, command, "opacity", 1));
      const std::string strokeCap = readStringProp(rt, command, "strokeCap", "butt");
      outOps.push_back(
          static_cast<double>(
              strokeCap == "round" ? kStrokeCapRound
                                    : (strokeCap == "square" ? kStrokeCapSquare : kStrokeCapButt)));
      const std::string strokeJoin = readStringProp(rt, command, "strokeJoin", "miter");
      outOps.push_back(
          static_cast<double>(
              strokeJoin == "round" ? kStrokeJoinRound
                                     : (strokeJoin == "bevel" ? kStrokeJoinBevel : kStrokeJoinMiter)));
      outOps.push_back(readNumberProp(rt, command, "strokeMiter", 4));

      const size_t pathCommandCount = pathCommands.length(rt);
      outOps.push_back(static_cast<double>(pathCommandCount));
      for (size_t pathIndex = 0; pathIndex < pathCommandCount; pathIndex += 1) {
        Value pathCommandValue = pathCommands.getValueAtIndex(rt, pathIndex);
        if (!pathCommandValue.isObject()) continue;
        Object pathCommand = pathCommandValue.asObject(rt);
        const std::string pathType = readStringProp(rt, pathCommand, "type");

        if (pathType == "moveTo") {
          outOps.push_back(static_cast<double>(kPathVerbMoveTo));
          outOps.push_back(readNumberProp(rt, pathCommand, "x", 0));
          outOps.push_back(readNumberProp(rt, pathCommand, "y", 0));
          continue;
        }
        if (pathType == "lineTo") {
          outOps.push_back(static_cast<double>(kPathVerbLineTo));
          outOps.push_back(readNumberProp(rt, pathCommand, "x", 0));
          outOps.push_back(readNumberProp(rt, pathCommand, "y", 0));
          continue;
        }
        if (pathType == "quadTo") {
          outOps.push_back(static_cast<double>(kPathVerbQuadTo));
          outOps.push_back(readNumberProp(rt, pathCommand, "cpx", 0));
          outOps.push_back(readNumberProp(rt, pathCommand, "cpy", 0));
          outOps.push_back(readNumberProp(rt, pathCommand, "x", 0));
          outOps.push_back(readNumberProp(rt, pathCommand, "y", 0));
          continue;
        }
        if (pathType == "cubicTo") {
          outOps.push_back(static_cast<double>(kPathVerbCubicTo));
          outOps.push_back(readNumberProp(rt, pathCommand, "cp1x", 0));
          outOps.push_back(readNumberProp(rt, pathCommand, "cp1y", 0));
          outOps.push_back(readNumberProp(rt, pathCommand, "cp2x", 0));
          outOps.push_back(readNumberProp(rt, pathCommand, "cp2y", 0));
          outOps.push_back(readNumberProp(rt, pathCommand, "x", 0));
          outOps.push_back(readNumberProp(rt, pathCommand, "y", 0));
          continue;
        }
        if (pathType == "close") {
          outOps.push_back(static_cast<double>(kPathVerbClose));
        }
      }
      continue;
    }

    if (type == "text") {
      outOps.push_back(static_cast<double>(kOpcodeText));
      outOps.push_back(readNumberProp(rt, command, "x", 0));
      outOps.push_back(readNumberProp(rt, command, "y", 0));
      pushPackedColor(outOps, outStrings, stringIndex, readStringProp(rt, command, "color"));
      outOps.push_back(readNumberProp(rt, command, "fontSize", 14));
      const Value antiAlias = command.getProperty(rt, "antiAlias");
      outOps.push_back(antiAlias.isBool() ? (antiAlias.getBool() ? 1.0 : 0.0) : 1.0);
      outOps.push_back(readNumberProp(rt, command, "opacity", 1));

      const int familyIndex = addString(outStrings, stringIndex, readStringProp(rt, command, "fontFamily"));
      const int styleIndex = addString(outStrings, stringIndex, readStringProp(rt, command, "fontStyle", "normal"));
      Value fontWeight = command.getProperty(rt, "fontWeight");
      const std::string weight = fontWeight.isString()
        ? fontWeight.asString(rt).utf8(rt)
        : (fontWeight.isNumber() ? std::to_string(static_cast<int>(fontWeight.asNumber())) : std::string("normal"));
      const int weightIndex = addString(outStrings, stringIndex, weight);
      const int textIndex = addString(outStrings, stringIndex, readStringProp(rt, command, "text"));
      outOps.push_back(static_cast<double>(familyIndex));
      outOps.push_back(static_cast<double>(styleIndex));
      outOps.push_back(static_cast<double>(weightIndex));
      outOps.push_back(static_cast<double>(textIndex));

      Value matrixValue = command.getProperty(rt, "matrix");
      if (matrixValue.isObject()) {
        Object matrixObject = matrixValue.asObject(rt);
        if (matrixObject.isArray(rt)) {
          Array matrix = matrixObject.asArray(rt);
          if (matrix.length(rt) == 6) {
            outOps.push_back(1.0);
            for (size_t m = 0; m < 6; m += 1) {
              Value entry = matrix.getValueAtIndex(rt, m);
              outOps.push_back(entry.isNumber() ? entry.asNumber() : 0.0);
            }
            continue;
          }
        }
      }
      outOps.push_back(0.0);
      continue;
    }

    if (type == "runtimeShaderRect") {
      outOps.push_back(static_cast<double>(kOpcodeRuntimeShaderRect));
      outOps.push_back(readNumberProp(rt, command, "x", 0));
      outOps.push_back(readNumberProp(rt, command, "y", 0));
      outOps.push_back(readNumberProp(rt, command, "width", 0));
      outOps.push_back(readNumberProp(rt, command, "height", 0));
      const Value antiAlias = command.getProperty(rt, "antiAlias");
      outOps.push_back(antiAlias.isBool() ? (antiAlias.getBool() ? 1.0 : 0.0) : 1.0);
      outOps.push_back(readNumberProp(rt, command, "opacity", 1));

      const std::string source = readStringProp(rt, command, "source", "");
      const int sourceIndex = addString(outStrings, stringIndex, source);
      outOps.push_back(static_cast<double>(sourceIndex));

      Value uniformsValue = command.getProperty(rt, "uniforms");
      if (!uniformsValue.isObject()) {
        outOps.push_back(0.0);
        continue;
      }
      Object uniformsObject = uniformsValue.asObject(rt);
      Array names = uniformsObject.getPropertyNames(rt);
      const size_t nameCount = names.length(rt);
      outOps.push_back(static_cast<double>(nameCount));

      for (size_t uniformIndex = 0; uniformIndex < nameCount; uniformIndex += 1) {
        Value nameValue = names.getValueAtIndex(rt, uniformIndex);
        if (!nameValue.isString()) {
          outOps.push_back(-1.0);
          outOps.push_back(0.0);
          continue;
        }
        const std::string name = nameValue.asString(rt).utf8(rt);
        const int nameIndex = addString(outStrings, stringIndex, name);
        outOps.push_back(static_cast<double>(nameIndex));

        Value uniformValue = uniformsObject.getProperty(rt, name.c_str());
        if (uniformValue.isNumber()) {
          outOps.push_back(1.0);
          outOps.push_back(uniformValue.asNumber());
          continue;
        }

        if (uniformValue.isObject()) {
          Object uniformObject = uniformValue.asObject(rt);
          if (uniformObject.isArray(rt)) {
            Array uniformArray = uniformObject.asArray(rt);
            const size_t uniformLength = uniformArray.length(rt);
            outOps.push_back(static_cast<double>(uniformLength));
            for (size_t valueIndex = 0; valueIndex < uniformLength; valueIndex += 1) {
              Value element = uniformArray.getValueAtIndex(rt, valueIndex);
              outOps.push_back(element.isNumber() ? element.asNumber() : 0.0);
            }
            continue;
          }
        }

        outOps.push_back(0.0);
      }
      continue;
    }

    if (type == "runtimeShaderCircle") {
      outOps.push_back(static_cast<double>(kOpcodeRuntimeShaderCircle));
      outOps.push_back(readNumberProp(rt, command, "cx", 0));
      outOps.push_back(readNumberProp(rt, command, "cy", 0));
      outOps.push_back(readNumberProp(rt, command, "r", 0));
      const Value antiAlias = command.getProperty(rt, "antiAlias");
      outOps.push_back(antiAlias.isBool() ? (antiAlias.getBool() ? 1.0 : 0.0) : 1.0);
      outOps.push_back(readNumberProp(rt, command, "opacity", 1));

      const std::string source = readStringProp(rt, command, "source", "");
      const int sourceIndex = addString(outStrings, stringIndex, source);
      outOps.push_back(static_cast<double>(sourceIndex));

      Value uniformsValue = command.getProperty(rt, "uniforms");
      if (!uniformsValue.isObject()) {
        outOps.push_back(0.0);
        continue;
      }
      Object uniformsObject = uniformsValue.asObject(rt);
      Array names = uniformsObject.getPropertyNames(rt);
      const size_t nameCount = names.length(rt);
      outOps.push_back(static_cast<double>(nameCount));

      for (size_t uniformIndex = 0; uniformIndex < nameCount; uniformIndex += 1) {
        Value nameValue = names.getValueAtIndex(rt, uniformIndex);
        if (!nameValue.isString()) {
          outOps.push_back(-1.0);
          outOps.push_back(0.0);
          continue;
        }
        const std::string name = nameValue.asString(rt).utf8(rt);
        const int nameIndex = addString(outStrings, stringIndex, name);
        outOps.push_back(static_cast<double>(nameIndex));

        Value uniformValue = uniformsObject.getProperty(rt, name.c_str());
        if (uniformValue.isNumber()) {
          outOps.push_back(1.0);
          outOps.push_back(uniformValue.asNumber());
          continue;
        }

        if (uniformValue.isObject()) {
          Object uniformObject = uniformValue.asObject(rt);
          if (uniformObject.isArray(rt)) {
            Array uniformArray = uniformObject.asArray(rt);
            const size_t uniformLength = uniformArray.length(rt);
            outOps.push_back(static_cast<double>(uniformLength));
            for (size_t valueIndex = 0; valueIndex < uniformLength; valueIndex += 1) {
              Value element = uniformArray.getValueAtIndex(rt, valueIndex);
              outOps.push_back(element.isNumber() ? element.asNumber() : 0.0);
            }
            continue;
          }
        }

        outOps.push_back(0.0);
      }
      continue;
    }

    if (type == "runtimeShaderPath") {
      outOps.push_back(static_cast<double>(kOpcodeRuntimeShaderPath));
      const Value antiAlias = command.getProperty(rt, "antiAlias");
      outOps.push_back(antiAlias.isBool() ? (antiAlias.getBool() ? 1.0 : 0.0) : 1.0);
      outOps.push_back(readNumberProp(rt, command, "opacity", 1));

      const std::string source = readStringProp(rt, command, "source", "");
      const int sourceIndex = addString(outStrings, stringIndex, source);
      outOps.push_back(static_cast<double>(sourceIndex));

      Value uniformsValue = command.getProperty(rt, "uniforms");
      if (!uniformsValue.isObject()) {
        outOps.push_back(0.0);
      } else {
        Object uniformsObject = uniformsValue.asObject(rt);
        Array names = uniformsObject.getPropertyNames(rt);
        const size_t nameCount = names.length(rt);
        outOps.push_back(static_cast<double>(nameCount));

        for (size_t uniformIndex = 0; uniformIndex < nameCount; uniformIndex += 1) {
          Value nameValue = names.getValueAtIndex(rt, uniformIndex);
          if (!nameValue.isString()) {
            outOps.push_back(-1.0);
            outOps.push_back(0.0);
            continue;
          }
          const std::string name = nameValue.asString(rt).utf8(rt);
          const int nameIndex = addString(outStrings, stringIndex, name);
          outOps.push_back(static_cast<double>(nameIndex));

          Value uniformValue = uniformsObject.getProperty(rt, name.c_str());
          if (uniformValue.isNumber()) {
            outOps.push_back(1.0);
            outOps.push_back(uniformValue.asNumber());
            continue;
          }

          if (uniformValue.isObject()) {
            Object uniformObject = uniformValue.asObject(rt);
            if (uniformObject.isArray(rt)) {
              Array uniformArray = uniformObject.asArray(rt);
              const size_t uniformLength = uniformArray.length(rt);
              outOps.push_back(static_cast<double>(uniformLength));
              for (size_t valueIndex = 0; valueIndex < uniformLength; valueIndex += 1) {
                Value element = uniformArray.getValueAtIndex(rt, valueIndex);
                outOps.push_back(element.isNumber() ? element.asNumber() : 0.0);
              }
              continue;
            }
          }

          outOps.push_back(0.0);
        }
      }

      Value pathCommandsValue = command.getProperty(rt, "commands");
      if (!pathCommandsValue.isObject()) {
        outOps.push_back(0.0);
        continue;
      }
      Object pathCommandsObject = pathCommandsValue.asObject(rt);
      if (!pathCommandsObject.isArray(rt)) {
        outOps.push_back(0.0);
        continue;
      }
      Array pathCommands = pathCommandsObject.asArray(rt);
      const size_t pathCommandCount = pathCommands.length(rt);
      outOps.push_back(static_cast<double>(pathCommandCount));
      for (size_t pathIndex = 0; pathIndex < pathCommandCount; pathIndex += 1) {
        Value pathCommandValue = pathCommands.getValueAtIndex(rt, pathIndex);
        if (!pathCommandValue.isObject()) continue;
        Object pathCommand = pathCommandValue.asObject(rt);
        const std::string pathType = readStringProp(rt, pathCommand, "type");

        if (pathType == "moveTo") {
          outOps.push_back(static_cast<double>(kPathVerbMoveTo));
          outOps.push_back(readNumberProp(rt, pathCommand, "x", 0));
          outOps.push_back(readNumberProp(rt, pathCommand, "y", 0));
          continue;
        }
        if (pathType == "lineTo") {
          outOps.push_back(static_cast<double>(kPathVerbLineTo));
          outOps.push_back(readNumberProp(rt, pathCommand, "x", 0));
          outOps.push_back(readNumberProp(rt, pathCommand, "y", 0));
          continue;
        }
        if (pathType == "quadTo") {
          outOps.push_back(static_cast<double>(kPathVerbQuadTo));
          outOps.push_back(readNumberProp(rt, pathCommand, "cpx", 0));
          outOps.push_back(readNumberProp(rt, pathCommand, "cpy", 0));
          outOps.push_back(readNumberProp(rt, pathCommand, "x", 0));
          outOps.push_back(readNumberProp(rt, pathCommand, "y", 0));
          continue;
        }
        if (pathType == "cubicTo") {
          outOps.push_back(static_cast<double>(kPathVerbCubicTo));
          outOps.push_back(readNumberProp(rt, pathCommand, "cp1x", 0));
          outOps.push_back(readNumberProp(rt, pathCommand, "cp1y", 0));
          outOps.push_back(readNumberProp(rt, pathCommand, "cp2x", 0));
          outOps.push_back(readNumberProp(rt, pathCommand, "cp2y", 0));
          outOps.push_back(readNumberProp(rt, pathCommand, "x", 0));
          outOps.push_back(readNumberProp(rt, pathCommand, "y", 0));
          continue;
        }
        if (pathType == "close") {
          outOps.push_back(static_cast<double>(kPathVerbClose));
        }
      }
      continue;
    }
  }
}

void resolveCoreSymbols() {
  if (gRegisterInstaller && gRegisterSharedSignalChanged && gGetSharedSignal) return;
  void *handle = dlopen("libzynthkit.so", RTLD_NOW | RTLD_GLOBAL);
  if (!handle) {
    __android_log_print(ANDROID_LOG_WARN, kTag, "dlopen(libzynthkit.so) failed: %s", dlerror());
    handle = RTLD_DEFAULT;
  }
  gRegisterInstaller = reinterpret_cast<RegisterInstallerFn>(
      dlsym(handle, "ZynthRegisterJSIPluginInstaller"));
  gRegisterSharedSignalChanged = reinterpret_cast<RegisterSharedSignalChangedFn>(
      dlsym(handle, "ZynthRegisterSharedSignalChangedCallback"));
  gGetSharedSignal = reinterpret_cast<GetSharedSignalFn>(
      dlsym(handle, "ZynthGetSharedSignal"));
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

  auto measureText = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "measureText"),
      5,
      [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 5 || !args[0].isString() || !args[1].isString() || !args[2].isNumber()
            || !args[3].isString() || (!args[4].isString() && !args[4].isNumber())) {
          return Value(0.0);
        }
        const std::string text = args[0].asString(rt).utf8(rt);
        const std::string familyName = args[1].asString(rt).utf8(rt);
        const float fontSize = static_cast<float>(args[2].asNumber());
        const std::string fontStyle = args[3].asString(rt).utf8(rt);
        const std::string fontWeight = args[4].isString()
          ? args[4].asString(rt).utf8(rt)
          : std::to_string(static_cast<int>(args[4].asNumber()));

        sk_sp<SkTypeface> typeface = resolveTypeface(familyName, fontStyle, fontWeight);
        SkFont font;
        font.setSize(std::max(0.0f, fontSize));
        if (typeface) {
          font.setTypeface(typeface);
        }
        font.setSubpixel(true);
        const double width = static_cast<double>(font.measureText(text.data(), text.size(), SkTextEncoding::kUTF8));
        return Value(width);
      });

  auto listFontFamilies = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "listFontFamilies"),
      0,
      [](Runtime &rt, const Value &, const Value *, size_t) -> Value {
        std::vector<std::string> families;
        {
          std::lock_guard<std::mutex> lock(gTypefaceCacheMutex);
          for (const auto &it : gTypefaceCache) {
            families.push_back(it.first);
          }
        }

        auto fontMgr = getSystemFontMgr();
        if (fontMgr) {
          int count = fontMgr->countFamilies();
          for (int i = 0; i < count; i++) {
            SkString name;
            fontMgr->getFamilyName(i, &name);
            families.push_back(name.c_str());
          }
        }

        std::sort(families.begin(), families.end());
        families.erase(std::unique(families.begin(), families.end()), families.end());

        Array result(rt, families.size());
        for (size_t i = 0; i < families.size(); i++) {
          result.setValueAtIndex(rt, i, String::createFromUtf8(rt, families[i]));
        }
        return Value(std::move(result));
      });

  auto registerFont = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "registerFont"),
      2,
      [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isString()) {
          return Value(false);
        }

        const std::string familyName = args[0].asString(rt).utf8(rt);
        sk_sp<SkTypeface> typeface;
        auto fontMgr = getSystemFontMgr();

        if (args[1].isObject() && args[1].asObject(rt).isArrayBuffer(rt)) {
          ArrayBuffer buffer = args[1].asObject(rt).getArrayBuffer(rt);
          auto data = SkData::MakeWithCopy(buffer.data(rt), buffer.size(rt));
          if (data) {
            typeface = fontMgr->makeFromData(data);
          }
        } else if (args[1].isString()) {
          std::string path = args[1].asString(rt).utf8(rt);
          typeface = fontMgr->makeFromFile(path.c_str());
        }

        if (!typeface) {
          return Value(false);
        }

        {
          std::lock_guard<std::mutex> lock(gTypefaceCacheMutex);
          gTypefaceCache[familyName] = std::move(typeface);
        }

        return Value(true);
      });

  Object skia(rt);
  Object capabilities(rt);
  capabilities.setProperty(rt, "paths", Value(true));
  capabilities.setProperty(rt, "pathCurves", Value(true));
  capabilities.setProperty(rt, "paintOpacity", Value(true));
  capabilities.setProperty(rt, "paintStrokeCap", Value(true));
  capabilities.setProperty(rt, "paintStrokeJoin", Value(true));
  capabilities.setProperty(rt, "paintStrokeMiter", Value(true));
  capabilities.setProperty(rt, "groupTransforms", Value(true));
  skia.setProperty(rt, "capabilities", capabilities);
  skia.setProperty(rt, "createSurface", createSurface);
  skia.setProperty(rt, "disposeSurface", disposeSurface);
  skia.setProperty(rt, "submitDrawCommandsPacked", submitPacked);
  skia.setProperty(rt, "submitDrawCommands", submitDrawCommands);
  skia.setProperty(rt, "invalidateSurface", invalidateSurface);
  skia.setProperty(rt, "setFrameLoopEnabled", setFrameLoopEnabled);
  skia.setProperty(rt, "submitFrame", submitFrame);
  skia.setProperty(rt, "measureText", measureText);
  skia.setProperty(rt, "listFontFamilies", listFontFamilies);
  skia.setProperty(rt, "registerFont", registerFont);
  rt.global().setProperty(rt, kSkiaKey, skia);
}

void onSharedSignalChanged(void *state, int signalId) {
  if (signalId <= 0 || state == nullptr || state != gRuntimeState) {
    return;
  }

  std::vector<int> nodeIds;
  {
    std::lock_guard<std::mutex> lock(gSignalSubscriptionMutex);
    auto it = gSignalSurfaceIds.find(signalId);
    if (it != gSignalSurfaceIds.end()) {
      nodeIds = it->second;
    }
  }
  if (nodeIds.empty()) return;

  for (int nodeId : nodeIds) {
    callBoolMethod(gInvalidateSurface, static_cast<jint>(nodeId));
  }
}

void registerInstaller() {
  resolveCoreSymbols();
  if (!gRegisterInstaller) {
    __android_log_print(ANDROID_LOG_WARN, kTag, "JSI plugin registry not available");
    return;
  }
  if (gRegisterSharedSignalChanged && !gSharedSignalCallbackRegistered) {
    gRegisterSharedSignalChanged(onSharedSignalChanged);
    gSharedSignalCallbackRegistered = true;
  }

  gRegisterInstaller([](Runtime &rt, void *state) {
    gRuntimeState = state;
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

  {
    std::lock_guard<std::mutex> lock(gSurfaceMutex);
    SurfaceState state;
    state.front = std::make_shared<SurfaceState::CommandBuffer>();
    gSurfaces[static_cast<int>(nodeId)] = std::move(state);
  }
  updateSurfaceSignalSubscriptions(static_cast<int>(nodeId), {});
  return JNI_TRUE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_dev_zynth_skia_SkiaBridge_nativeDisposeSurface(JNIEnv *env, jclass clazz, jint nodeId) {
  cacheBridgeMethodsFromJavaClass(env, clazz);
  if (nodeId <= 0) {
    __android_log_print(ANDROID_LOG_WARN, kTag, "nativeDisposeSurface invalid nodeId=%d", (int)nodeId);
    return JNI_FALSE;
  }

  {
    std::lock_guard<std::mutex> lock(gSurfaceMutex);
    auto it = gSurfaces.find(static_cast<int>(nodeId));
    if (it != gSurfaces.end()) {
      gSurfaces.erase(it);
    }
  }
  updateSurfaceSignalSubscriptions(static_cast<int>(nodeId), {});
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
  std::vector<int> usedSignalIds;

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
      static_cast<SkColor>(static_cast<uint32_t>(clearColor)),
      &usedSignalIds);
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
  updateSurfaceSignalSubscriptions(static_cast<int>(nodeId), std::move(usedSignalIds));
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
  gRuntimeState = nullptr;
  gRegisterInstaller = nullptr;
  gRegisterSharedSignalChanged = nullptr;
  gGetSharedSignal = nullptr;
  gSharedSignalCallbackRegistered = false;

  {
    std::lock_guard<std::mutex> lock(gSurfaceMutex);
    gSurfaces.clear();
  }
  {
    std::lock_guard<std::mutex> subLock(gSignalSubscriptionMutex);
    gSurfaceSignalIds.clear();
    gSignalSurfaceIds.clear();
  }
  {
    std::lock_guard<std::mutex> cacheLock(gRuntimeEffectCacheMutex);
    gRuntimeEffectCache.clear();
  }
}
