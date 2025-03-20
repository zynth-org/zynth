#import "SNUIManager.h"
#import "SNUIManager+Internal.h"
#import "SNUIManager+Image.h"
#import "SNUIManager+ScrollView.h"
#import "SNUIManager+Button.h"
#import "SNUIManager+Pressable.h"
#import "RuneUIManager+View.h"
#import "RuneUIManager+Text.h"
#import "RuneUIManager+TextInput.h"
#import "RuneUIManager+SecureTextInput.h"
#import "RuneTextInputView.h"
#import "RuneSecureTextInputView.h"
#import "RuneUIManager+Events.h"
#import "RuneUIManager+Layout.h"
#import "RuneScrollView.h"
#import "RuneButtonView.h"
#import "RunePressableView.h"
#import "SNHexColor.h"
#import <Yoga/Yoga.h>
#import <QuartzCore/QuartzCore.h>
#import <JavaScriptCore/JavaScriptCore.h>

static NSString *const kRuneBorderLayerName = @"rune-border-style";

#if __has_include(<RuneKit/RuneKit-Swift.h>)
#import <RuneKit/RuneKit-Swift.h>
#elif __has_include("RuneKit-Swift.h")
#import "RuneKit-Swift.h"
#endif

@interface SNUIManager ()
@property(nonatomic, strong) UIView *root;
@property(nonatomic, strong) NSMutableDictionary<NSNumber *, SNNode *> *nodes;
@property(nonatomic, assign) int nextId;
@property(nonatomic, assign) YGNodeRef rootYoga;
@property(nonatomic, strong, nullable) CADisplayLink *displayLink;
@property(nonatomic, assign) BOOL needsFlush;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSDictionary *> *eventPayloads;
@end

@implementation SNNode

- (void)dealloc {
  if (_yoga) {
    // Ensure we're on the main queue when freeing Yoga nodes to avoid race conditions
    if ([NSThread isMainThread]) {
      YGNodeFree(_yoga);
    } else {
      YGNodeRef yogaToFree = _yoga;
      dispatch_async(dispatch_get_main_queue(), ^{
        YGNodeFree(yogaToFree);
      });
    }
    _yoga = NULL;
  }
  if (_imageTask) {
    [_imageTask cancel];
    _imageTask = nil;
  }
}

@end

@implementation SNUIManager

- (CADisplayLink *)rune_displayLink { return _displayLink; }
- (void)rune_setDisplayLink:(CADisplayLink *_Nullable)displayLink { _displayLink = displayLink; }
- (BOOL)rune_needsFlush { return _needsFlush; }
- (void)rune_setNeedsFlush:(BOOL)needsFlush { _needsFlush = needsFlush; }
- (NSMutableDictionary<NSString *, NSDictionary *> *)rune_eventPayloads { return _eventPayloads; }
- (void)rune_setEventPayloads:(NSMutableDictionary<NSString *, NSDictionary *> *)payloads { _eventPayloads = payloads; }

- (void)dealloc {
  [self rune_stopDisplayLink];
  if (_rootYoga) {
    YGNodeFreeRecursive(_rootYoga);
    _rootYoga = NULL;
  }
}

- (instancetype)initWithRootView:(UIView *)rootView {
  if (self = [super init]) {
    _root = rootView;
    _nodes = [NSMutableDictionary new];
    _nextId = 1;
    _rootYoga = YGNodeNew();
    _eventPayloads = [NSMutableDictionary new];

    CGRect screenBounds = [UIScreen mainScreen].bounds;
    rootView.frame = screenBounds;
    rootView.backgroundColor = [UIColor colorWithRed:0.06 green:0.07 blue:0.09 alpha:1.0];
  }
  return self;
}
- (NSNumber *)createNode:(NSString *)type {
  int nid = _nextId++;
  UIView *v;
  BOOL isTextInput = NO;
  BOOL isSecureTextInput = NO;

  if ([type isEqualToString:@"text"]) {
    UILabel *l = [UILabel new];
    l.textColor = [UIColor whiteColor];
    l.numberOfLines = 0;
    v = l;
  } else if ([type isEqualToString:@"text-input"]) {
    UIView *input = [self sn_textInputCreateView];
    if (input) {
      v = input;
      isTextInput = YES;
    } else {
      v = [self rune_makeContainerView];
    }
  } else if ([type isEqualToString:@"secure-text-input"]) {
      UIView *input = [self sn_secureTextInputCreateView];
      if (input) {
          v = input;
          isSecureTextInput = YES;
      } else {
          v = [self rune_makeContainerView];
      }
  } else if ([type isEqualToString:@"image"]) {
#if __has_include(<UIKit/UIKit.h>)
    UIImageView *imageView = [UIImageView new];
    imageView.contentMode = UIViewContentModeScaleAspectFill;
    imageView.clipsToBounds = YES;
    v = imageView;
#else
    v = [UIView new];
#endif
  } else if ([type isEqualToString:@"scroll-view"]) {
    RuneScrollView *scroll = [RuneScrollView new];
    v = scroll;
  } else if ([type isEqualToString:@"button"]) {
    RuneButtonView *button = [RuneButtonView new];
    v = button;
  } else if ([type isEqualToString:@"pressable"]) {
    RunePressableView *pressable = [RunePressableView new];
    v = pressable;
  } else {
    v = [self rune_makeContainerView];
  }

  SNNode *n = [SNNode new];
  n.nid = nid;
  n.view = v;
  n.yoga = YGNodeNew();
  n.children = [NSMutableArray new];
  n.parentId = -1;
  n.pointerEvents = @"auto"; // Default pointerEvents state

  [self rune_initializePointerDefaultsForNode:n];
  [self sn_scrollViewAttachIfNeeded:n];
  [self sn_buttonAttachIfNeeded:n];
  [self sn_pressableAttachIfNeeded:n];

  if (!n.yoga) {
    NSLog(@"[SN] ERROR: Failed to create Yoga node for nid=%d", nid);
    return @(nid);
  }

  YGNodeStyleSetFlexDirection(n.yoga, YGFlexDirectionColumn);
  // Ensure children stretch to full width by default (matches Android behavior)
  YGNodeStyleSetAlignItems(n.yoga, YGAlignStretch);

  if ([v isKindOfClass:[UILabel class]]) {
    YGNodeSetContext(n.yoga, (__bridge void *)v);
    YGNodeSetMeasureFunc(n.yoga, SNMeasureLabelFunc);
  }

  if (isTextInput && [v isKindOfClass:[RuneTextInputView class]]) {
    [self sn_textInputAttachNode:n view:(RuneTextInputView *)v];
  }
  
  if (isSecureTextInput && [v isKindOfClass:[RuneSecureTextInputView class]]) {
      [self sn_secureTextInputAttachNode:n view:(RuneSecureTextInputView *)v];
  }

  _nodes[@(nid)] = n;
  return @(nid);
}

static CGFloat SNNum(id x) { return x && ![x isKindOfClass:[NSNull class]] ? [x doubleValue] : NAN; }

static BOOL SNValueIsPercentString(id value) {
  return [value isKindOfClass:[NSString class]] && [(NSString *)value hasSuffix:@"%"];
}

static BOOL SNIsNullish(id value) {
  return value == nil || value == (id)kCFNull;
}

static void SNApplyDimensionValue(
    YGNodeRef yoga,
    id value,
    void (^setPoint)(float),
    void (^setPercent)(float),
    void (^setAuto)(void)) {
  if (SNIsNullish(value)) {
    if (setAuto) setAuto();
    return;
  }

  if ([value isKindOfClass:[NSNumber class]]) {
    setPoint((float)SNNum(value));
    return;
  }

  if (![value isKindOfClass:[NSString class]]) return;
  NSString *stringValue = (NSString *)value;
  NSString *lower = stringValue.lowercaseString;

  if ([lower isEqualToString:@"auto"]) {
    if (setAuto) setAuto();
    return;
  }

  if (SNValueIsPercentString(stringValue)) {
    if (setPercent) setPercent((float)[stringValue doubleValue]);
    return;
  }

  setPoint((float)[stringValue doubleValue]);
}

static void SNApplyPositionValue(YGNodeRef yoga, id value, YGEdge edge) {
  if (SNIsNullish(value)) {
    YGNodeStyleSetPosition(yoga, edge, YGUndefined);
    return;
  }

  if ([value isKindOfClass:[NSNumber class]]) {
    YGNodeStyleSetPosition(yoga, edge, (float)SNNum(value));
    return;
  }

  if (![value isKindOfClass:[NSString class]]) return;
  NSString *stringValue = (NSString *)value;
  NSString *lower = stringValue.lowercaseString;

  if ([lower isEqualToString:@"auto"]) {
    YGNodeStyleSetPosition(yoga, edge, YGUndefined);
    return;
  }

  if (SNValueIsPercentString(stringValue)) {
    YGNodeStyleSetPositionPercent(yoga, edge, (float)[stringValue doubleValue]);
    return;
  }

  YGNodeStyleSetPosition(yoga, edge, (float)[stringValue doubleValue]);
}

static void SNRemoveCustomBorderLayers(UIView *view) {
  NSArray<CALayer *> *sublayers = [view.layer.sublayers copy];
  for (CALayer *layer in sublayers) {
    if ([layer.name isEqualToString:kRuneBorderLayerName]) {
      [layer removeFromSuperlayer];
    }
  }
}

static void SNApplyBorderStyleToView(UIView *view, NSNumber *_Nullable borderWidthNumber, NSString *_Nullable borderColorHex, NSString *_Nullable borderStyle) {
  SNRemoveCustomBorderLayers(view);
  view.layer.borderWidth = 0;

  CGFloat borderWidth = borderWidthNumber ? (CGFloat)SNNum(borderWidthNumber) : 0.f;
  if (borderWidth <= 0.f) {
    return;
  }

  UIColor *borderColor = borderColorHex ? SNColorFromHex(borderColorHex) : nil;
  if (!borderColor) {
    return;
  }

  CAShapeLayer *borderLayer = [CAShapeLayer layer];
  borderLayer.name = kRuneBorderLayerName;
  borderLayer.strokeColor = borderColor.CGColor;
  borderLayer.fillColor = [UIColor clearColor].CGColor;
  borderLayer.lineWidth = borderWidth;

  CGFloat cornerRadius = view.layer.cornerRadius;
  borderLayer.path = [UIBezierPath bezierPathWithRoundedRect:view.bounds cornerRadius:cornerRadius].CGPath;

  NSString *normalizedStyle = borderStyle.length ? borderStyle.lowercaseString : @"solid";
  if ([normalizedStyle isEqualToString:@"dotted"]) {
    borderLayer.lineDashPattern = @[@(borderWidth), @(borderWidth)];
  } else if ([normalizedStyle isEqualToString:@"dashed"]) {
    borderLayer.lineDashPattern = @[@(borderWidth * 2), @(borderWidth * 2)];
  }

  [view.layer addSublayer:borderLayer];
}

static YGSize SNMeasureLabelFunc(YGNodeConstRef node,
                                 float width,
                                 YGMeasureMode widthMode,
                                 float height,
                                 YGMeasureMode heightMode) {
  UILabel *label = (__bridge UILabel *)YGNodeGetContext(node);
  if (![label isKindOfClass:[UILabel class]]) {
    return (YGSize){.width = 0, .height = 0};
  }
  CGFloat maxW;
  switch (widthMode) {
    case YGMeasureModeExactly: maxW = width; break;
    case YGMeasureModeAtMost: maxW = width; break;
    case YGMeasureModeUndefined: default: maxW = CGFLOAT_MAX; break;
  }
  CGSize fit = [label sizeThatFits:CGSizeMake(maxW, CGFLOAT_MAX)];
  float outW;
  switch (widthMode) {
    case YGMeasureModeExactly: outW = width; break;
    case YGMeasureModeAtMost: outW = MIN(width, fit.width); break;
    case YGMeasureModeUndefined: default: outW = fit.width; break;
  }
  float outH;
  switch (heightMode) {
    case YGMeasureModeExactly: outH = height; break;
    case YGMeasureModeAtMost: outH = MIN(height, fit.height); break;
    case YGMeasureModeUndefined: default: outH = fit.height; break;
  }
  return (YGSize){.width = outW, .height = outH};
}

static void SNApplyEdges(NSDictionary *style,
                        NSString *baseKey,
                        NSString *horizontalKey,
                        NSString *verticalKey,
                        NSString *topKey,
                        NSString *rightKey,
                        NSString *bottomKey,
                        YGNodeRef yoga,
                        void (^setter)(YGEdge edge, float value)) {
  NSNumber *base = style[baseKey];
  NSNumber *horizontal = style[horizontalKey];
  NSNumber *vertical = style[verticalKey];
  NSNumber *top = style[topKey];
  NSNumber *right = style[rightKey];
  NSNumber *bottom = style[bottomKey];

  NSNumber *T = top ?: vertical ?: base;
  NSNumber *R = right ?: horizontal ?: base;
  NSNumber *B = bottom ?: vertical ?: base;
  NSNumber *L = horizontal ?: base;

  if (T && ![T isKindOfClass:[NSNull class]]) setter(YGEdgeTop, (float)SNNum(T));
  if (R && ![R isKindOfClass:[NSNull class]]) setter(YGEdgeRight, (float)SNNum(R));
  if (B && ![B isKindOfClass:[NSNull class]]) setter(YGEdgeBottom, (float)SNNum(B));
  if (L && ![L isKindOfClass:[NSNull class]]) setter(YGEdgeLeft, (float)SNNum(L));
}

- (void)sn_applyStyleDictionary:(NSDictionary *)style toNode:(SNNode *)n {
  if (!style || !n || !n.view) return;
  if (![style isKindOfClass:[NSDictionary class]] || !n.yoga) return;

  SNApplyDimensionValue(
      n.yoga,
      style[@"width"],
      ^(float v) { YGNodeStyleSetWidth(n.yoga, v); },
      ^(float v) { YGNodeStyleSetWidthPercent(n.yoga, v); },
      ^{ YGNodeStyleSetWidthAuto(n.yoga); });

  SNApplyDimensionValue(
      n.yoga,
      style[@"height"],
      ^(float v) { YGNodeStyleSetHeight(n.yoga, v); },
      ^(float v) { YGNodeStyleSetHeightPercent(n.yoga, v); },
      ^{ YGNodeStyleSetHeightAuto(n.yoga); });

  SNApplyDimensionValue(
      n.yoga,
      style[@"minWidth"],
      ^(float v) { YGNodeStyleSetMinWidth(n.yoga, v); },
      ^(float v) { YGNodeStyleSetMinWidthPercent(n.yoga, v); },
      ^{ YGNodeStyleSetMinWidth(n.yoga, YGUndefined); });

  SNApplyDimensionValue(
      n.yoga,
      style[@"maxWidth"],
      ^(float v) { YGNodeStyleSetMaxWidth(n.yoga, v); },
      ^(float v) { YGNodeStyleSetMaxWidthPercent(n.yoga, v); },
      ^{ YGNodeStyleSetMaxWidth(n.yoga, YGUndefined); });

  SNApplyDimensionValue(
      n.yoga,
      style[@"minHeight"],
      ^(float v) { YGNodeStyleSetMinHeight(n.yoga, v); },
      ^(float v) { YGNodeStyleSetMinHeightPercent(n.yoga, v); },
      ^{ YGNodeStyleSetMinHeight(n.yoga, YGUndefined); });

  SNApplyDimensionValue(
      n.yoga,
      style[@"maxHeight"],
      ^(float v) { YGNodeStyleSetMaxHeight(n.yoga, v); },
      ^(float v) { YGNodeStyleSetMaxHeightPercent(n.yoga, v); },
      ^{ YGNodeStyleSetMaxHeight(n.yoga, YGUndefined); });

  NSNumber *flex = style[@"flex"]; if (flex) YGNodeStyleSetFlex(n.yoga, (float)SNNum(flex));
  NSNumber *flexGrow = style[@"flexGrow"]; if (flexGrow) YGNodeStyleSetFlexGrow(n.yoga, (float)SNNum(flexGrow));
  NSNumber *flexShrink = style[@"flexShrink"]; if (flexShrink) YGNodeStyleSetFlexShrink(n.yoga, (float)SNNum(flexShrink));
  NSString *fd = style[@"flexDirection"];
  if (fd) YGNodeStyleSetFlexDirection(n.yoga, [fd isEqualToString:@"row"] ? YGFlexDirectionRow : YGFlexDirectionColumn);

  NSString *jc = style[@"justifyContent"];
  if (jc) {
    YGJustify j = YGJustifyFlexStart;
    if ([jc isEqualToString:@"center"]) j = YGJustifyCenter;
    else if ([jc isEqualToString:@"flex-end"]) j = YGJustifyFlexEnd;
    else if ([jc isEqualToString:@"space-between"]) j = YGJustifySpaceBetween;
    else if ([jc isEqualToString:@"space-around"]) j = YGJustifySpaceAround;
    YGNodeStyleSetJustifyContent(n.yoga, j);
  }

  NSString *ai = style[@"alignItems"];
  if (ai) {
    YGAlign a = YGAlignFlexStart;
    if ([ai isEqualToString:@"center"]) a = YGAlignCenter;
    else if ([ai isEqualToString:@"flex-end"]) a = YGAlignFlexEnd;
    else if ([ai isEqualToString:@"stretch"]) a = YGAlignStretch;
    YGNodeStyleSetAlignItems(n.yoga, a);
  }

  NSNumber *gapAll = style[@"gap"];
  NSNumber *gapRow = style[@"rowGap"];
  NSNumber *gapColumn = style[@"columnGap"];
  if (gapAll) {
    float g = (float)SNNum(gapAll);
    YGNodeStyleSetGap(n.yoga, YGGutterAll, g);
  }
  if (gapRow) {
    float g = (float)SNNum(gapRow);
    YGNodeStyleSetGap(n.yoga, YGGutterRow, g);
  } else if (gapAll) {
    YGNodeStyleSetGap(n.yoga, YGGutterRow, (float)SNNum(gapAll));
  }
  if (gapColumn) {
    float g = (float)SNNum(gapColumn);
    YGNodeStyleSetGap(n.yoga, YGGutterColumn, g);
  } else if (gapAll) {
    YGNodeStyleSetGap(n.yoga, YGGutterColumn, (float)SNNum(gapAll));
  }

  SNApplyEdges(style, @"padding", @"paddingHorizontal", @"paddingVertical", @"paddingTop", @"paddingRight", @"paddingBottom", n.yoga,
               ^(YGEdge e, float v){ YGNodeStyleSetPadding(n.yoga, e, v); });

  SNApplyEdges(style, @"margin", @"marginHorizontal", @"marginVertical", @"marginTop", @"marginRight", @"marginBottom", n.yoga,
               ^(YGEdge e, float v){ YGNodeStyleSetMargin(n.yoga, e, v); });

  NSString *position = style[@"position"];
  if (position) {
    NSString *normalized = position.lowercaseString;
    if ([normalized isEqualToString:@"absolute"]) {
      YGNodeStyleSetPositionType(n.yoga, YGPositionTypeAbsolute);
    } else {
      YGNodeStyleSetPositionType(n.yoga, YGPositionTypeRelative);
    }
  } else {
    YGNodeStyleSetPositionType(n.yoga, YGPositionTypeRelative);
  }

  SNApplyPositionValue(n.yoga, style[@"top"], YGEdgeTop);
  SNApplyPositionValue(n.yoga, style[@"right"], YGEdgeRight);
  SNApplyPositionValue(n.yoga, style[@"bottom"], YGEdgeBottom);
  SNApplyPositionValue(n.yoga, style[@"left"], YGEdgeLeft);

  NSString *display = style[@"display"];
  if (display) {
    NSString *normalized = display.lowercaseString;
    if ([normalized isEqualToString:@"none"]) {
      YGNodeStyleSetDisplay(n.yoga, YGDisplayNone);
    } else {
      YGNodeStyleSetDisplay(n.yoga, YGDisplayFlex);
    }
  } else {
    YGNodeStyleSetDisplay(n.yoga, YGDisplayFlex);
  }

  NSNumber *borderWidthValue = style[@"borderWidth"];
  YGNodeStyleSetBorder(n.yoga, YGEdgeAll, borderWidthValue ? (float)SNNum(borderWidthValue) : 0.f);

  NSString *bg = style[@"backgroundColor"]; if (bg) { n.view.backgroundColor = SNColorFromHex(bg); }
  NSNumber *br = style[@"borderRadius"];
  if (br) { n.view.layer.cornerRadius = (CGFloat)SNNum(br); n.view.clipsToBounds = YES; }
  SNApplyBorderStyleToView(n.view, style[@"borderWidth"], style[@"borderColor"], style[@"borderStyle"]);

  if ([n.view isKindOfClass:[UILabel class]]) {
    UILabel *l = (UILabel *)n.view;
    NSNumber *fs = style[@"fontSize"]; if (fs) l.font = [UIFont systemFontOfSize:(CGFloat)SNNum(fs) weight:UIFontWeightRegular];
    NSString *fw = style[@"fontWeight"];
    if (fw) {
      NSDictionary *m = @{@"normal":@(UIFontWeightRegular),@"bold":@(UIFontWeightBold),
                           @"100":@(UIFontWeightUltraLight),@"200":@(UIFontWeightThin),@"300":@(UIFontWeightLight),@"400":@(UIFontWeightRegular),
                           @"500":@(UIFontWeightMedium),@"600":@(UIFontWeightSemibold),@"700":@(UIFontWeightBold),@"800":@(UIFontWeightHeavy),@"900":@(UIFontWeightBlack)};
      l.font = [UIFont systemFontOfSize:l.font.pointSize weight:[m[fw] doubleValue]];
    }
    NSString *color = style[@"color"]; if (color) l.textColor = SNColorFromHex(color);
    // Only mark dirty if node has no children (Yoga constraint: measure functions can't have children)
    if (n.yoga && YGNodeGetChildCount(n.yoga) == 0 && YGNodeGetOwner(n.yoga)) {
      YGNodeMarkDirty(n.yoga);
    }
  }

  if ([n.view isKindOfClass:[RuneTextInputView class]]) {
    RuneTextInputView *input = (RuneTextInputView *)n.view;
    NSNumber *fs = style[@"fontSize"];
    CGFloat currentSize = input.font ? input.font.pointSize : 16.0;
    CGFloat targetSize = fs ? (CGFloat)SNNum(fs) : currentSize;
    CGFloat targetWeight = UIFontWeightRegular;

    NSString *fw = style[@"fontWeight"];
    if (fw) {
      NSDictionary *weights = @{@"normal":@(UIFontWeightRegular),@"bold":@(UIFontWeightBold),
                                @"100":@(UIFontWeightUltraLight),@"200":@(UIFontWeightThin),@"300":@(UIFontWeightLight),@"400":@(UIFontWeightRegular),
                                @"500":@(UIFontWeightMedium),@"600":@(UIFontWeightSemibold),@"700":@(UIFontWeightBold),@"800":@(UIFontWeightHeavy),@"900":@(UIFontWeightBlack)};
      NSNumber *mapped = weights[fw];
      if (mapped) {
        targetWeight = (CGFloat)mapped.doubleValue;
      }
    }

    input.font = [UIFont systemFontOfSize:targetSize weight:targetWeight];

    NSString *color = style[@"color"];
    if (color) {
      input.textColor = SNColorFromHex(color);
      [input applyPlaceholderToneFromTextColor];
    }
      
    CGFloat top = [style[@"paddingTop"] ?: style[@"paddingVertical"] ?: style[@"padding"] floatValue];
    CGFloat left = [style[@"paddingLeft"] ?: style[@"paddingHorizontal"] ?: style[@"padding"] floatValue];
    CGFloat bottom = [style[@"paddingBottom"] ?: style[@"paddingVertical"] ?: style[@"padding"] floatValue];
    CGFloat right = [style[@"paddingRight"] ?: style[@"paddingHorizontal"] ?: style[@"padding"] floatValue];
    input.textContainerInset = UIEdgeInsetsMake(top, left, bottom, right);

    if (input.placeholderLeadingConstraint) {
        input.placeholderLeadingConstraint.constant = left;
    }
    if (input.placeholderTopConstraint) {
        input.placeholderTopConstraint.constant = top;
    }

    if (n.yoga && YGNodeGetOwner(n.yoga)) {
      YGNodeMarkDirty(n.yoga);
    }
  }
    
  if ([n.view isKindOfClass:[RuneSecureTextInputView class]]) {
    RuneSecureTextInputView *input = (RuneSecureTextInputView *)n.view;
    NSNumber *fs = style[@"fontSize"];
    CGFloat currentSize = input.font ? input.font.pointSize : 16.0;
    CGFloat targetSize = fs ? (CGFloat)SNNum(fs) : currentSize;
    CGFloat targetWeight = UIFontWeightRegular;

    NSString *fw = style[@"fontWeight"];
    if (fw) {
      NSDictionary *weights = @{@"normal":@(UIFontWeightRegular),@"bold":@(UIFontWeightBold),
                                @"100":@(UIFontWeightUltraLight),@"200":@(UIFontWeightThin),@"300":@(UIFontWeightLight),@"400":@(UIFontWeightRegular),
                                @"500":@(UIFontWeightMedium),@"600":@(UIFontWeightSemibold),@"700":@(UIFontWeightBold),@"800":@(UIFontWeightHeavy),@"900":@(UIFontWeightBlack)};
      NSNumber *mapped = weights[fw];
      if (mapped) {
        targetWeight = (CGFloat)mapped.doubleValue;
      }
    }

    input.font = [UIFont systemFontOfSize:targetSize weight:targetWeight];

    NSString *color = style[@"color"];
    if (color) {
      input.textColor = SNColorFromHex(color);
      [input applyPlaceholderToneFromTextColor];
    }

    CGFloat top = [style[@"paddingTop"] ?: style[@"paddingVertical"] ?: style[@"padding"] floatValue];
    CGFloat left = [style[@"paddingLeft"] ?: style[@"paddingHorizontal"] ?: style[@"padding"] floatValue];
    CGFloat bottom = [style[@"paddingBottom"] ?: style[@"paddingVertical"] ?: style[@"padding"] floatValue];
    CGFloat right = [style[@"paddingRight"] ?: style[@"paddingHorizontal"] ?: style[@"padding"] floatValue];
    input.padding = UIEdgeInsetsMake(top, left, bottom, right);

    if (n.yoga && YGNodeGetOwner(n.yoga)) {
      YGNodeMarkDirty(n.yoga);
    }
  }
}

- (void)setProp:(NSNumber *)nodeId name:(NSString *)name valueJSON:(NSString *)json {
  SNNode *n = _nodes[nodeId];
  if (!n || !n.view) return;

  if ([name isEqualToString:@"style"]) {
    NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *s = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    [self sn_applyStyleDictionary:s toNode:n];
    [self rune_markNeedsFlush];
    return;
  }

  NSData *jsonData = [json dataUsingEncoding:NSUTF8StringEncoding];
  NSError *parseError = nil;
  id value = [NSJSONSerialization JSONObjectWithData:jsonData
                                             options:NSJSONReadingAllowFragments
                                               error:&parseError];
  if (!value && json) {
    // Fallback: treat the raw string as the value if JSON parsing fails (e.g., scalar fragments)
    if (parseError) {
      NSLog(@"[SNUIManager] JSON parse fallback name=%@ raw=%@ error=%@", name, json, parseError);
    }
    value = json;
  }
  NSString *stringValue = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;

  if ([name isEqualToString:@"accessibilityLabel"]) {
    n.view.isAccessibilityElement = YES;
    n.view.accessibilityLabel = stringValue;
    return;
  }
  
  if ([name isEqualToString:@"accessibilityHint"]) {
    n.view.isAccessibilityElement = YES;
    n.view.accessibilityHint = stringValue;
    return;
  }
  
  if ([name isEqualToString:@"accessibilityRole"]) {
    if ([stringValue isEqualToString:@"none"]) {
      n.view.isAccessibilityElement = NO;
    } else {
      n.view.isAccessibilityElement = YES;
      UIAccessibilityTraits traits = n.view.accessibilityTraits;
      traits &= ~(UIAccessibilityTraitButton | UIAccessibilityTraitHeader | UIAccessibilityTraitLink);
      if ([stringValue isEqualToString:@"button"]) traits |= UIAccessibilityTraitButton;
      else if ([stringValue isEqualToString:@"header"]) traits |= UIAccessibilityTraitHeader;
      else if ([stringValue isEqualToString:@"link"]) traits |= UIAccessibilityTraitLink;
      n.view.accessibilityTraits = traits;
    }
    return;
  }

  if ([name isEqualToString:@"pointerEvents"]) {
    n.pointerEvents = stringValue.length ? stringValue : @"auto";
    [self rune_updateInteractionStateForNode:n];
    return;
  }

  if ([name isEqualToString:@"testID"]) {
    n.view.accessibilityIdentifier = stringValue;
    return;
  }

  if ([self sn_buttonHandlesSetPropForNode:n name:name value:value rawJSON:json]) {
    return;
  }

  if ([self sn_pressableHandlesSetPropForNode:n name:name value:value rawJSON:json]) {
    return;
  }

  if ([self sn_textInputHandlesSetPropForNode:n name:name value:value rawJSON:json]) {
    return;
  }

  if ([self sn_secureTextInputHandlesSetPropForNode:n name:name value:value rawJSON:json]) {
      return;
  }

  if ([self sn_scrollViewHandlesSetPropForNode:n name:name value:value rawJSON:json]) {
    return;
  }

  if ([self sn_imageHandlesSetPropForNode:n name:name valueJSON:json]) {
    return;
  }
}

- (void)setStyle:(NSNumber *)nodeId style:(NSDictionary *)style {
  SNNode *n = _nodes[nodeId];
  if (!n || !n.view) return;
  [self sn_applyStyleDictionary:style toNode:n];
  [self rune_markNeedsFlush];
}

- (void)setPropCallback:(NSNumber *)nodeId name:(NSString *)name callback:(JSValue *)callback {
  SNNode *n = _nodes[nodeId];
  if (!n || !n.view) return;
  
  if ([self sn_buttonHandlesSetHandlerForNode:n name:name]) {
    return;
  }

  if ([self sn_pressableHandlesSetHandlerForNode:n name:name]) {
    return;
  }
  
  if ([name isEqualToString:@"onPress"]) {
    BOOL validCallback = callback && ![callback isUndefined] && ![callback isNull];
    if (validCallback) {
      n.onPressCallback = callback;
      [self rune_attachTapRecognizerForNode:n];
    } else {
      n.onPressCallback = nil;
      n.hasOnPressHandler = NO;
      for (UIGestureRecognizer *gr in n.view.gestureRecognizers.copy) {
        if ([gr isKindOfClass:[UITapGestureRecognizer class]]) {
          [n.view removeGestureRecognizer:gr];
        }
      }
      [self rune_updateInteractionStateForNode:n];
    }
    return;
  }

  if ([self sn_imageHandlesSetPropCallbackForNode:n name:name callback:callback]) {
    return;
  }

  if ([self sn_textInputHandlesSetPropCallbackForNode:n name:name callback:callback]) {
    return;
  }
}

- (void)setHandler:(NSNumber *)nodeId name:(NSString *)name {
  SNNode *n = _nodes[nodeId];
  if (!n || !n.view) return;

  if ([self sn_buttonHandlesSetHandlerForNode:n name:name]) {
    return;
  }

  if ([self sn_pressableHandlesSetHandlerForNode:n name:name]) {
    return;
  }

  if ([name isEqualToString:@"onPress"]) {
    n.onPressCallback = nil;
    [self rune_attachTapRecognizerForNode:n];
    return;
  }

  if ([self sn_imageHandlesSetHandlerForNode:n name:name]) {
    return;
  }

  if ([self sn_textInputHandlesSetHandlerForNode:n name:name]) {
    return;
  }

  if ([self sn_secureTextInputHandlesSetHandlerForNode:n name:name]) {
      return;
  }

  if ([self sn_scrollViewHandlesSetHandlerForNode:n name:name]) {
    return;
  }

  if ([name isEqualToString:@"onLayout"]) {
    n.hasOnLayoutHandler = YES;
    n.hasDispatchedLayout = NO;
    [self rune_dispatchLayoutEventForNode:n force:YES];
    return;
  }
}

- (void)setText:(NSNumber *)nodeId text:(NSString *)text {
  SNNode *n = _nodes[nodeId];
  if (!n || !n.view) return;

  if ([n.view isKindOfClass:[UILabel class]]) {
    ((UILabel *)n.view).text = text;
    // Only mark dirty if node has no children (Yoga constraint: measure functions can't have children)
    if (n.yoga && YGNodeGetChildCount(n.yoga) == 0) {
      if (YGNodeGetOwner(n.yoga)) {
        YGNodeMarkDirty(n.yoga);
      }
    }
    [self rune_propagateTextChangeFromNode:n];
  } else if ([n.view isKindOfClass:[RuneTextInputView class]]) {
    RuneTextInputView *input = (RuneTextInputView *)n.view;
    [input performProgrammaticUpdate:^{
      input.text = text ?: @"";
    }];
    [self sn_textInputUpdateTextForNode:n text:text ?: @""];
    if (n.yoga) {
      if (YGNodeGetOwner(n.yoga)) {
        YGNodeMarkDirty(n.yoga);
      }
    }
  }
  [self rune_markNeedsFlush];
}

- (void)insertChild:(NSNumber *)parentId child:(NSNumber *)childId index:(NSNumber *)index {
  SNNode *c = _nodes[childId];
  if (!c || !c.view || !c.yoga) return;
  
  if (parentId.intValue == 0) {
    if (!self.rootYoga || !self.root) return;

    int i = (int)index.intValue;
    i = MAX(0, MIN(i, (int)self.root.subviews.count));
    [self.root insertSubview:c.view atIndex:i];
    YGNodeInsertChild(self.rootYoga, c.yoga, (uint32_t)MIN(i, (int)YGNodeGetChildCount(self.rootYoga)));
    c.parentId = 0;
  } else {
    SNNode *p = _nodes[parentId];
    if (!p || !p.view || !p.yoga) return;
    c.parentId = p.nid;

    if ([self rune_handleTextInsertionForParent:p
                                          child:c
                                        childId:childId
                                        atIndex:(NSUInteger)index.unsignedIntegerValue]) {
      return;
    }
    int i = (int)index.intValue;
    i = MAX(0, MIN(i, (int)p.view.subviews.count));

    if ([self sn_scrollViewDidInsertChild:p child:c atIndex:i]) {
      [p.children insertObject:childId atIndex:i];
      YGNodeInsertChild(p.yoga, c.yoga, (uint32_t)i);
      [self rune_markNeedsFlush];
      return;
    }

    [p.view insertSubview:c.view atIndex:i];
    [p.children insertObject:childId atIndex:i];
    YGNodeInsertChild(p.yoga, c.yoga, (uint32_t)i);
  }
  [self rune_markNeedsFlush];
}

- (void)removeChild:(NSNumber *)parentId child:(NSNumber *)childId {
  SNNode *c = _nodes[childId];
  if (!c || !c.view) return;
  [self sn_imageCleanupNode:c];
  [self sn_textInputCleanupNode:c];
  [self sn_secureTextInputCleanupNode:c];
  for (UIGestureRecognizer *gr in c.view.gestureRecognizers.copy) {
    [c.view removeGestureRecognizer:gr];
  }
  c.onPressCallback = nil;
  c.hasOnPressHandler = NO;

  if (parentId.intValue == 0) {
    [c.view removeFromSuperview];
    if (self.rootYoga && c.yoga) {
      YGNodeRemoveChild(self.rootYoga, c.yoga);
    }
    [self sn_scrollViewCleanupNode:c];
    c.parentId = -1;
  } else {
    SNNode *p = _nodes[parentId];
    if (!p || !p.yoga) return;

    if ([self rune_handleTextRemovalForParent:p child:c childId:childId]) {
      c.parentId = -1;
      return;
    }

    if ([self sn_scrollViewDidRemoveChild:p child:c]) {
      NSUInteger idx = [p.children indexOfObject:childId];
      if (idx != NSNotFound) [p.children removeObjectAtIndex:idx];
      if (c.yoga) {
        YGNodeRemoveChild(p.yoga, c.yoga);
      }
      [self sn_scrollViewCleanupNode:c];
      c.parentId = -1;
      [self rune_markNeedsFlush];
      return;
    }

    [c.view removeFromSuperview];
    NSUInteger idx = [p.children indexOfObject:childId];
    if (idx != NSNotFound) [p.children removeObjectAtIndex:idx];

    if (c.yoga) {
      YGNodeRemoveChild(p.yoga, c.yoga);
    }
    [self sn_scrollViewCleanupNode:c];
    c.parentId = -1;
  }
  [self rune_markNeedsFlush];
}

- (void)flush {
  [self rune_markNeedsFlush];
}

- (void)clearAllNodes {
  NSAssert([NSThread isMainThread], @"clearAllNodes must be called from main thread");
  
  [self rune_stopDisplayLink];
  self.needsFlush = NO;
  
  NSArray<UIView *> *subviews = [self.root.subviews copy];
  
  for (UIView *subview in subviews) {
    [UIView performWithoutAnimation:^{
      [subview removeFromSuperview];
    }];
  }
  
  [self.nodes removeAllObjects];
  
  [self.eventPayloads removeAllObjects];
  [self sn_textInputResetStates];
  
  if (self.rootYoga) {
    YGNodeFreeRecursive(self.rootYoga);
    self.rootYoga = NULL;
  }
  self.rootYoga = YGNodeNew();
  
  self.nextId = 1;
}

#pragma mark - Legacy bridge helpers

- (void)sn_startDisplayLinkIfNeeded {
  [self rune_startDisplayLinkIfNeeded];
}

- (void)sn_stopDisplayLink {
  [self rune_stopDisplayLink];
}

- (void)sn_markNeedsFlush {
  [self rune_markNeedsFlush];
}

- (void)sn_displayLinkTick:(CADisplayLink *)link {
  [self rune_displayLinkTick:link];
}

- (void)sn_performFlush {
  [self rune_performFlush];
}

- (NSString *)sn_eventKeyForNode:(int)nid name:(NSString *)name {
  return [self rune_eventKeyForNode:nid name:name];
}

- (void)sn_storeEventPayload:(NSDictionary *_Nullable)payload forNode:(SNNode *)node name:(NSString *)name {
  [self rune_storeEventPayload:payload forNode:node name:name];
}

- (void)sn_dispatchEvent:(NSString *)name payload:(NSDictionary *_Nullable)payload toNode:(SNNode *)node {
  [self rune_dispatchEvent:name payload:payload toNode:node];
}

- (NSDictionary *)dequeueEventPayloadForNode:(int)nodeId name:(NSString *)name {
  return [self rune_dequeueEventPayloadForNode:nodeId name:name];
}


@end
