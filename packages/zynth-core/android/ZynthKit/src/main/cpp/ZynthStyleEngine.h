#pragma once

#include <jsi/jsi.h>
#include <yoga/Yoga.h>
#include <string>
#include <unordered_map>
#include <vector>

namespace zynth {
namespace kit {

enum class StyleProp : int32_t {
  Width = 1,
  Height = 2,
  MinWidth = 3,
  MinHeight = 4,
  MaxWidth = 5,
  MaxHeight = 6,
  Flex = 7,
  FlexGrow = 8,
  FlexShrink = 9,
  FlexBasis = 10,
  FlexDirection = 11,
  FlexWrap = 12,
  JustifyContent = 13,
  AlignItems = 14,
  AlignSelf = 15,
  AlignContent = 16,
  Position = 17,
  Top = 18,
  Right = 19,
  Bottom = 20,
  Left = 21,
  Padding = 22,
  PaddingHorizontal = 23,
  PaddingVertical = 24,
  PaddingTop = 25,
  PaddingRight = 26,
  PaddingBottom = 27,
  PaddingLeft = 28,
  Margin = 29,
  MarginHorizontal = 30,
  MarginVertical = 31,
  MarginTop = 32,
  MarginRight = 33,
  MarginBottom = 34,
  MarginLeft = 35,
  Gap = 36,
  RowGap = 37,
  ColumnGap = 38,
  AspectRatio = 39,
  Overflow = 40,
  Display = 41,
  ZIndex = 42,
  
  // Visual properties
  BackgroundColor = 100,
  Opacity = 101,
  BorderRadius = 102,
  BorderWidth = 103,
  BorderColor = 104,
  ShadowColor = 105,
  ShadowOffset = 106,
  ShadowOpacity = 107,
  ShadowRadius = 108,
  Elevation = 109,
};

class ZynthStyleEngine {
public:
  static void applyStyleProp(YGNodeRef node, StyleProp prop, const facebook::jsi::Value& value, facebook::jsi::Runtime& rt, float density);
  static StyleProp propFromString(const std::string& name);

private:
  static void applyYogaDimension(YGNodeRef node, StyleProp prop, const facebook::jsi::Value& value, facebook::jsi::Runtime& rt, float density);
  static void applyYogaEnum(YGNodeRef node, StyleProp prop, const facebook::jsi::Value& value, facebook::jsi::Runtime& rt);
};

} // namespace kit
} // namespace zynth
