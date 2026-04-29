#pragma once

#include <cstdint>

namespace zynth {

/**
 * @brief Renderer operation codes matching the JS typed payload encoding.
 */
enum class ZynthOpCode : uint8_t {
  SetProp     = 1,
  SetText     = 2,
  InsertChild = 3,
  RemoveChild = 4,
  DropNode    = 5,
  CreateNode  = 6,
  SetSurface  = 7,
};

/**
 * @brief Stable prop identifier enum.
 *
 * Negative key tokens in the JS payload map to these IDs via the formula:
 *   ZynthPropId = static_cast<ZynthPropId>(-keyToken)
 *
 * This table MUST stay synchronized with resolveTypedPropName() in
 * ZynthUIManager.kt and the JS renderer's PROP_TOKENS.
 */
enum class ZynthPropId : uint16_t {
  Unknown            = 0,

  // --- Layout props (mutate Yoga) ---
  Width              = 1,
  Height             = 2,
  MinWidth           = 3,
  MinHeight          = 4,
  MaxWidth           = 5,
  MaxHeight          = 6,
  Flex               = 7,
  FlexGrow           = 8,
  FlexShrink         = 9,
  FlexBasis          = 10,
  Top                = 11,
  Right              = 12,
  Bottom             = 13,
  Left               = 14,
  Padding            = 15,
  PaddingHorizontal  = 16,
  PaddingVertical    = 17,
  PaddingTop         = 18,
  PaddingRight       = 19,
  PaddingBottom      = 20,
  PaddingLeft        = 21,
  Margin             = 22,
  MarginHorizontal   = 23,
  MarginVertical     = 24,
  MarginTop          = 25,
  MarginRight        = 26,
  MarginBottom       = 27,
  MarginLeft         = 28,
  Gap                = 29,
  RowGap             = 30,
  ColumnGap          = 31,
  AspectRatio        = 32,
  FlexDirection      = 33,
  JustifyContent     = 34,
  AlignItems         = 35,
  AlignSelf          = 36,
  AlignContent       = 37,
  FlexWrap           = 38,
  Position           = 39,
  Display            = 40,
  Overflow           = 41,

  // --- View props (do not affect Yoga) ---
  Background         = 42,
  BackgroundImage    = 43,
  BackgroundColor    = 44,
  BorderColor        = 45,
  BorderStyle        = 46,
  BorderRadius       = 47,
  BorderWidth        = 48,
  BorderTopWidth     = 49,
  BorderRightWidth   = 50,
  BorderBottomWidth  = 51,
  BorderLeftWidth    = 52,
  BorderTopLeftRadius     = 53,
  BorderTopRightRadius    = 54,
  BorderBottomRightRadius = 55,
  BorderBottomLeftRadius  = 56,
  Color              = 57,
  FontSize           = 58,
  FontWeight         = 59,
  FontFamily         = 60,
  FontStyle          = 61,
  TextAlign          = 62,
  Opacity            = 63,
  Elevation          = 64,
  ZIndex             = 65,
  Transform          = 66,
  TransformOrigin    = 67,
  ShadowColor        = 68,
  ShadowOpacity      = 69,
  ShadowRadius       = 70,
  ShadowOffset       = 71,
  BoxShadow          = 72,
  LineHeight         = 73,
  LineSpacing        = 74,
  ParagraphSpacing   = 75,
  LetterSpacing      = 76,
  TextDecorationLine = 77,
  TextTransform      = 78,
  MinimumFontScale   = 79,
  BaselineShift      = 80,
  Hyphenation        = 81,
  PointerEvents      = 82,
  AccessibilityLabel = 83,
  AccessibilityHint  = 84,
  AccessibilityRole  = 85,
  TestID             = 86,
  Layout             = 87,
  DelayLongPressMs   = 88,
  DoublePressWindowMs = 89,
  EnableDoublePress  = 90,
  Multiline          = 91,
  NumberOfLines      = 92,
  MaxLength          = 93,
  Editable           = 94,
  SecureTextEntry    = 95,
  InputMode          = 96,
  AutoCapitalize     = 97,
  AutoCorrect        = 98,
  SpellCheck         = 99,
  ReturnKeyType      = 100,
  BlurOnSubmit       = 101,
  SubmitBehavior     = 102,
  EventThrottleMs    = 103,
  AllowProgrammaticJumpDuringEdit = 104,
  Value              = 105,
  DefaultValue       = 106,
  Placeholder        = 107,
  Selection          = 108,
  SelectionColor     = 109,
  CaretColor         = 110,
  ClearButtonMode    = 111,
  ShowClearAccessory  = 112,
  ScrollCommand      = 113,
};

/**
 * @brief Prop classification for routing during commit application.
 */
enum class ZynthPropClass : uint8_t {
  Layout,      ///< Mutates Yoga immediately
  View,        ///< Does not affect Yoga; packed for Kotlin apply
  Text,        ///< Affects text measurement; may dirty Yoga via measured node
  Descriptor,  ///< Component-specific; forwarded to Kotlin descriptors
};

/**
 * @brief Classify a prop by its ID into layout/view/text/descriptor.
 *
 * This is the authoritative classification used by the native commit pipeline.
 */
inline ZynthPropClass classifyProp(ZynthPropId prop) {
  const auto id = static_cast<uint16_t>(prop);

  // Layout props: 1-41
  if (id >= 1 && id <= 41) {
    return ZynthPropClass::Layout;
  }

  // Text/intrinsic props that affect measurement
  switch (prop) {
    case ZynthPropId::Color:
    case ZynthPropId::FontSize:
    case ZynthPropId::FontWeight:
    case ZynthPropId::FontFamily:
    case ZynthPropId::FontStyle:
    case ZynthPropId::TextAlign:
    case ZynthPropId::LineHeight:
    case ZynthPropId::LineSpacing:
    case ZynthPropId::ParagraphSpacing:
    case ZynthPropId::LetterSpacing:
    case ZynthPropId::TextDecorationLine:
    case ZynthPropId::TextTransform:
    case ZynthPropId::MinimumFontScale:
    case ZynthPropId::BaselineShift:
    case ZynthPropId::Hyphenation:
    case ZynthPropId::NumberOfLines:
      return ZynthPropClass::Text;
    default:
      break;
  }

  // View props (visual, no Yoga effect)
  switch (prop) {
    case ZynthPropId::Background:
    case ZynthPropId::BackgroundImage:
    case ZynthPropId::BackgroundColor:
    case ZynthPropId::BorderColor:
    case ZynthPropId::BorderStyle:
    case ZynthPropId::BorderRadius:
    case ZynthPropId::BorderWidth:
    case ZynthPropId::BorderTopWidth:
    case ZynthPropId::BorderRightWidth:
    case ZynthPropId::BorderBottomWidth:
    case ZynthPropId::BorderLeftWidth:
    case ZynthPropId::BorderTopLeftRadius:
    case ZynthPropId::BorderTopRightRadius:
    case ZynthPropId::BorderBottomRightRadius:
    case ZynthPropId::BorderBottomLeftRadius:
    case ZynthPropId::Opacity:
    case ZynthPropId::Elevation:
    case ZynthPropId::ZIndex:
    case ZynthPropId::Transform:
    case ZynthPropId::TransformOrigin:
    case ZynthPropId::ShadowColor:
    case ZynthPropId::ShadowOpacity:
    case ZynthPropId::ShadowRadius:
    case ZynthPropId::ShadowOffset:
    case ZynthPropId::BoxShadow:
    case ZynthPropId::PointerEvents:
    case ZynthPropId::AccessibilityLabel:
    case ZynthPropId::AccessibilityHint:
    case ZynthPropId::AccessibilityRole:
    case ZynthPropId::TestID:
    case ZynthPropId::Layout:
      return ZynthPropClass::View;
    default:
      break;
  }

  // Everything else is component-specific / descriptor
  return ZynthPropClass::Descriptor;
}

/**
 * @brief Value type tags matching the JS typed payload encoding.
 *
 * ValueType 1 = Number, 2 = String (index into string table), 3 = Boolean
 */
enum class ZynthValueKind : uint8_t {
  Null    = 0,
  Number  = 1,
  String  = 2,
  Bool    = 3,
  Percent = 4,
  Auto    = 5,
};

/**
 * @brief A decoded prop value from the typed payload.
 */
struct ZynthPropValue {
  ZynthValueKind kind = ZynthValueKind::Null;
  double number = 0.0;
  uint32_t stringIndex = 0; ///< Index into the commit string table
};

} // namespace zynth
