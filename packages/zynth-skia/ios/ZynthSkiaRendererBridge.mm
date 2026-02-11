#import "ZynthSkiaRendererBridge.h"

#import <mutex>
#import <memory>
#import <string>
#import <unordered_map>
#import <vector>
#import <algorithm>
#import <cstring>

#import "include/core/SkCanvas.h"
#import "include/core/SkColor.h"
#import "include/core/SkData.h"
#import "include/core/SkImage.h"
#import "include/core/SkImageInfo.h"
#import "include/core/SkPaint.h"
#import "include/core/SkPath.h"
#import "include/core/SkString.h"
#import "include/core/SkSurface.h"
#import "include/effects/SkRuntimeEffect.h"

namespace {

enum PackedOpcode {
  PackedOpcodeClear = 1,
  PackedOpcodeRect = 2,
  PackedOpcodeCircle = 3,
  PackedOpcodeLine = 4,
  PackedOpcodePath = 5,
  PackedOpcodeRuntimeShaderRect = 6,
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

static bool renderSurfaceState(const CommandBuffer &buffer,
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
  while (i < buffer.ops.size()) {
    int opcode = static_cast<int>(buffer.ops[i++]);

    if (opcode == PackedOpcodeClear) {
      SkColor color = readPackedColor(buffer, buffer.ops, i);
      canvas->clear(color);
      continue;
    }

    if (opcode == PackedOpcodeRect) {
      if (i + 5 >= buffer.ops.size()) break;
      float x = static_cast<float>(buffer.ops[i++]);
      float y = static_cast<float>(buffer.ops[i++]);
      float w = static_cast<float>(buffer.ops[i++]);
      float h = static_cast<float>(buffer.ops[i++]);
      SkColor color = readPackedColor(buffer, buffer.ops, i);
      if (i + 6 >= buffer.ops.size()) break;
      float strokeWidth = static_cast<float>(buffer.ops[i++]);
      int style = static_cast<int>(buffer.ops[i++]);
      bool antiAlias = static_cast<int>(buffer.ops[i++]) != 0;
      float opacity = static_cast<float>(buffer.ops[i++]);
      int strokeCap = static_cast<int>(buffer.ops[i++]);
      int strokeJoin = static_cast<int>(buffer.ops[i++]);
      float strokeMiter = static_cast<float>(buffer.ops[i++]);

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
      if (i + 4 >= buffer.ops.size()) break;
      float cx = static_cast<float>(buffer.ops[i++]);
      float cy = static_cast<float>(buffer.ops[i++]);
      float r = static_cast<float>(buffer.ops[i++]);
      SkColor color = readPackedColor(buffer, buffer.ops, i);
      if (i + 6 >= buffer.ops.size()) break;
      float strokeWidth = static_cast<float>(buffer.ops[i++]);
      int style = static_cast<int>(buffer.ops[i++]);
      bool antiAlias = static_cast<int>(buffer.ops[i++]) != 0;
      float opacity = static_cast<float>(buffer.ops[i++]);
      int strokeCap = static_cast<int>(buffer.ops[i++]);
      int strokeJoin = static_cast<int>(buffer.ops[i++]);
      float strokeMiter = static_cast<float>(buffer.ops[i++]);

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
      if (i + 5 >= buffer.ops.size()) break;
      float x1 = static_cast<float>(buffer.ops[i++]);
      float y1 = static_cast<float>(buffer.ops[i++]);
      float x2 = static_cast<float>(buffer.ops[i++]);
      float y2 = static_cast<float>(buffer.ops[i++]);
      SkColor color = readPackedColor(buffer, buffer.ops, i);
      if (i + 4 >= buffer.ops.size()) break;
      float strokeWidth = static_cast<float>(buffer.ops[i++]);
      bool antiAlias = static_cast<int>(buffer.ops[i++]) != 0;
      float opacity = static_cast<float>(buffer.ops[i++]);
      int strokeCap = static_cast<int>(buffer.ops[i++]);
      int strokeJoin = static_cast<int>(buffer.ops[i++]);
      float strokeMiter = static_cast<float>(buffer.ops[i++]);

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
      if (i + 7 >= buffer.ops.size()) break;
      float strokeWidth = static_cast<float>(buffer.ops[i++]);
      int style = static_cast<int>(buffer.ops[i++]);
      bool antiAlias = static_cast<int>(buffer.ops[i++]) != 0;
      float opacity = static_cast<float>(buffer.ops[i++]);
      int strokeCap = static_cast<int>(buffer.ops[i++]);
      int strokeJoin = static_cast<int>(buffer.ops[i++]);
      float strokeMiter = static_cast<float>(buffer.ops[i++]);
      int commandCount = static_cast<int>(buffer.ops[i++]);
      if (commandCount < 0) break;

      SkPath path;
      for (int cmd = 0; cmd < commandCount; cmd += 1) {
        if (i >= buffer.ops.size()) break;
        int verb = static_cast<int>(buffer.ops[i++]);
        if (verb == PackedPathVerbMoveTo || verb == PackedPathVerbLineTo) {
          if (i + 1 >= buffer.ops.size()) break;
          float x = static_cast<float>(buffer.ops[i++]);
          float y = static_cast<float>(buffer.ops[i++]);
          if (verb == PackedPathVerbMoveTo) {
            path.moveTo(x, y);
          } else {
            path.lineTo(x, y);
          }
          continue;
        }
        if (verb == PackedPathVerbQuadTo) {
          if (i + 3 >= buffer.ops.size()) break;
          float cpx = static_cast<float>(buffer.ops[i++]);
          float cpy = static_cast<float>(buffer.ops[i++]);
          float x = static_cast<float>(buffer.ops[i++]);
          float y = static_cast<float>(buffer.ops[i++]);
          path.quadTo(cpx, cpy, x, y);
          continue;
        }
        if (verb == PackedPathVerbCubicTo) {
          if (i + 5 >= buffer.ops.size()) break;
          float cp1x = static_cast<float>(buffer.ops[i++]);
          float cp1y = static_cast<float>(buffer.ops[i++]);
          float cp2x = static_cast<float>(buffer.ops[i++]);
          float cp2y = static_cast<float>(buffer.ops[i++]);
          float x = static_cast<float>(buffer.ops[i++]);
          float y = static_cast<float>(buffer.ops[i++]);
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

    if (opcode == PackedOpcodeRuntimeShaderRect) {
      if (i + 7 >= buffer.ops.size()) break;
      float x = static_cast<float>(buffer.ops[i++]);
      float y = static_cast<float>(buffer.ops[i++]);
      float w = static_cast<float>(buffer.ops[i++]);
      float h = static_cast<float>(buffer.ops[i++]);
      bool antiAlias = static_cast<int>(buffer.ops[i++]) != 0;
      float opacity = static_cast<float>(buffer.ops[i++]);
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
        if (i + static_cast<size_t>(valueCount) > buffer.ops.size()) break;
        const std::string *namePtr = readPackedString(buffer, nameIndex);
        std::vector<float> values;
        values.reserve(static_cast<size_t>(valueCount));
        for (int valueIndex = 0; valueIndex < valueCount; valueIndex += 1) {
          values.push_back(static_cast<float>(buffer.ops[i++]));
        }
        if (namePtr) {
          uniforms[*namePtr] = std::move(values);
        }
      }

      SkRuntimeEffect::Result result = SkRuntimeEffect::MakeForShader(SkString(sourcePtr->c_str()));
      if (!result.effect) {
        continue;
      }

      sk_sp<SkData> uniformData = buildRuntimeUniformData(result.effect, uniforms);
      if (!uniformData) {
        continue;
      }

      sk_sp<SkShader> runtimeShader = result.effect->makeShader(uniformData, nullptr, 0, nullptr);
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
  }

  return true;
}

} // namespace

@implementation ZynthSkiaRendererBridge

+ (BOOL)createSurface:(NSInteger)nodeId {
  if (nodeId <= 0) return NO;
  std::lock_guard<std::mutex> lock(gSkiaMutex);
  SurfaceState state;
  state.front = std::make_shared<CommandBuffer>();
  gSkiaSurfaces[static_cast<int>(nodeId)] = std::move(state);
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
  if (!renderSurfaceState(*buffer,
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
