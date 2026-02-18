#include "ZynthStyleEngine.h"
#include <yoga/Yoga.h>
#include <android/log.h>
#include <atomic>

namespace zynth {
namespace kit {

using namespace facebook::jsi;

namespace {
constexpr bool kDebugStyleApply = true;
std::atomic<int> gStyleDebugLogCount{0};

const char* stylePropName(StyleProp prop) {
  switch (prop) {
    case StyleProp::Width: return "width";
    case StyleProp::Height: return "height";
    case StyleProp::MinWidth: return "minWidth";
    case StyleProp::MinHeight: return "minHeight";
    case StyleProp::MaxWidth: return "maxWidth";
    case StyleProp::MaxHeight: return "maxHeight";
    case StyleProp::Flex: return "flex";
    case StyleProp::FlexGrow: return "flexGrow";
    case StyleProp::FlexShrink: return "flexShrink";
    case StyleProp::FlexBasis: return "flexBasis";
    case StyleProp::Top: return "top";
    case StyleProp::Right: return "right";
    case StyleProp::Bottom: return "bottom";
    case StyleProp::Left: return "left";
    case StyleProp::Padding: return "padding";
    case StyleProp::PaddingHorizontal: return "paddingHorizontal";
    case StyleProp::PaddingVertical: return "paddingVertical";
    case StyleProp::PaddingTop: return "paddingTop";
    case StyleProp::PaddingRight: return "paddingRight";
    case StyleProp::PaddingBottom: return "paddingBottom";
    case StyleProp::PaddingLeft: return "paddingLeft";
    case StyleProp::Margin: return "margin";
    case StyleProp::MarginHorizontal: return "marginHorizontal";
    case StyleProp::MarginVertical: return "marginVertical";
    case StyleProp::MarginTop: return "marginTop";
    case StyleProp::MarginRight: return "marginRight";
    case StyleProp::MarginBottom: return "marginBottom";
    case StyleProp::MarginLeft: return "marginLeft";
    case StyleProp::Gap: return "gap";
    case StyleProp::RowGap: return "rowGap";
    case StyleProp::ColumnGap: return "columnGap";
    case StyleProp::AspectRatio: return "aspectRatio";
    default: return "unknown";
  }
}
} // namespace

StyleProp ZynthStyleEngine::propFromString(const std::string& name) {
  static const std::unordered_map<std::string, StyleProp> propMap = {
    {"width", StyleProp::Width},
    {"height", StyleProp::Height},
    {"minWidth", StyleProp::MinWidth},
    {"minHeight", StyleProp::MinHeight},
    {"maxWidth", StyleProp::MaxWidth},
    {"maxHeight", StyleProp::MaxHeight},
    {"flex", StyleProp::Flex},
    {"flexGrow", StyleProp::FlexGrow},
    {"flexShrink", StyleProp::FlexShrink},
    {"flexBasis", StyleProp::FlexBasis},
    {"flexDirection", StyleProp::FlexDirection},
    {"flexWrap", StyleProp::FlexWrap},
    {"justifyContent", StyleProp::JustifyContent},
    {"alignItems", StyleProp::AlignItems},
    {"alignSelf", StyleProp::AlignSelf},
    {"alignContent", StyleProp::AlignContent},
    {"position", StyleProp::Position},
    {"top", StyleProp::Top},
    {"right", StyleProp::Right},
    {"bottom", StyleProp::Bottom},
    {"left", StyleProp::Left},
    {"padding", StyleProp::Padding},
    {"paddingHorizontal", StyleProp::PaddingHorizontal},
    {"paddingVertical", StyleProp::PaddingVertical},
    {"paddingTop", StyleProp::PaddingTop},
    {"paddingRight", StyleProp::PaddingRight},
    {"paddingBottom", StyleProp::PaddingBottom},
    {"paddingLeft", StyleProp::PaddingLeft},
    {"margin", StyleProp::Margin},
    {"marginHorizontal", StyleProp::MarginHorizontal},
    {"marginVertical", StyleProp::MarginVertical},
    {"marginTop", StyleProp::MarginTop},
    {"marginRight", StyleProp::MarginRight},
    {"marginBottom", StyleProp::MarginBottom},
    {"marginLeft", StyleProp::MarginLeft},
    {"gap", StyleProp::Gap},
    {"rowGap", StyleProp::RowGap},
    {"columnGap", StyleProp::ColumnGap},
    {"aspectRatio", StyleProp::AspectRatio},
    {"overflow", StyleProp::Overflow},
    {"display", StyleProp::Display},
    {"zIndex", StyleProp::ZIndex},
    {"backgroundColor", StyleProp::BackgroundColor},
    {"opacity", StyleProp::Opacity},
    {"borderRadius", StyleProp::BorderRadius},
    {"borderWidth", StyleProp::BorderWidth},
    {"borderColor", StyleProp::BorderColor},
    {"shadowColor", StyleProp::ShadowColor},
    {"shadowOffset", StyleProp::ShadowOffset},
    {"shadowOpacity", StyleProp::ShadowOpacity},
    {"shadowRadius", StyleProp::ShadowRadius},
    {"elevation", StyleProp::Elevation},
  };

  auto it = propMap.find(name);
  if (it != propMap.end()) {
    return it->second;
  }
  return static_cast<StyleProp>(0);
}

void ZynthStyleEngine::applyStyleProp(YGNodeRef node, StyleProp prop, const Value& value, Runtime& rt, float density) {
  if (static_cast<int>(prop) < 100) {
    // Yoga layout properties
    switch (prop) {
      case StyleProp::Flex:
        if (value.isNumber()) YGNodeStyleSetFlex(node, value.asNumber());
        break;
      case StyleProp::FlexGrow:
        if (value.isNumber()) YGNodeStyleSetFlexGrow(node, value.asNumber());
        break;
      case StyleProp::FlexShrink:
        if (value.isNumber()) YGNodeStyleSetFlexShrink(node, value.asNumber());
        break;
      case StyleProp::AspectRatio:
        if (value.isNumber()) YGNodeStyleSetAspectRatio(node, value.asNumber());
        else if (value.isString() && value.asString(rt).utf8(rt) == "auto") YGNodeStyleSetAspectRatio(node, YGUndefined);
        break;
      case StyleProp::FlexDirection:
        if (value.isString()) {
          std::string s = value.asString(rt).utf8(rt);
          if (s == "row") YGNodeStyleSetFlexDirection(node, YGFlexDirectionRow);
          else if (s == "row-reverse") YGNodeStyleSetFlexDirection(node, YGFlexDirectionRowReverse);
          else if (s == "column-reverse") YGNodeStyleSetFlexDirection(node, YGFlexDirectionColumnReverse);
          else YGNodeStyleSetFlexDirection(node, YGFlexDirectionColumn);
        }
        break;
      case StyleProp::FlexWrap:
        if (value.isString()) {
          std::string s = value.asString(rt).utf8(rt);
          if (s == "wrap") YGNodeStyleSetFlexWrap(node, YGWrapWrap);
          else if (s == "wrap-reverse") YGNodeStyleSetFlexWrap(node, YGWrapWrapReverse);
          else YGNodeStyleSetFlexWrap(node, YGWrapNoWrap);
        }
        break;
      case StyleProp::JustifyContent:
        if (value.isString()) {
          std::string s = value.asString(rt).utf8(rt);
          if (s == "flex-end") YGNodeStyleSetJustifyContent(node, YGJustifyFlexEnd);
          else if (s == "center") YGNodeStyleSetJustifyContent(node, YGJustifyCenter);
          else if (s == "space-between") YGNodeStyleSetJustifyContent(node, YGJustifySpaceBetween);
          else if (s == "space-around") YGNodeStyleSetJustifyContent(node, YGJustifySpaceAround);
          else if (s == "space-evenly") YGNodeStyleSetJustifyContent(node, YGJustifySpaceEvenly);
          else YGNodeStyleSetJustifyContent(node, YGJustifyFlexStart);
        }
        break;
      case StyleProp::AlignItems:
      case StyleProp::AlignSelf:
      case StyleProp::AlignContent: {
        YGAlign align = YGAlignStretch;
        if (value.isString()) {
          std::string s = value.asString(rt).utf8(rt);
          if (s == "flex-start") align = YGAlignFlexStart;
          else if (s == "flex-end") align = YGAlignFlexEnd;
          else if (s == "center") align = YGAlignCenter;
          else if (s == "baseline") align = YGAlignBaseline;
          else if (s == "auto") align = YGAlignAuto;
        }
        if (prop == StyleProp::AlignItems) YGNodeStyleSetAlignItems(node, align);
        else if (prop == StyleProp::AlignSelf) YGNodeStyleSetAlignSelf(node, align);
        else YGNodeStyleSetAlignContent(node, align);
        break;
      }
      case StyleProp::Position:
        if (value.isString()) {
          std::string s = value.asString(rt).utf8(rt);
          if (s == "absolute") YGNodeStyleSetPositionType(node, YGPositionTypeAbsolute);
          else YGNodeStyleSetPositionType(node, YGPositionTypeRelative);
        }
        break;
      case StyleProp::Overflow:
        if (value.isString()) {
          std::string s = value.asString(rt).utf8(rt);
          if (s == "hidden") YGNodeStyleSetOverflow(node, YGOverflowHidden);
          else if (s == "scroll") YGNodeStyleSetOverflow(node, YGOverflowScroll);
          else YGNodeStyleSetOverflow(node, YGOverflowVisible);
        }
        break;
      case StyleProp::Display:
        if (value.isString()) {
          std::string s = value.asString(rt).utf8(rt);
          if (s == "none") YGNodeStyleSetDisplay(node, YGDisplayNone);
          else YGNodeStyleSetDisplay(node, YGDisplayFlex);
        }
        break;
      
      // Dimensions and Positioning
      case StyleProp::Width:
      case StyleProp::Height:
      case StyleProp::MinWidth:
      case StyleProp::MinHeight:
      case StyleProp::MaxWidth:
      case StyleProp::MaxHeight:
      case StyleProp::FlexBasis:
      case StyleProp::Top:
      case StyleProp::Right:
      case StyleProp::Bottom:
      case StyleProp::Left:
      case StyleProp::Padding:
      case StyleProp::PaddingHorizontal:
      case StyleProp::PaddingVertical:
      case StyleProp::PaddingTop:
      case StyleProp::PaddingRight:
      case StyleProp::PaddingBottom:
      case StyleProp::PaddingLeft:
      case StyleProp::Margin:
      case StyleProp::MarginHorizontal:
      case StyleProp::MarginVertical:
      case StyleProp::MarginTop:
      case StyleProp::MarginRight:
      case StyleProp::MarginBottom:
      case StyleProp::MarginLeft:
      case StyleProp::Gap:
      case StyleProp::RowGap:
      case StyleProp::ColumnGap:
        applyYogaDimension(node, prop, value, rt, density);
        break;
      
      default:
        break;
    }
  }
}

void ZynthStyleEngine::applyYogaDimension(YGNodeRef node, StyleProp prop, const Value& value, Runtime& rt, float density) {
  bool isPercent = false;
  bool isAuto = false;
  float val = 0.0f;

  if (value.isNumber()) {
    val = static_cast<float>(value.asNumber()) * density;
  } else if (value.isString()) {
    std::string s = value.asString(rt).utf8(rt);
    if (s == "auto") {
      isAuto = true;
    } else if (s.back() == '%') {
      isPercent = true;
      val = std::stof(s.substr(0, s.size() - 1));
    } else {
      val = std::stof(s) * density;
    }
  } else {
    return;
  }

  if (kDebugStyleApply && gStyleDebugLogCount.fetch_add(1) < 400) {
    __android_log_print(
        ANDROID_LOG_DEBUG,
        "ZynthStyle",
        "applyYogaDimension prop=%s mode=%s value=%.2f density=%.3f",
        stylePropName(prop),
        isAuto ? "auto" : (isPercent ? "percent" : "px"),
        val,
        density);
  }

  // Helper lambdas for different Yoga types
  auto setDim = [&](auto f, auto fPct, auto fAuto) {
    if (isAuto) {
      if constexpr (!std::is_same_v<decltype(fAuto), std::nullptr_t>) {
        if (fAuto) fAuto(node);
      }
    }
    else if (isPercent) fPct(node, val);
    else f(node, val);
  };

  auto setEdge = [&](auto f, auto fPct, YGEdge edge) {
    if (isPercent) fPct(node, edge, val);
    else f(node, edge, val);
  };

  switch (prop) {
    case StyleProp::Width: setDim(YGNodeStyleSetWidth, YGNodeStyleSetWidthPercent, YGNodeStyleSetWidthAuto); break;
    case StyleProp::Height: setDim(YGNodeStyleSetHeight, YGNodeStyleSetHeightPercent, YGNodeStyleSetHeightAuto); break;
    case StyleProp::MinWidth: setDim(YGNodeStyleSetMinWidth, YGNodeStyleSetMinWidthPercent, nullptr); break;
    case StyleProp::MinHeight: setDim(YGNodeStyleSetMinHeight, YGNodeStyleSetMinHeightPercent, nullptr); break;
    case StyleProp::MaxWidth: setDim(YGNodeStyleSetMaxWidth, YGNodeStyleSetMaxWidthPercent, nullptr); break;
    case StyleProp::MaxHeight: setDim(YGNodeStyleSetMaxHeight, YGNodeStyleSetMaxHeightPercent, nullptr); break;
    case StyleProp::FlexBasis: setDim(YGNodeStyleSetFlexBasis, YGNodeStyleSetFlexBasisPercent, YGNodeStyleSetFlexBasisAuto); break;
    
    case StyleProp::Top: setEdge(YGNodeStyleSetPosition, YGNodeStyleSetPositionPercent, YGEdgeTop); break;
    case StyleProp::Right: setEdge(YGNodeStyleSetPosition, YGNodeStyleSetPositionPercent, YGEdgeRight); break;
    case StyleProp::Bottom: setEdge(YGNodeStyleSetPosition, YGNodeStyleSetPositionPercent, YGEdgeBottom); break;
    case StyleProp::Left: setEdge(YGNodeStyleSetPosition, YGNodeStyleSetPositionPercent, YGEdgeLeft); break;
    
    case StyleProp::Padding: setEdge(YGNodeStyleSetPadding, YGNodeStyleSetPaddingPercent, YGEdgeAll); break;
    case StyleProp::PaddingHorizontal: setEdge(YGNodeStyleSetPadding, YGNodeStyleSetPaddingPercent, YGEdgeHorizontal); break;
    case StyleProp::PaddingVertical: setEdge(YGNodeStyleSetPadding, YGNodeStyleSetPaddingPercent, YGEdgeVertical); break;
    case StyleProp::PaddingTop: setEdge(YGNodeStyleSetPadding, YGNodeStyleSetPaddingPercent, YGEdgeTop); break;
    case StyleProp::PaddingRight: setEdge(YGNodeStyleSetPadding, YGNodeStyleSetPaddingPercent, YGEdgeRight); break;
    case StyleProp::PaddingBottom: setEdge(YGNodeStyleSetPadding, YGNodeStyleSetPaddingPercent, YGEdgeBottom); break;
    case StyleProp::PaddingLeft: setEdge(YGNodeStyleSetPadding, YGNodeStyleSetPaddingPercent, YGEdgeLeft); break;
    
    case StyleProp::Margin: setEdge(YGNodeStyleSetMargin, YGNodeStyleSetMarginPercent, YGEdgeAll); break;
    case StyleProp::MarginHorizontal: setEdge(YGNodeStyleSetMargin, YGNodeStyleSetMarginPercent, YGEdgeHorizontal); break;
    case StyleProp::MarginVertical: setEdge(YGNodeStyleSetMargin, YGNodeStyleSetMarginPercent, YGEdgeVertical); break;
    case StyleProp::MarginTop: setEdge(YGNodeStyleSetMargin, YGNodeStyleSetMarginPercent, YGEdgeTop); break;
    case StyleProp::MarginRight: setEdge(YGNodeStyleSetMargin, YGNodeStyleSetMarginPercent, YGEdgeRight); break;
    case StyleProp::MarginBottom: setEdge(YGNodeStyleSetMargin, YGNodeStyleSetMarginPercent, YGEdgeBottom); break;
    case StyleProp::MarginLeft: setEdge(YGNodeStyleSetMargin, YGNodeStyleSetMarginPercent, YGEdgeLeft); break;

    case StyleProp::Gap: YGNodeStyleSetGap(node, YGGutterAll, val); break;
    case StyleProp::RowGap: YGNodeStyleSetGap(node, YGGutterRow, val); break;
    case StyleProp::ColumnGap: YGNodeStyleSetGap(node, YGGutterColumn, val); break;
    
    default: break;
  }
}

} // namespace kit
} // namespace zynth
