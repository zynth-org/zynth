#import "SNUIManager.h"
#import "SNUIManager+Internal.h"
#import "RuneComponentRegistry.h"
#import "RuneUIManager+View.h"
#import "RuneUIManager+Events.h"
#import "RuneUIManager+Layout.h"
#import "SNHexColor.h"
#import <Yoga/Yoga.h>
#import <QuartzCore/QuartzCore.h>
#import <JavaScriptCore/JavaScriptCore.h>
#import <objc/message.h>

static NSString *const kRuneBorderLayerName = @"rune-border-style";
static const int kRuneSurfaceIdBase = 1 << 20;

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
@property(nonatomic, strong) NSMutableDictionary<NSNumber *, UIView *> *surfaceRoots;
@property(nonatomic, strong) NSMutableDictionary<NSNumber *, NSValue *> *surfaceYoga;
@property(nonatomic, assign) int activeSurfaceId;
@property(nonatomic, assign) int surfaceIdSeed;
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
  for (NSValue *value in _surfaceYoga.allValues) {
    YGNodeRef yoga = (YGNodeRef)value.pointerValue;
    if (yoga) {
      YGNodeFreeRecursive(yoga);
    }
  }
  _rootYoga = NULL;
}

- (instancetype)initWithRootView:(UIView *)rootView {
  if (self = [super init]) {
    _root = rootView;
    _nodes = [NSMutableDictionary new];
    _nextId = 1;
    _rootYoga = YGNodeNew();
    YGNodeStyleSetFlexDirection(_rootYoga, YGFlexDirectionColumn);
    YGNodeStyleSetAlignItems(_rootYoga, YGAlignStretch);
    _eventPayloads = [NSMutableDictionary new];
    _surfaceRoots = [NSMutableDictionary new];
    _surfaceYoga = [NSMutableDictionary new];
    _surfaceIdSeed = kRuneSurfaceIdBase;
    _activeSurfaceId = 0;

    CGRect screenBounds = [UIScreen mainScreen].bounds;
    rootView.frame = screenBounds;
    rootView.backgroundColor = [UIColor colorWithRed:0.06 green:0.07 blue:0.09 alpha:1.0];
    _surfaceRoots[@(0)] = rootView;
    _surfaceYoga[@(0)] = [NSValue valueWithPointer:_rootYoga];
  }
  return self;
}

- (int)rootSurfaceId { return 0; }

- (NSArray<NSNumber *> *)rune_allSurfaceIds {
  NSMutableSet<NSNumber *> *ids = [NSMutableSet setWithArray:self.surfaceRoots.allKeys];
  [ids addObject:@(0)];
  return ids.allObjects;
}

- (UIView *_Nullable)rune_rootViewForSurface:(int)surfaceId {
  if (surfaceId == 0) {
    return self.root;
  }
  return self.surfaceRoots[@(surfaceId)];
}

- (YGNodeRef)rune_rootYogaForSurface:(int)surfaceId {
  if (surfaceId == 0) {
    return self.rootYoga;
  }
  NSValue *value = self.surfaceYoga[@(surfaceId)];
  return (YGNodeRef)value.pointerValue;
}

- (BOOL)rune_hasSurface:(int)surfaceId {
  return [self rune_rootViewForSurface:surfaceId] != nil;
}

- (BOOL)rune_isSurfaceRootId:(NSNumber *)nodeId {
  if (!nodeId) return NO;
  int sid = nodeId.intValue;
  return sid == self.rootSurfaceId || self.surfaceRoots[@(sid)] != nil;
}

- (int)rune_allocateSurfaceId {
  int candidate = self.surfaceIdSeed;
  while (self.surfaceRoots[@(candidate)] != nil) {
    candidate++;
  }
  self.surfaceIdSeed = candidate + 1;
  return candidate;
}

- (NSNumber *)registerSurfaceWithRootView:(UIView *)rootView {
  return [self registerSurfaceWithRootView:rootView surfaceId:nil];
}

- (NSNumber *)registerSurfaceWithRootView:(UIView *)rootView surfaceId:(NSNumber *_Nullable)surfaceId {
  NSAssert([NSThread isMainThread], @"registerSurfaceWithRootView must be called on main thread");
  int sid = 0;
  if (surfaceId != nil) {
    sid = surfaceId.intValue;
  } else {
    // Allocate surface ids well above any existing node id to prevent collisions.
    int candidate = [self rune_allocateSurfaceId];
    int minSafe = self.nextId + kRuneSurfaceIdBase;
    if (candidate < minSafe) {
      candidate = minSafe;
    }
    while ([self rune_hasSurface:candidate]) {
      candidate += kRuneSurfaceIdBase;
    }
    sid = candidate;
  }
  if ([self rune_hasSurface:sid]) {
    return @(sid);
  }
  if (self.nextId <= sid) {
    self.nextId = sid + 1;
  }
  YGNodeRef yoga = YGNodeNew();
  YGNodeStyleSetFlexDirection(yoga, YGFlexDirectionColumn);
  YGNodeStyleSetAlignItems(yoga, YGAlignStretch);
  self.surfaceRoots[@(sid)] = rootView;
  self.surfaceYoga[@(sid)] = [NSValue valueWithPointer:yoga];
  return @(sid);
}

- (void)unregisterSurface:(int)surfaceId {
  if (surfaceId == 0) {
    NSLog(@"[SNUIManager] Ignoring attempt to unregister root surface");
    return;
  }
  UIView *rootView = self.surfaceRoots[@(surfaceId)];
  NSValue *yogaValue = self.surfaceYoga[@(surfaceId)];
  if (!rootView || !yogaValue) {
    return;
  }
  NSArray<NSNumber *> *allKeys = [self.nodes allKeys];
  for (NSNumber *key in allKeys) {
    SNNode *node = self.nodes[key];
    if (!node || node.surfaceId != surfaceId) continue;

    RuneComponentDescriptor *descriptor = RuneGetComponentDescriptor(node.type);
    if (descriptor && descriptor.cleanup) {
      descriptor.cleanup(self, node);
    }
    for (UIGestureRecognizer *gr in node.view.gestureRecognizers.copy) {
      [node.view removeGestureRecognizer:gr];
    }
    node.onPressCallback = nil;
    node.hasOnPressHandler = NO;
    [node.view removeFromSuperview];
    [self.nodes removeObjectForKey:key];
  }
  for (UIView *subview in [rootView.subviews copy]) {
    [subview removeFromSuperview];
  }
  YGNodeRef yoga = (YGNodeRef)yogaValue.pointerValue;
  if (yoga) {
    YGNodeFreeRecursive(yoga);
  }
  [self.surfaceRoots removeObjectForKey:@(surfaceId)];
  [self.surfaceYoga removeObjectForKey:@(surfaceId)];
  if (self.activeSurfaceId == surfaceId) {
    self.activeSurfaceId = self.rootSurfaceId;
  }
}

- (void)setActiveSurface:(int)surfaceId {
  if (![self rune_hasSurface:surfaceId]) {
    NSLog(@"[SNUIManager] Attempted to activate unknown surface %d", surfaceId);
    return;
  }
  self.activeSurfaceId = surfaceId;
}
- (NSNumber *)createNode:(NSString *)type {
  int nid = _nextId++;
  UIView *v = nil;

  RuneComponentDescriptor *componentDescriptor = RuneGetComponentDescriptor(type);
  if (componentDescriptor && componentDescriptor.createView) {
    v = componentDescriptor.createView(self, type);
  }

  if (!v) {
    // Fallback: create a basic UIView for unknown types
    NSLog(@"[RuneKit] WARNING: No descriptor found for type '%@', using fallback UIView", type);
    v = [[UIView alloc] init];
  }

  SNNode *n = [SNNode new];
  n.nid = nid;
  n.view = v;
  n.yoga = YGNodeNew();
  n.children = [NSMutableArray new];
  n.parentId = -1;
  n.pointerEvents = @"auto"; // Default pointerEvents state
  n.type = type;
  n.surfaceId = self.activeSurfaceId;

  if (!n.yoga) {
    NSLog(@"[SN] ERROR: Failed to create Yoga node for nid=%d", nid);
    return @(nid);
  }

  YGNodeStyleSetFlexDirection(n.yoga, YGFlexDirectionColumn);
  // Ensure children stretch to full width by default (matches Android behavior)
  YGNodeStyleSetAlignItems(n.yoga, YGAlignStretch);

  _nodes[@(nid)] = n;

  if (componentDescriptor && componentDescriptor.attach) {
    componentDescriptor.attach(self, n);
  }

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
  NSNumber *opacityValue = style[@"opacity"];
  if (opacityValue) {
    CGFloat resolvedOpacity = (CGFloat)SNNum(opacityValue);
    resolvedOpacity = MAX(0.f, MIN(1.f, resolvedOpacity));
    n.view.alpha = resolvedOpacity;
  } else {
    n.view.alpha = 1.f;
  }

  NSNumber *zIndexValue = style[@"zIndex"];
  if (zIndexValue) {
    n.view.layer.zPosition = (CGFloat)SNNum(zIndexValue);
  } else {
    n.view.layer.zPosition = 0.f;
  }

  NSNumber *br = style[@"borderRadius"];
  if (br) { n.view.layer.cornerRadius = (CGFloat)SNNum(br); n.view.clipsToBounds = YES; }
  SNApplyBorderStyleToView(n.view, style[@"borderWidth"], style[@"borderColor"], style[@"borderStyle"]);

  // TextInput-specific styling - done via selector check to avoid import
  if ([n.view respondsToSelector:@selector(applyPlaceholderToneFromTextColor)]) {
    NSNumber *fs = style[@"fontSize"];
    CGFloat currentSize = [n.view respondsToSelector:@selector(font)] ? ((UITextView *)n.view).font.pointSize : 16.0;
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

    if ([n.view respondsToSelector:@selector(setFont:)]) {
      ((UITextView *)n.view).font = [UIFont systemFontOfSize:targetSize weight:targetWeight];
    }

    NSString *color = style[@"color"];
    if (color && [n.view respondsToSelector:@selector(setTextColor:)]) {
      ((UITextView *)n.view).textColor = SNColorFromHex(color);
      [n.view performSelector:@selector(applyPlaceholderToneFromTextColor)];
    }
      
    CGFloat top = [style[@"paddingTop"] ?: style[@"paddingVertical"] ?: style[@"padding"] floatValue];
    CGFloat left = [style[@"paddingLeft"] ?: style[@"paddingHorizontal"] ?: style[@"padding"] floatValue];
    CGFloat bottom = [style[@"paddingBottom"] ?: style[@"paddingVertical"] ?: style[@"padding"] floatValue];
    CGFloat right = [style[@"paddingRight"] ?: style[@"paddingHorizontal"] ?: style[@"padding"] floatValue];
    
    if ([n.view respondsToSelector:@selector(setTextContainerInset:)]) {
      ((UITextView *)n.view).textContainerInset = UIEdgeInsetsMake(top, left, bottom, right);
    }

    if ([n.view respondsToSelector:@selector(placeholderLeadingConstraint)]) {
        NSLayoutConstraint *constraint = [n.view performSelector:@selector(placeholderLeadingConstraint)];
        if (constraint) {
            constraint.constant = left;
        }
    }
    if ([n.view respondsToSelector:@selector(placeholderTopConstraint)]) {
        NSLayoutConstraint *constraint = [n.view performSelector:@selector(placeholderTopConstraint)];
        if (constraint) {
            constraint.constant = top;
        }
    }

    if (n.yoga && YGNodeGetOwner(n.yoga)) {
      YGNodeMarkDirty(n.yoga);
    }
  }
    
  // SecureTextInput-specific styling - done via selector check to avoid import
  if ([n.view respondsToSelector:@selector(applyPlaceholderToneFromTextColor)] && 
      [n.view respondsToSelector:@selector(padding)]) {
    NSNumber *fs = style[@"fontSize"];
    CGFloat currentSize = [n.view respondsToSelector:@selector(font)] ? ((UITextField *)n.view).font.pointSize : 16.0;
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

    if ([n.view respondsToSelector:@selector(setFont:)]) {
      ((UITextField *)n.view).font = [UIFont systemFontOfSize:targetSize weight:targetWeight];
    }

    NSString *color = style[@"color"];
    if (color && [n.view respondsToSelector:@selector(setTextColor:)]) {
      ((UITextField *)n.view).textColor = SNColorFromHex(color);
      [n.view performSelector:@selector(applyPlaceholderToneFromTextColor)];
    }

    CGFloat top = [style[@"paddingTop"] ?: style[@"paddingVertical"] ?: style[@"padding"] floatValue];
    CGFloat left = [style[@"paddingLeft"] ?: style[@"paddingHorizontal"] ?: style[@"padding"] floatValue];
    CGFloat bottom = [style[@"paddingBottom"] ?: style[@"paddingVertical"] ?: style[@"padding"] floatValue];
    CGFloat right = [style[@"paddingRight"] ?: style[@"paddingHorizontal"] ?: style[@"padding"] floatValue];
    
    if ([n.view respondsToSelector:@selector(setPadding:)]) {
      [n.view performSelector:@selector(setPadding:) 
                 withObject:[NSValue valueWithUIEdgeInsets:UIEdgeInsetsMake(top, left, bottom, right)]];
    }

    if (n.yoga && YGNodeGetOwner(n.yoga)) {
      YGNodeMarkDirty(n.yoga);
    }
  }
}

- (void)setProp:(NSNumber *)nodeId name:(NSString *)name valueJSON:(NSString *)json {
  SNNode *n = _nodes[nodeId];
  if (!n || !n.view) return;

  RuneComponentDescriptor *componentDescriptor = RuneGetComponentDescriptor(n.type);
  BOOL pointerEventsHandled = NO;

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
    pointerEventsHandled = YES;
  }

  if ([name isEqualToString:@"testID"]) {
    n.view.accessibilityIdentifier = stringValue;
    return;
  }

  if (componentDescriptor && componentDescriptor.handleSetProp) {
    if (componentDescriptor.handleSetProp(self, n, name, value, json)) {
      return;
    }
  }

  if (pointerEventsHandled) {
    return;
  }
}

- (void)setStyle:(NSNumber *)nodeId style:(NSDictionary *)style {
  SNNode *n = _nodes[nodeId];
  if (!n || !n.view) return;
  
  // Check if component has custom style handling
  RuneComponentDescriptor *componentDescriptor = RuneGetComponentDescriptor(n.type);
  if (componentDescriptor && componentDescriptor.applyStyle) {
    componentDescriptor.applyStyle(self, n, style);
  }
  
  [self sn_applyStyleDictionary:style toNode:n];
  [self rune_markNeedsFlush];
}

- (void)setPropCallback:(NSNumber *)nodeId name:(NSString *)name callback:(JSValue *)callback {
  SNNode *n = _nodes[nodeId];
  if (!n || !n.view) return;

  RuneComponentDescriptor *componentDescriptor = RuneGetComponentDescriptor(n.type);
  
  if (componentDescriptor && componentDescriptor.handleSetPropCallback) {
    if (componentDescriptor.handleSetPropCallback(self, n, name, callback)) {
      return;
    }
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
}

- (void)setHandler:(NSNumber *)nodeId name:(NSString *)name {
  SNNode *n = _nodes[nodeId];
  if (!n || !n.view) return;

  RuneComponentDescriptor *componentDescriptor = RuneGetComponentDescriptor(n.type);

  if (componentDescriptor && componentDescriptor.handleSetHandler) {
    if (componentDescriptor.handleSetHandler(self, n, name)) {
      return;
    }
  }

  if ([name isEqualToString:@"onPress"]) {
    n.onPressCallback = nil;
    [self rune_attachTapRecognizerForNode:n];
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

  // Check if component has custom text handling via prop
  RuneComponentDescriptor *componentDescriptor = RuneGetComponentDescriptor(n.type);
  if (componentDescriptor && componentDescriptor.handleSetProp) {
    if (componentDescriptor.handleSetProp(self, n, @"text", text, nil)) {
      return;
    }
  }

  // Fallback to TextInput handling via selector check
  if ([n.view respondsToSelector:@selector(performProgrammaticUpdate:)]) {
    // Handle TextInput views via selector
    void (^updateBlock)(void) = ^{
      if ([n.view respondsToSelector:@selector(setText:)]) {
        [n.view performSelector:@selector(setText:) withObject:(text ?: @"")];
      }
    };
    [n.view performSelector:@selector(performProgrammaticUpdate:) withObject:updateBlock];
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

  if ([self rune_isSurfaceRootId:parentId]) {
    UIView *rootView = [self rune_rootViewForSurface:parentId.intValue];
    YGNodeRef rootYoga = [self rune_rootYogaForSurface:parentId.intValue];
    if (!rootView || !rootYoga) return;

    int i = (int)index.intValue;
    i = MAX(0, MIN(i, (int)rootView.subviews.count));
    [rootView insertSubview:c.view atIndex:i];
    YGNodeInsertChild(rootYoga, c.yoga, (uint32_t)MIN(i, (int)YGNodeGetChildCount(rootYoga)));
    c.parentId = parentId.intValue;
    c.surfaceId = parentId.intValue;
  } else {
    SNNode *p = _nodes[parentId];
    if (!p || !p.view || !p.yoga) return;
    c.parentId = p.nid;
    c.surfaceId = p.surfaceId;

    // Check if parent component has custom child insertion logic
    RuneComponentDescriptor *parentDescriptor = RuneGetComponentDescriptor(p.type);
    if (parentDescriptor && parentDescriptor.handleInsertChild) {
      if (parentDescriptor.handleInsertChild(self, p, c, childId, (NSUInteger)index.unsignedIntegerValue)) {
        return;
      }
    }

    int i = (int)index.intValue;
    i = MAX(0, MIN(i, (int)p.view.subviews.count));

    // Check if parent is a scroll view component
    BOOL isScrollViewParent = [p.view respondsToSelector:@selector(insertContentSubview:atIndex:)];
    if (isScrollViewParent) {
      typedef void (*RuneScrollInsertIMP)(id, SEL, UIView *, NSInteger);
      RuneScrollInsertIMP insertIMP = (RuneScrollInsertIMP)objc_msgSend;
      insertIMP(p.view, @selector(insertContentSubview:atIndex:), c.view, i);
    } else {
      [p.view insertSubview:c.view atIndex:i];
    }
    [p.children insertObject:childId atIndex:i];
    if (c.yoga) {
      YGNodeRef owner = YGNodeGetOwner(c.yoga);
      if (owner) {
        YGNodeRemoveChild(owner, c.yoga);
      }
      YGNodeInsertChild(p.yoga, c.yoga, (uint32_t)i);
    }
  }
  [self rune_markNeedsFlush];
}

- (void)removeChild:(NSNumber *)parentId child:(NSNumber *)childId {
  SNNode *c = _nodes[childId];
  if (!c || !c.view) return;
  
  RuneComponentDescriptor *componentDescriptor = RuneGetComponentDescriptor(c.type);
  if (componentDescriptor && componentDescriptor.cleanup) {
    componentDescriptor.cleanup(self, c);
  }
  
  for (UIGestureRecognizer *gr in c.view.gestureRecognizers.copy) {
    [c.view removeGestureRecognizer:gr];
  }
  c.onPressCallback = nil;
  c.hasOnPressHandler = NO;

  if ([self rune_isSurfaceRootId:parentId]) {
    UIView *rootView = [self rune_rootViewForSurface:parentId.intValue];
    YGNodeRef rootYoga = [self rune_rootYogaForSurface:parentId.intValue];
    [c.view removeFromSuperview];
    if (rootYoga && c.yoga) {
      YGNodeRemoveChild(rootYoga, c.yoga);
    }
    c.parentId = -1;
  } else {
    SNNode *p = _nodes[parentId];
    if (!p || !p.yoga) return;

    // Check if parent component has custom child removal logic
    RuneComponentDescriptor *parentDescriptor = RuneGetComponentDescriptor(p.type);
    if (parentDescriptor && parentDescriptor.handleRemoveChild) {
      if (parentDescriptor.handleRemoveChild(self, p, c, childId)) {
        c.parentId = -1;
        return;
      }
    }

    // Check if parent is a scroll view component
    BOOL isScrollViewParent = [p.view respondsToSelector:@selector(removeContentSubview:)];
    if (isScrollViewParent) {
      typedef void (*RuneScrollRemoveIMP)(id, SEL, UIView *);
      RuneScrollRemoveIMP removeIMP = (RuneScrollRemoveIMP)objc_msgSend;
      removeIMP(p.view, @selector(removeContentSubview:), c.view);
    } else {
      [c.view removeFromSuperview];
    }
    NSUInteger idx = [p.children indexOfObject:childId];
    if (idx != NSNotFound) [p.children removeObjectAtIndex:idx];

    if (c.yoga) {
      YGNodeRef owner = YGNodeGetOwner(c.yoga);
      if (owner) {
        YGNodeRemoveChild(owner, c.yoga);
      }
    }
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
  
  for (UIView *rootView in self.surfaceRoots.allValues) {
    NSArray<UIView *> *subviews = [rootView.subviews copy];
    for (UIView *subview in subviews) {
      [UIView performWithoutAnimation:^{
        [subview removeFromSuperview];
      }];
    }
  }

  [self.nodes removeAllObjects];
  
  [self.eventPayloads removeAllObjects];
  
  for (NSValue *value in self.surfaceYoga.allValues) {
    YGNodeRef yoga = (YGNodeRef)value.pointerValue;
    if (yoga) {
      YGNodeFreeRecursive(yoga);
    }
  }
  [self.surfaceRoots removeAllObjects];
  [self.surfaceYoga removeAllObjects];
  self.rootYoga = YGNodeNew();
  YGNodeStyleSetFlexDirection(self.rootYoga, YGFlexDirectionColumn);
  YGNodeStyleSetAlignItems(self.rootYoga, YGAlignStretch);
  self.surfaceYoga[@(self.rootSurfaceId)] = [NSValue valueWithPointer:self.rootYoga];
  self.surfaceRoots[@(self.rootSurfaceId)] = self.root;
  self.surfaceIdSeed = kRuneSurfaceIdBase;
  self.activeSurfaceId = self.rootSurfaceId;
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
