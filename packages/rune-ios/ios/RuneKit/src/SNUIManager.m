#import "SNUIManager.h"
#import "SNUIManager+Internal.h"
#import "RuneComponentRegistry.h"
#import "RuneUIManager+View.h"
#import "RuneUIManager+Events.h"
#import "RuneUIManager+Layout.h"
#import "SNHexColor.h"
#import "utils/RuneTransformParser.h"
#import "utils/RuneGradientParser.h"
#import "utils/RuneShadowParser.h"
#import <Yoga/Yoga.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/message.h>
#import <stdatomic.h>

static NSString *const kRuneBorderLayerName = @"rune-border-style";
static NSString *const kRuneGradientLayerName = @"rune-background-gradient";
static const int kRuneSurfaceIdBase = 1 << 20;
static const double kRuneBatchTimeBudgetMs = 4.0;
static const NSUInteger kRuneBatchMaxOps = 200;

static NSString *SNJSONStringForBatchValue(id value) {
  if (!value || value == [NSNull null]) {
    return @"null";
  }

  if ([NSJSONSerialization isValidJSONObject:value]) {
    NSError *error = nil;
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:&error];
    if (data && !error) {
      return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    }
  }

  id boxable = value;
  if (![value isKindOfClass:[NSString class]] && ![value isKindOfClass:[NSNumber class]]) {
    boxable = [value description] ?: @"";
  }

  NSError *primitiveError = nil;
  NSData *wrapped = [NSJSONSerialization dataWithJSONObject:@[boxable] options:0 error:&primitiveError];
  if (wrapped && !primitiveError) {
    NSString *arrayJSON = [[NSString alloc] initWithData:wrapped encoding:NSUTF8StringEncoding];
    if (arrayJSON.length >= 2) {
      return [arrayJSON substringWithRange:NSMakeRange(1, arrayJSON.length - 2)];
    }
  }

  return @"null";
}

// Atomic counter for allocating unique guest surface IDs (mirrors Android's NEXT_ROOT_ID)
static _Atomic int sNextGuestSurfaceId = kRuneSurfaceIdBase;

#if __has_include(<RuneKit/RuneKit-Swift.h>)
#import <RuneKit/RuneKit-Swift.h>
#elif __has_include("RuneKit-Swift.h")
#import "RuneKit-Swift.h"
#endif

@interface SNUIManager ()
@property(nonatomic, strong) UIView *root;
@property(nonatomic, strong) RuneComponentRegistry *componentRegistry;
@property(nonatomic, strong) NSMutableDictionary<NSNumber *, SNNode *> *nodes;
@property(nonatomic, assign) int nextId;
@property(nonatomic, assign) YGNodeRef rootYoga;
@property(nonatomic, strong) NSMutableDictionary<NSNumber *, UIView *> *surfaceRoots;
@property(nonatomic, strong) NSMutableDictionary<NSNumber *, NSValue *> *surfaceYoga;
@property(nonatomic, assign) int activeSurfaceId;
@property(nonatomic, assign) int surfaceIdSeed;
@property(nonatomic, assign) int primarySurfaceId; // The surface ID for this manager's root view
@property(nonatomic, strong, nullable) CADisplayLink *displayLink;
@property(nonatomic, assign) BOOL needsFlush;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSDictionary *> *eventPayloads;
@property(nonatomic, strong) NSMutableDictionary<NSNumber *, NSMutableArray<dispatch_block_t> *> *surfaceFirstFrameListeners;
@property(nonatomic, strong) NSMutableSet<NSNumber *> *surfaceFirstFrameDispatched;
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
  return [self initWithRootView:rootView isGuest:NO];
}

- (instancetype)initWithRootView:(UIView *)rootView isGuest:(BOOL)isGuest {
  if (self = [super init]) {
    _componentRegistry = [RuneComponentRegistry shared];
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
    _surfaceFirstFrameListeners = [NSMutableDictionary new];
    _surfaceFirstFrameDispatched = [NSMutableSet new];

    // For guest runtimes (e.g., Hypervisor), allocate a unique surface ID to avoid
    // conflicts with the host app's surface 0
    if (isGuest) {
      _primarySurfaceId = atomic_fetch_add(&sNextGuestSurfaceId, 1);
      _activeSurfaceId = _primarySurfaceId;
      // Guest views inherit their frame from their container; don't force screen bounds
      _surfaceRoots[@(_primarySurfaceId)] = rootView;
      _surfaceYoga[@(_primarySurfaceId)] = [NSValue valueWithPointer:_rootYoga];
    } else {
      _primarySurfaceId = 0;
      _activeSurfaceId = 0;
      CGRect screenBounds = [UIScreen mainScreen].bounds;
      rootView.frame = screenBounds;
      rootView.backgroundColor = [UIColor colorWithRed:0.9686 green:0.9686 blue:0.9686 alpha:1.0]; // #f7f7f7
      _surfaceRoots[@(0)] = rootView;
      _surfaceYoga[@(0)] = [NSValue valueWithPointer:_rootYoga];
    }
  }
  return self;
}

- (int)rootSurfaceId { return _primarySurfaceId; }

- (int)rune_rootSurfaceId { return _primarySurfaceId; }

- (NSArray<NSNumber *> *)rune_allSurfaceIds {
  // Return all registered surface IDs (surfaceRoots already contains the primary surface)
  return self.surfaceRoots.allKeys;
}

- (UIView *_Nullable)rune_rootViewForSurface:(int)surfaceId {
  // For the primary surface, self.root is registered in surfaceRoots during init
  return self.surfaceRoots[@(surfaceId)];
}

- (YGNodeRef)rune_rootYogaForSurface:(int)surfaceId {
  // For the primary surface, rootYoga is registered in surfaceYoga during init
  NSValue *value = self.surfaceYoga[@(surfaceId)];
  return value ? (YGNodeRef)value.pointerValue : NULL;
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
  [self.surfaceFirstFrameDispatched removeObject:@(sid)];
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

    RuneComponentDescriptor *descriptor = [self.componentRegistry getDescriptor:node.type];
    if (descriptor && descriptor.cleanup) {
      descriptor.cleanup(self, node);
    }
    for (UIGestureRecognizer *gr in node.view.gestureRecognizers.copy) {
      [node.view removeGestureRecognizer:gr];
    }
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
  [self.surfaceFirstFrameListeners removeObjectForKey:@(surfaceId)];
  [self.surfaceFirstFrameDispatched removeObject:@(surfaceId)];
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

- (void)addSurfaceFirstFrameListener:(int)surfaceId listener:(dispatch_block_t)listener {
  if (!listener) return;
  dispatch_block_t copied = [listener copy];
  if (![NSThread isMainThread]) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self addSurfaceFirstFrameListener:surfaceId listener:copied];
    });
    return;
  }
  NSNumber *key = @(surfaceId);
  if ([self.surfaceFirstFrameDispatched containsObject:key]) {
    copied();
    return;
  }
  NSMutableArray<dispatch_block_t> *listeners = self.surfaceFirstFrameListeners[key];
  if (!listeners) {
    listeners = [NSMutableArray new];
    self.surfaceFirstFrameListeners[key] = listeners;
  }
  [listeners addObject:copied];
}

- (void)removeSurfaceFirstFrameListener:(int)surfaceId listener:(dispatch_block_t)listener {
  if (!listener) return;
  if (![NSThread isMainThread]) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self removeSurfaceFirstFrameListener:surfaceId listener:listener];
    });
    return;
  }
  NSNumber *key = @(surfaceId);
  NSMutableArray<dispatch_block_t> *listeners = self.surfaceFirstFrameListeners[key];
  if (!listeners) return;
  [listeners removeObject:listener];
  if (listeners.count == 0) {
    [self.surfaceFirstFrameListeners removeObjectForKey:key];
  }
}

- (void)rune_dispatchSurfaceFirstFrameIfNeeded:(int)surfaceId {
  if (![NSThread isMainThread]) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self rune_dispatchSurfaceFirstFrameIfNeeded:surfaceId];
    });
    return;
  }
  NSNumber *key = @(surfaceId);
  if ([self.surfaceFirstFrameDispatched containsObject:key]) return;
  UIView *rootView = [self rune_rootViewForSurface:surfaceId];
  if (!rootView || !rootView.window) return;
  [self.surfaceFirstFrameDispatched addObject:key];
  NSArray<dispatch_block_t> *listeners = [self.surfaceFirstFrameListeners[key] copy];
  [self.surfaceFirstFrameListeners removeObjectForKey:key];
  for (dispatch_block_t callback in listeners) {
    callback();
  }
}
- (NSNumber *)createNode:(NSString *)type {
  int nid = _nextId++;
  UIView *v = nil;

  RuneComponentDescriptor *componentDescriptor = [self.componentRegistry getDescriptor:type];
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
  n.layoutTransition = nil;
  n.transformOrigin = nil;
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

static BOOL SNStyleValueEqual(id a, id b) {
  if (SNIsNullish(a) && SNIsNullish(b)) return YES;
  if (a == nil || a == (id)kCFNull) return NO;
  return [a isEqual:b];
}

static NSArray<NSString *> *SNViewStyleKeys(void) {
  static NSArray<NSString *> *keys = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    keys = @[
      @"background",
      @"backgroundImage",
      @"backgroundColor",
      @"borderColor",
      @"borderWidth",
      @"borderRadius",
      @"borderStyle",
      @"borderTopWidth",
      @"borderRightWidth",
      @"borderBottomWidth",
      @"borderLeftWidth",
      @"borderTopLeftRadius",
      @"borderTopRightRadius",
      @"borderBottomRightRadius",
      @"borderBottomLeftRadius",
      @"borderTopColor",
      @"borderRightColor",
      @"borderBottomColor",
      @"borderLeftColor",
      @"boxShadow",
      @"shadowColor",
      @"shadowOpacity",
      @"shadowRadius",
      @"shadowOffset",
      @"elevation",
      @"opacity",
      @"zIndex",
      @"transform",
      @"transformOrigin",
      @"fontFamily",
      @"fontSize",
      @"fontWeight",
      @"fontStyle",
      @"color",
      @"textAlign",
      @"textDecorationLine",
      @"textTransform",
      @"letterSpacing",
      @"lineHeight",
      @"lineSpacing",
      @"paragraphSpacing",
      @"baselineShift",
      @"minimumFontScale",
      @"padding",
      @"paddingHorizontal",
      @"paddingVertical",
      @"paddingTop",
      @"paddingRight",
      @"paddingBottom",
      @"paddingLeft",
      @"overflow",
    ];
  });
  return keys;
}

static BOOL SNStyleMatchesKeys(NSDictionary *a, NSDictionary *b, NSArray<NSString *> *keys) {
  if (!a || !b) return NO;
  for (NSString *key in keys) {
    if (!SNStyleValueEqual(a[key], b[key])) {
      return NO;
    }
  }
  return YES;
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
    if ([layer.name isEqualToString:kRuneGradientLayerName]) {
      [layer removeFromSuperlayer];
    }
  }
}

static NSArray<NSNumber *> *SNResolveGradientLocations(NSArray<RuneGradientStop *> *stops) {
  NSUInteger count = stops.count;
  if (count == 0) return nil;
  NSMutableArray<NSNumber *> *locations = [NSMutableArray arrayWithCapacity:count];
  for (NSUInteger i = 0; i < count; i++) {
    [locations addObject:@(NAN)];
  }

  NSInteger lastIdx = -1;
  CGFloat lastPos = 0.f;
  for (NSUInteger i = 0; i < count; i++) {
    NSNumber *posNum = stops[i].position;
    if (posNum) {
      CGFloat p = fmax(0.f, fmin(1.f, posNum.floatValue));
      locations[i] = @(p);
      if (lastIdx == -1) {
        if (i > 0) {
          CGFloat step = p / (CGFloat)(i + 1);
          for (NSUInteger k = 0; k < i; k++) {
            locations[k] = @(step * (CGFloat)(k + 1));
          }
        }
      } else if (i - (NSUInteger)lastIdx > 1) {
        NSUInteger span = i - (NSUInteger)lastIdx;
        CGFloat step = (p - lastPos) / (CGFloat)span;
        for (NSUInteger k = (NSUInteger)lastIdx + 1; k < i; k++) {
          locations[k] = @(lastPos + step * (CGFloat)(k - (NSUInteger)lastIdx));
        }
      }
      lastIdx = (NSInteger)i;
      lastPos = p;
    }
  }

  if (lastIdx == -1) {
    if (count == 1) {
      locations[0] = @0.f;
    } else {
      CGFloat step = 1.f / (CGFloat)(count - 1);
      for (NSUInteger k = 0; k < count; k++) {
        locations[k] = @(step * (CGFloat)k);
      }
    }
  } else if ((NSUInteger)lastIdx < count - 1) {
    NSUInteger span = (count - 1) - (NSUInteger)lastIdx;
    CGFloat step = (1.f - lastPos) / (CGFloat)span;
    for (NSUInteger k = (NSUInteger)lastIdx + 1; k < count; k++) {
      locations[k] = @(lastPos + step * (CGFloat)(k - (NSUInteger)lastIdx));
    }
  }

  CGFloat prev = [[locations firstObject] floatValue];
  prev = fmax(0.f, fmin(1.f, prev));
  locations[0] = @(prev);
  for (NSUInteger i = 1; i < count; i++) {
    CGFloat p = [locations[i] floatValue];
    if (isnan(p)) p = prev;
    p = fmax(prev, fmin(1.f, p));
    locations[i] = @(p);
    prev = p;
  }

  return locations;
}

void SNApplyGradientToView(UIView *view, RuneLinearGradient *gradient) {
  if (!view) return;

  NSArray<CALayer *> *sublayers = [view.layer.sublayers copy];
  for (CALayer *layer in sublayers) {
    if ([layer.name isEqualToString:kRuneGradientLayerName]) {
      [layer removeFromSuperlayer];
    }
  }

  if (!gradient || gradient.stops.count < 2) return;

  NSMutableArray *colors = [NSMutableArray arrayWithCapacity:gradient.stops.count];
  for (RuneGradientStop *stop in gradient.stops) {
    if (stop.color) {
      [colors addObject:(__bridge id)stop.color.CGColor];
    }
  }
  if (colors.count < 2) return;

  NSArray<NSNumber *> *locations = SNResolveGradientLocations(gradient.stops);

  CGFloat angleRad = gradient.angle * (CGFloat)M_PI / 180.f;
  CGFloat dx = sin(angleRad);
  CGFloat dy = -cos(angleRad);
  CGPoint startPoint = CGPointMake(0.5f - dx / 2.f, 0.5f - dy / 2.f);
  CGPoint endPoint = CGPointMake(0.5f + dx / 2.f, 0.5f + dy / 2.f);

  CAGradientLayer *layer = [CAGradientLayer layer];
  layer.name = kRuneGradientLayerName;
  layer.frame = view.bounds;
  layer.needsDisplayOnBoundsChange = YES;
  layer.startPoint = startPoint;
  layer.endPoint = endPoint;
  layer.colors = colors;
  layer.locations = locations;
  layer.cornerRadius = view.layer.cornerRadius;
  layer.masksToBounds = view.layer.masksToBounds;

  [view.layer insertSublayer:layer atIndex:0];
}

static void SNApplyShadowStyleToView(UIView *view, NSArray<RuneShadowLayer *> *layers, NSNumber *elevation) {
  if (!view) return;

  NSMutableArray<RuneShadowLayer *> *effectiveLayers = [layers mutableCopy];
  if (!effectiveLayers && elevation) {
    effectiveLayers = [NSMutableArray array];
  }
  if (effectiveLayers.count == 0 && elevation) {
    CGFloat e = MAX(0.f, (CGFloat)SNNum(elevation));
    UIColor *color = [[UIColor blackColor] colorWithAlphaComponent:0.25];
    RuneShadowLayer *synthetic = [[RuneShadowLayer alloc] initWithOffsetX:0 offsetY:e / 2.f blurRadius:e spread:0 color:color inset:NO];
    [effectiveLayers addObject:synthetic];
  }

  if (effectiveLayers.count == 0 && !elevation) {
    view.layer.shadowOpacity = 0.f;
    view.layer.shadowRadius = 0.f;
    view.layer.shadowOffset = CGSizeZero;
    view.layer.shadowColor = nil;
    view.layer.shadowPath = nil;
    return;
  }

  // Remove existing shadow-only sublayers
  NSArray<CALayer *> *sublayers = [view.layer.sublayers copy];
  for (CALayer *layer in sublayers) {
    if ([layer.name isEqualToString:@"rune-shadow-layer"]) {
      [layer removeFromSuperlayer];
    }
  }

  RuneShadowLayer *primary = effectiveLayers.firstObject;
  if (primary) {
    view.layer.shadowColor = primary.color.CGColor;
    CGFloat alpha = CGColorGetAlpha(primary.color.CGColor);
    view.layer.shadowOpacity = alpha > 0 ? alpha : 1.f;
    view.layer.shadowRadius = primary.blurRadius;
    view.layer.shadowOffset = CGSizeMake(primary.offsetX, primary.offsetY);
    view.layer.masksToBounds = NO;
  } else {
    view.layer.shadowOpacity = 0.f;
    view.layer.shadowRadius = 0.f;
    view.layer.shadowOffset = CGSizeZero;
    view.layer.shadowColor = nil;
    view.layer.shadowPath = nil;
  }

  CGPathRef maskPath = nil;
  if ([view.layer.mask isKindOfClass:[CAShapeLayer class]]) {
    maskPath = ((CAShapeLayer *)view.layer.mask).path;
  }
  if (maskPath) {
    view.layer.shadowPath = maskPath;
  } else if (view.layer.cornerRadius > 0) {
    UIBezierPath *path = [UIBezierPath bezierPathWithRoundedRect:view.bounds cornerRadius:view.layer.cornerRadius];
    view.layer.shadowPath = path.CGPath;
  } else {
    view.layer.shadowPath = nil;
  }

  // Additional shadows use dedicated layers stacked behind
  // Multiple shadows intentionally not drawn to match Android limitation and keep layer stack simple.

  if (elevation) {
    CGFloat e = MAX(0.f, (CGFloat)SNNum(elevation));
    if (e > 0) {
      view.layer.shadowOpacity = MAX(view.layer.shadowOpacity, 0.0001f);
      view.layer.shadowRadius = MAX(view.layer.shadowRadius, e);
    }
  }
}

static void SNApplyBorderStyleToView(UIView *view, NSDictionary *style, BOOL overflowClip) {
  SNRemoveCustomBorderLayers(view); // Removes all layers named kRuneBorderLayerName
  
  // Reset standard layer properties
  view.layer.borderWidth = 0;
  view.layer.borderColor = nil;
  view.layer.cornerRadius = 0;
  view.layer.mask = nil;

  // Extract individual border properties
  NSNumber *borderWidthNum = style[@"borderWidth"];
  CGFloat borderWidth = borderWidthNum ? (CGFloat)SNNum(borderWidthNum) : 0.f;

  NSString *borderColorHex = style[@"borderColor"];
  UIColor *borderColor = borderColorHex ? SNColorFromHex(borderColorHex) : nil;

  NSString *borderStyle = style[@"borderStyle"];

  // Individual widths
  CGFloat borderTopWidth = style[@"borderTopWidth"] ? (CGFloat)SNNum(style[@"borderTopWidth"]) : borderWidth;
  CGFloat borderRightWidth = style[@"borderRightWidth"] ? (CGFloat)SNNum(style[@"borderRightWidth"]) : borderWidth;
  CGFloat borderBottomWidth = style[@"borderBottomWidth"] ? (CGFloat)SNNum(style[@"borderBottomWidth"]) : borderWidth;
  CGFloat borderLeftWidth = style[@"borderLeftWidth"] ? (CGFloat)SNNum(style[@"borderLeftWidth"]) : borderWidth;

  // Individual colors
  UIColor *borderTopColor = style[@"borderTopColor"] ? SNColorFromHex(style[@"borderTopColor"]) : borderColor;
  UIColor *borderRightColor = style[@"borderRightColor"] ? SNColorFromHex(style[@"borderRightColor"]) : borderColor;
  UIColor *borderBottomColor = style[@"borderBottomColor"] ? SNColorFromHex(style[@"borderBottomColor"]) : borderColor;
  UIColor *borderLeftColor = style[@"borderLeftColor"] ? SNColorFromHex(style[@"borderLeftColor"]) : borderColor;

  // Individual radii
  CGFloat defaultRadius = style[@"borderRadius"] ? (CGFloat)SNNum(style[@"borderRadius"]) : 0.f;
  CGFloat borderTopLeftRadius = style[@"borderTopLeftRadius"] ? (CGFloat)SNNum(style[@"borderTopLeftRadius"]) : defaultRadius;
  CGFloat borderTopRightRadius = style[@"borderTopRightRadius"] ? (CGFloat)SNNum(style[@"borderTopRightRadius"]) : defaultRadius;
  CGFloat borderBottomRightRadius = style[@"borderBottomRightRadius"] ? (CGFloat)SNNum(style[@"borderBottomRightRadius"]) : defaultRadius;
  CGFloat borderBottomLeftRadius = style[@"borderBottomLeftRadius"] ? (CGFloat)SNNum(style[@"borderBottomLeftRadius"]) : defaultRadius;
  
  BOOL hasAnyRadius = borderTopLeftRadius > 0 || borderTopRightRadius > 0 || borderBottomRightRadius > 0 || borderBottomLeftRadius > 0;
  BOOL uniformRadius = (borderTopLeftRadius == borderTopRightRadius) &&
                       (borderTopRightRadius == borderBottomRightRadius) &&
                       (borderBottomRightRadius == borderBottomLeftRadius);

  // Apply Corner Radius (Uniform or Mask)
  // Preserve overflow clipping - if overflow: hidden/scroll was set, keep masksToBounds = YES
  if (uniformRadius) {
      view.layer.cornerRadius = borderTopLeftRadius;
      view.layer.masksToBounds = overflowClip;
      if (!overflowClip && view.layer.mask) {
          view.layer.mask = nil;
      }
  } else if (hasAnyRadius) {
      // Non-uniform: Use a mask only when we need to clip (overflow hidden/scroll)
      if (overflowClip) {
          CAShapeLayer *maskLayer = [CAShapeLayer layer];
          maskLayer.frame = view.bounds;
          
          UIBezierPath *path = [UIBezierPath bezierPath];
          // Top Left
          [path moveToPoint:CGPointMake(0, borderTopLeftRadius)];
          if (borderTopLeftRadius > 0) {
              [path addArcWithCenter:CGPointMake(borderTopLeftRadius, borderTopLeftRadius) radius:borderTopLeftRadius startAngle:M_PI endAngle:3*M_PI_2 clockwise:YES];
          } else {
              [path addLineToPoint:CGPointMake(0, 0)];
          }
          
          // Top Edge
          [path addLineToPoint:CGPointMake(view.bounds.size.width - borderTopRightRadius, 0)];
          
          // Top Right
          if (borderTopRightRadius > 0) {
              [path addArcWithCenter:CGPointMake(view.bounds.size.width - borderTopRightRadius, borderTopRightRadius) radius:borderTopRightRadius startAngle:3*M_PI_2 endAngle:0 clockwise:YES];
          } else {
              [path addLineToPoint:CGPointMake(view.bounds.size.width, 0)];
          }

          // Right Edge
          [path addLineToPoint:CGPointMake(view.bounds.size.width, view.bounds.size.height - borderBottomRightRadius)];
          
          // Bottom Right
          if (borderBottomRightRadius > 0) {
              [path addArcWithCenter:CGPointMake(view.bounds.size.width - borderBottomRightRadius, view.bounds.size.height - borderBottomRightRadius) radius:borderBottomRightRadius startAngle:0 endAngle:M_PI_2 clockwise:YES];
          } else {
              [path addLineToPoint:CGPointMake(view.bounds.size.width, view.bounds.size.height)];
          }

          // Bottom Edge
          [path addLineToPoint:CGPointMake(borderBottomLeftRadius, view.bounds.size.height)];
          
          // Bottom Left
          if (borderBottomLeftRadius > 0) {
              [path addArcWithCenter:CGPointMake(borderBottomLeftRadius, view.bounds.size.height - borderBottomLeftRadius) radius:borderBottomLeftRadius startAngle:M_PI_2 endAngle:M_PI clockwise:YES];
          } else {
              [path addLineToPoint:CGPointMake(0, view.bounds.size.height)];
          }

          [path closePath];
          
          maskLayer.path = path.CGPath;
          view.layer.mask = maskLayer;
          view.layer.masksToBounds = YES;
      } else {
          view.layer.mask = nil;
          view.layer.masksToBounds = NO;
      }
  } else {
      // No radius - still need to respect overflow clipping
      view.layer.masksToBounds = overflowClip;
      if (!overflowClip && view.layer.mask) {
          view.layer.mask = nil;
      }
  }

  // Apply Borders
  BOOL uniformBorder = (borderTopWidth == borderWidth) && (borderRightWidth == borderWidth) &&
                       (borderBottomWidth == borderWidth) && (borderLeftWidth == borderWidth) &&
                       [borderTopColor isEqual:borderColor] && [borderRightColor isEqual:borderColor] &&
                       [borderBottomColor isEqual:borderColor] && [borderLeftColor isEqual:borderColor];
                       
  BOOL hasDashedOrDotted = [borderStyle isEqualToString:@"dashed"] || [borderStyle isEqualToString:@"dotted"];

  // If using a mask, we cannot rely on standard borders because they don't follow the mask path (they follow cornerRadius which is 0).
  // So if hasAnyRadius is true (mask used), we must draw borders manually.
  BOOL canUseStandardBorder = uniformBorder && !hasDashedOrDotted && !(!uniformRadius && hasAnyRadius);

  if (canUseStandardBorder) {
      if (borderWidth > 0 && borderColor) {
          view.layer.borderWidth = borderWidth;
          view.layer.borderColor = borderColor.CGColor;
      }
  } else {
      // Individual borders or styled borders or masked borders
      
      NSArray<NSNumber *> *lineDashPattern = nil;
      if ([borderStyle isEqualToString:@"dotted"]) {
          lineDashPattern = @[@(borderWidth), @(borderWidth)];
      } else if ([borderStyle isEqualToString:@"dashed"]) {
          lineDashPattern = @[@(borderWidth * 2), @(borderWidth * 2)];
      }
      
      // Helper to create layer
      CAShapeLayer* (^createLayer)(UIColor *, CGFloat, NSArray *) = ^(UIColor *c, CGFloat w, NSArray *d) {
          CAShapeLayer *l = [CAShapeLayer layer];
          l.name = kRuneBorderLayerName;
          l.strokeColor = c.CGColor;
          l.lineWidth = w;
          l.fillColor = [UIColor clearColor].CGColor;
          l.lineCap = kCALineCapButt;
          if (d) l.lineDashPattern = d;
          return l;
      };

      CGFloat w = view.bounds.size.width;
      CGFloat h = view.bounds.size.height;

      // Top Border (handles Top-Left and Top-Right corners)
      if (borderTopWidth > 0 && borderTopColor) {
          CAShapeLayer *l = createLayer(borderTopColor, borderTopWidth, lineDashPattern);
          UIBezierPath *p = [UIBezierPath bezierPath];
          CGFloat inset = borderTopWidth / 2.0;
          
          // Top-Left Arc
          if (borderTopLeftRadius > 0) {
              CGFloat r = MAX(0, borderTopLeftRadius - inset);
              [p addArcWithCenter:CGPointMake(borderTopLeftRadius, borderTopLeftRadius) radius:r startAngle:M_PI endAngle:3*M_PI_2 clockwise:YES];
          } else {
              [p moveToPoint:CGPointMake(0, inset)];
          }
          
          // Top Line
          CGFloat rightStart = w - (borderTopRightRadius > 0 ? borderTopRightRadius : 0);
          [p addLineToPoint:CGPointMake(rightStart, inset)];
          
          // Top-Right Arc
          if (borderTopRightRadius > 0) {
              CGFloat r = MAX(0, borderTopRightRadius - inset);
              [p addArcWithCenter:CGPointMake(w - borderTopRightRadius, borderTopRightRadius) radius:r startAngle:3*M_PI_2 endAngle:0 clockwise:YES];
          } else {
              [p addLineToPoint:CGPointMake(w, inset)];
          }
          
          l.path = p.CGPath;
          [view.layer addSublayer:l];
      }

      // Bottom Border (handles Bottom-Left and Bottom-Right corners)
      if (borderBottomWidth > 0 && borderBottomColor) {
          CAShapeLayer *l = createLayer(borderBottomColor, borderBottomWidth, lineDashPattern);
          UIBezierPath *p = [UIBezierPath bezierPath];
          CGFloat inset = borderBottomWidth / 2.0;
          CGFloat y = h - inset;
          
          // Bottom-Right Arc
          if (borderBottomRightRadius > 0) {
               CGFloat r = MAX(0, borderBottomRightRadius - inset);
               [p addArcWithCenter:CGPointMake(w - borderBottomRightRadius, h - borderBottomRightRadius) radius:r startAngle:0 endAngle:M_PI_2 clockwise:YES];
          } else {
               [p moveToPoint:CGPointMake(w, y)];
          }

          // Bottom Line
          CGFloat leftStart = (borderBottomLeftRadius > 0 ? borderBottomLeftRadius : 0);
          [p addLineToPoint:CGPointMake(leftStart, y)];
          
          // Bottom-Left Arc
          if (borderBottomLeftRadius > 0) {
              CGFloat r = MAX(0, borderBottomLeftRadius - inset);
              [p addArcWithCenter:CGPointMake(borderBottomLeftRadius, h - borderBottomLeftRadius) radius:r startAngle:M_PI_2 endAngle:M_PI clockwise:YES];
          } else {
              [p addLineToPoint:CGPointMake(0, y)];
          }
          
          l.path = p.CGPath;
          [view.layer addSublayer:l];
      }
      
      // Left Border (Straight part only)
      if (borderLeftWidth > 0 && borderLeftColor) {
          CAShapeLayer *l = createLayer(borderLeftColor, borderLeftWidth, lineDashPattern);
          UIBezierPath *p = [UIBezierPath bezierPath];
          CGFloat inset = borderLeftWidth / 2.0;
          CGFloat startY = (borderTopLeftRadius > 0 ? borderTopLeftRadius : 0);
          
          [p moveToPoint:CGPointMake(inset, startY)];
          [p addLineToPoint:CGPointMake(inset, h - (borderBottomLeftRadius > 0 ? borderBottomLeftRadius : 0))];
          l.path = p.CGPath;
          [view.layer addSublayer:l];
      }

      // Right Border (Straight part only)
      if (borderRightWidth > 0 && borderRightColor) {
          CAShapeLayer *l = createLayer(borderRightColor, borderRightWidth, lineDashPattern);
          UIBezierPath *p = [UIBezierPath bezierPath];
          CGFloat inset = borderRightWidth / 2.0;
          CGFloat startY = (borderTopRightRadius > 0 ? borderTopRightRadius : 0);
          
          [p moveToPoint:CGPointMake(w - inset, startY)];
          [p addLineToPoint:CGPointMake(w - inset, h - (borderBottomRightRadius > 0 ? borderBottomRightRadius : 0))];
          l.path = p.CGPath;
          [view.layer addSublayer:l];
      }
  }
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

  if (n.latestStyle && [n.latestStyle isEqualToDictionary:style]) {
    return;
  }

  BOOL viewStyleDirty = !n.latestStyle || !SNStyleMatchesKeys(n.latestStyle, style, SNViewStyleKeys());

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
  
  NSString *fw = style[@"flexWrap"];
  if (fw) {
    YGWrap w = YGWrapNoWrap;
    if ([fw isEqualToString:@"wrap"]) w = YGWrapWrap;
    else if ([fw isEqualToString:@"wrap-reverse"]) w = YGWrapWrapReverse;
    YGNodeStyleSetFlexWrap(n.yoga, w);
  }

  SNApplyDimensionValue(
      n.yoga,
      style[@"flexBasis"],
      ^(float v) { YGNodeStyleSetFlexBasis(n.yoga, v); },
      ^(float v) { YGNodeStyleSetFlexBasisPercent(n.yoga, v); },
      ^{ YGNodeStyleSetFlexBasisAuto(n.yoga); });

  NSString *fd = style[@"flexDirection"];
  if (fd) YGNodeStyleSetFlexDirection(n.yoga, [fd isEqualToString:@"row"] ? YGFlexDirectionRow : YGFlexDirectionColumn);

  NSString *jc = style[@"justifyContent"];
  if (jc) {
    YGJustify j = YGJustifyFlexStart;
    if ([jc isEqualToString:@"center"]) j = YGJustifyCenter;
    else if ([jc isEqualToString:@"flex-end"]) j = YGJustifyFlexEnd;
    else if ([jc isEqualToString:@"space-between"]) j = YGJustifySpaceBetween;
    else if ([jc isEqualToString:@"space-around"]) j = YGJustifySpaceAround;
    else if ([jc isEqualToString:@"space-evenly"]) j = YGJustifySpaceEvenly;
    YGNodeStyleSetJustifyContent(n.yoga, j);
  }

  NSString *ai = style[@"alignItems"];
  if (ai) {
    YGAlign a = YGAlignFlexStart;
    if ([ai isEqualToString:@"center"]) a = YGAlignCenter;
    else if ([ai isEqualToString:@"flex-end"]) a = YGAlignFlexEnd;
    else if ([ai isEqualToString:@"stretch"]) a = YGAlignStretch;
    else if ([ai isEqualToString:@"baseline"]) a = YGAlignBaseline;
    YGNodeStyleSetAlignItems(n.yoga, a);
  }

  NSString *ac = style[@"alignContent"];
  if (ac) {
    YGAlign a = YGAlignFlexStart;
    if ([ac isEqualToString:@"center"]) a = YGAlignCenter;
    else if ([ac isEqualToString:@"flex-end"]) a = YGAlignFlexEnd;
    else if ([ac isEqualToString:@"stretch"]) a = YGAlignStretch;
    else if ([ac isEqualToString:@"space-between"]) a = YGAlignSpaceBetween;
    else if ([ac isEqualToString:@"space-around"]) a = YGAlignSpaceAround;
    YGNodeStyleSetAlignContent(n.yoga, a);
  }
  
  NSString *as = style[@"alignSelf"];
  if (as) {
    YGAlign a = YGAlignAuto;
    if ([as isEqualToString:@"flex-start"]) a = YGAlignFlexStart;
    else if ([as isEqualToString:@"center"]) a = YGAlignCenter;
    else if ([as isEqualToString:@"flex-end"]) a = YGAlignFlexEnd;
    else if ([as isEqualToString:@"stretch"]) a = YGAlignStretch;
    else if ([as isEqualToString:@"baseline"]) a = YGAlignBaseline;
    YGNodeStyleSetAlignSelf(n.yoga, a);
  }

  NSNumber *aspectRatio = style[@"aspectRatio"];
  if (aspectRatio && ![aspectRatio isKindOfClass:[NSNull class]]) {
    YGNodeStyleSetAspectRatio(n.yoga, (float)SNNum(aspectRatio));
  }

  NSString *overflow = style[@"overflow"];
  // Default to visible (no clipping) to match CSS behavior
  BOOL shouldClip = NO;
  if (overflow) {
    YGOverflow o = YGOverflowVisible;
    if ([overflow isEqualToString:@"hidden"]) {
      o = YGOverflowHidden;
      shouldClip = YES;
    } else if ([overflow isEqualToString:@"scroll"]) {
      o = YGOverflowScroll;
      shouldClip = YES;
    }
    YGNodeStyleSetOverflow(n.yoga, o);
  }
  n.view.clipsToBounds = shouldClip;

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

  n.latestStyle = style;

  if (viewStyleDirty) {
    id backgroundValue = style[@"background"] ?: style[@"backgroundImage"];
    RuneLinearGradient *gradient = [RuneGradientParser parse:backgroundValue];
    NSString *bg = style[@"backgroundColor"];
    if (!bg && !gradient && [backgroundValue isKindOfClass:[NSString class]]) {
      bg = (NSString *)backgroundValue;
    }
    if (bg) {
      n.view.backgroundColor = SNColorFromHex(bg);
    } else if (gradient) {
      n.view.backgroundColor = [UIColor clearColor];
    } else {
      n.view.backgroundColor = [UIColor clearColor];
    }
    // Background color is handled in SNApplyBorderStyleToView now
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

    id transform = style[@"transform"];
    n.transformOrigin = style[@"transformOrigin"];
    if (transform) {
      n.view.layer.transform = [RuneTransformParser parse:transform];
    } else {
      n.view.layer.transform = CATransform3DIdentity;
    }

    // Font handling (applies to text-capable views)
    NSString *fontFamily = [style objectForKey:@"fontFamily"];
    NSNumber *fontSizeValue = [style objectForKey:@"fontSize"];
    NSString *fontWeightValue = [style objectForKey:@"fontWeight"];
    NSString *fontStyleValue = [style objectForKey:@"fontStyle"];

    CGFloat baseSize = fontSizeValue ? (CGFloat)SNNum(fontSizeValue) : 0.0;
    if (baseSize <= 0.0 && [n.view respondsToSelector:@selector(font)]) {
      UIFont *current = [(id)n.view font];
      baseSize = current ? current.pointSize : 16.0;
    } else if (baseSize <= 0.0) {
      baseSize = 16.0;
    }

    UIFontWeight targetWeight = UIFontWeightRegular;
    if (fontWeightValue) {
      NSDictionary *weights = @{@"normal":@(UIFontWeightRegular),@"bold":@(UIFontWeightBold),
                                @"100":@(UIFontWeightUltraLight),@"200":@(UIFontWeightThin),@"300":@(UIFontWeightLight),@"400":@(UIFontWeightRegular),
                                @"500":@(UIFontWeightMedium),@"600":@(UIFontWeightSemibold),@"700":@(UIFontWeightBold),@"800":@(UIFontWeightHeavy),@"900":@(UIFontWeightBlack)};
      NSNumber *mapped = weights[fontWeightValue];
      if (mapped) {
        targetWeight = (CGFloat)mapped.doubleValue;
      }
    }

    UIFont *targetFont = nil;
    if (fontFamily.length > 0) {
      targetFont = [UIFont fontWithName:fontFamily size:baseSize];
      if (!targetFont) {
        // Try known variants (e.g., PostScript names)
        NSString *regularName = [fontFamily stringByAppendingString:@"Regular"];
        targetFont = [UIFont fontWithName:regularName size:baseSize];
      }
      if (!targetFont) {
        NSArray<NSString *> *familyMembers = [UIFont fontNamesForFamilyName:fontFamily];
        if (familyMembers.count > 0) {
          targetFont = [UIFont fontWithName:familyMembers.firstObject size:baseSize];
        }
      }
    }
    if (!targetFont) {
      BOOL italic = fontStyleValue && [[fontStyleValue lowercaseString] isEqualToString:@"italic"];
      if (italic) {
        targetFont = [UIFont italicSystemFontOfSize:baseSize];
      } else {
        targetFont = [UIFont systemFontOfSize:baseSize weight:targetWeight];
      }
    }
    if (targetFont && [n.view respondsToSelector:@selector(setFont:)]) {
      [(id)n.view setFont:targetFont];
    }

    NSNumber *br = style[@"borderRadius"];
    NSString *overflowForClip = style[@"overflow"];
    if (br) {
      n.view.layer.cornerRadius = (CGFloat)SNNum(br);
      // borderRadius requires clipping to show rounded corners, BUT respect explicit overflow setting
      // If overflow is explicitly "visible", don't clip even with borderRadius
      // If overflow is "hidden" or "scroll", clip (already set above)
      // If overflow is not set, enable clipping for borderRadius to work visually
      if (overflowForClip && [overflowForClip isEqualToString:@"visible"]) {
        // User explicitly wants visible - don't clip, corners won't show but that's their choice
        n.view.clipsToBounds = NO;
        shouldClip = NO;
      } else if (!overflowForClip) {
        // No overflow set but has borderRadius - need clipping for rounded corners
        n.view.clipsToBounds = YES;
        shouldClip = YES;
      }
      // If overflow is "hidden"/"scroll", clipsToBounds was already set to YES above
    }
    SNApplyBorderStyleToView(n.view, style, shouldClip);
    SEL updateCorner = NSSelectorFromString(@"rune_updateConfigurationCornerRadiusIfNeeded");
    if ([n.view respondsToSelector:updateCorner]) {
      [(id)n.view performSelector:updateCorner];
    }
    SNApplyGradientToView(n.view, gradient);

    id shadowOffsetRaw = style[@"shadowOffset"];
    NSDictionary *shadowOffset = nil;
    if ([shadowOffsetRaw isKindOfClass:[NSDictionary class]]) {
      shadowOffset = shadowOffsetRaw;
    } else if ([shadowOffsetRaw isKindOfClass:[NSString class]]) {
      NSString *trimmed = [(NSString *)shadowOffsetRaw stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
      if ([trimmed hasPrefix:@"{"]) {
        NSData *data = [trimmed dataUsingEncoding:NSUTF8StringEncoding];
        id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if ([parsed isKindOfClass:[NSDictionary class]]) {
          shadowOffset = parsed;
        }
      }
    }
    NSNumber *shadowOffsetX = [shadowOffset[@"width"] isKindOfClass:[NSNumber class]] ? shadowOffset[@"width"] : nil;
    NSNumber *shadowOffsetY = [shadowOffset[@"height"] isKindOfClass:[NSNumber class]] ? shadowOffset[@"height"] : nil;
    NSString *shadowColorString = [style[@"shadowColor"] isKindOfClass:[NSString class]] ? style[@"shadowColor"] : nil;
    UIColor *shadowColor = shadowColorString ? SNColorFromHex(shadowColorString) : nil;
    NSNumber *shadowOpacity = [style[@"shadowOpacity"] isKindOfClass:[NSNumber class]] ? style[@"shadowOpacity"] : nil;
    NSNumber *shadowRadius = [style[@"shadowRadius"] isKindOfClass:[NSNumber class]] ? style[@"shadowRadius"] : nil;
    NSNumber *elevation = [style[@"elevation"] isKindOfClass:[NSNumber class]] ? style[@"elevation"] : nil;
    NSArray<RuneShadowLayer *> *cssShadow = [RuneShadowParser parse:style[@"boxShadow"]];
    NSArray<RuneShadowLayer *> *rnShadow = [RuneShadowParser fromReactNativeColor:shadowColor
                                                                          opacity:shadowOpacity
                                                                           radius:shadowRadius
                                                                          offsetX:shadowOffsetX
                                                                          offsetY:shadowOffsetY];
    NSArray<RuneShadowLayer *> *shadows = [RuneShadowParser merged:cssShadow fallback:rnShadow];
    n.latestShadowLayers = shadows;
    n.latestElevation = elevation;
    SNApplyShadowStyleToView(n.view, shadows, elevation);

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
}

- (void)setProp:(NSNumber *)nodeId name:(NSString *)name valueJSON:(NSString *)json {
  SNNode *n = _nodes[nodeId];
  if (!n || !n.view) return;

  RuneComponentDescriptor *componentDescriptor = [self.componentRegistry getDescriptor:n.type];
  BOOL pointerEventsHandled = NO;

  if ([name isEqualToString:@"style"]) {
    NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *s = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    // Ensure component-specific style handlers run for batched style updates.
    if (componentDescriptor && componentDescriptor.applyStyle) {
      componentDescriptor.applyStyle(self, n, s);
    }
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

  if ([name isEqualToString:@"layout"]) {
    if (!value || value == (id)kCFNull) {
      n.layoutTransition = nil;
    } else if ([value isKindOfClass:[NSNumber class]] && ![(NSNumber *)value boolValue]) {
      n.layoutTransition = nil;
    } else if ([value isKindOfClass:[NSDictionary class]]) {
      n.layoutTransition = (NSDictionary *)value;
    } else {
      n.layoutTransition = nil;
    }
    return;
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
  RuneComponentDescriptor *componentDescriptor = [self.componentRegistry getDescriptor:n.type];
  if (componentDescriptor && componentDescriptor.applyStyle) {
    componentDescriptor.applyStyle(self, n, style);
  }
  
  [self sn_applyStyleDictionary:style toNode:n];
  [self rune_markNeedsFlush];
}

- (void)setHandler:(NSNumber *)nodeId name:(NSString *)name {
  SNNode *n = _nodes[nodeId];
  if (!n || !n.view) return;

  RuneComponentDescriptor *componentDescriptor = [self.componentRegistry getDescriptor:n.type];

  if (componentDescriptor && componentDescriptor.handleSetHandler) {
    if (componentDescriptor.handleSetHandler(self, n, name)) {
      return;
    }
  }

  if ([name isEqualToString:@"onPress"]) {
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
  RuneComponentDescriptor *componentDescriptor = [self.componentRegistry getDescriptor:n.type];
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

- (void)applyBatch:(NSString *)batchJSON {
  if (!batchJSON.length) return;

  __block void (^applyOperations)(NSArray *operations, NSUInteger startIndex);
  applyOperations = ^(NSArray *operations, NSUInteger startIndex) {
    NSUInteger count = operations.count;
    if (startIndex >= count) {
      return;
    }
    CFAbsoluteTime startTime = CFAbsoluteTimeGetCurrent();
    NSUInteger end = startIndex;
    for (; end < count; end++) {
      if ((end - startIndex) >= kRuneBatchMaxOps) {
        break;
      }
      double elapsedMs = (CFAbsoluteTimeGetCurrent() - startTime) * 1000.0;
      if (elapsedMs >= kRuneBatchTimeBudgetMs) {
        break;
      }
      NSUInteger i = end;
      id entry = operations[i];
      if (![entry isKindOfClass:[NSDictionary class]]) continue;
      NSDictionary *op = (NSDictionary *)entry;
      NSString *type = [op[@"type"] isKindOfClass:[NSString class]] ? op[@"type"] : nil;
      if (type.length == 0) continue;

      if ([type isEqualToString:@"setProp"]) {
        NSNumber *nodeId = [op[@"nodeId"] isKindOfClass:[NSNumber class]] ? op[@"nodeId"] : nil;
        NSString *name = [op[@"name"] isKindOfClass:[NSString class]] ? op[@"name"] : nil;
        if (!nodeId || name.length == 0) continue;
        NSString *jsonValue = SNJSONStringForBatchValue(op[@"value"]);
        [self setProp:nodeId name:name valueJSON:jsonValue];
        continue;
      }

      if ([type isEqualToString:@"setText"]) {
        NSNumber *nodeId = [op[@"nodeId"] isKindOfClass:[NSNumber class]] ? op[@"nodeId"] : nil;
        if (!nodeId) continue;
        id value = op[@"value"];
        NSString *text = nil;
        if ([value isKindOfClass:[NSString class]]) {
          text = (NSString *)value;
        } else if ([value isKindOfClass:[NSNumber class]]) {
          text = [(NSNumber *)value stringValue];
        } else if (value == (id)[NSNull null] || value == nil) {
          text = @"";
        } else {
          text = [value description] ?: @"";
        }
        [self setText:nodeId text:text];
        continue;
      }

      if ([type isEqualToString:@"insertChild"]) {
        NSNumber *parentId = [op[@"parentId"] isKindOfClass:[NSNumber class]] ? op[@"parentId"] : nil;
        NSNumber *childId = [op[@"childId"] isKindOfClass:[NSNumber class]] ? op[@"childId"] : nil;
        NSNumber *index = [op[@"index"] isKindOfClass:[NSNumber class]] ? op[@"index"] : nil;
        if (!parentId || !childId || !index) continue;
        [self insertChild:parentId child:childId index:index];
        continue;
      }

      if ([type isEqualToString:@"removeChild"]) {
        NSNumber *parentId = [op[@"parentId"] isKindOfClass:[NSNumber class]] ? op[@"parentId"] : nil;
        NSNumber *childId = [op[@"childId"] isKindOfClass:[NSNumber class]] ? op[@"childId"] : nil;
        if (!parentId || !childId) continue;
        [self removeChild:parentId child:childId];
        continue;
      }

      if ([type isEqualToString:@"createNode"]) {
        NSString *tag = [op[@"tag"] isKindOfClass:[NSString class]] ? op[@"tag"] : nil;
        if (!tag) {
          tag = [op[@"type"] isKindOfClass:[NSString class]] ? op[@"type"] : nil;
        }
        if (tag.length == 0) continue;

        NSNumber *nodeId = [op[@"nodeId"] isKindOfClass:[NSNumber class]] ? op[@"nodeId"] : nil;
        if (!nodeId) {
          [self createNode:tag];
          continue;
        }

        int desired = nodeId.intValue;
        if (desired < _nextId) {
          NSLog(@"[SNUIManager] applyBatch createNode skipped; nodeId=%d already used", desired);
          continue;
        }

        int originalNext = _nextId;
        _nextId = desired;
        [self createNode:tag];
        _nextId = MAX(_nextId, desired + 1);
        if (_nextId < originalNext) {
          _nextId = originalNext;
        }
        continue;
      }
    }

    if (end < count) {
      dispatch_async(dispatch_get_main_queue(), ^{
        applyOperations(operations, end);
      });
    }
  };

  void (^applyBlock)(void) = ^{
    NSData *data = [batchJSON dataUsingEncoding:NSUTF8StringEncoding];
    if (!data) return;

    NSError *error = nil;
    id payload = [NSJSONSerialization JSONObjectWithData:data options:0 error:&error];
    if (!payload || ![payload isKindOfClass:[NSDictionary class]]) return;

    NSArray *operations = ((NSDictionary *)payload)[@"operations"];
    if (![operations isKindOfClass:[NSArray class]]) return;
    applyOperations(operations, 0);
  };

  if ([NSThread isMainThread]) {
    applyBlock();
  } else {
    dispatch_async(dispatch_get_main_queue(), applyBlock);
  }
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
    RuneComponentDescriptor *parentDescriptor = [self.componentRegistry getDescriptor:p.type];
    if (parentDescriptor && parentDescriptor.handleInsertChild) {
      if (parentDescriptor.handleInsertChild(self, p, c, childId, (NSUInteger)index.unsignedIntegerValue)) {
        return;
      }
    }

    int i = (int)index.intValue;
    i = MAX(0, MIN(i, (int)p.view.subviews.count));

    NSUInteger existingIdx = [p.children indexOfObject:childId];
    if (existingIdx != NSNotFound) {
      [p.children removeObjectAtIndex:existingIdx];
      if ((int)existingIdx < i) {
        i = MAX(0, i - 1);
      }
    }

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
      int yogaCount = (int)YGNodeGetChildCount(p.yoga);
      int yogaIndex = MIN(i, yogaCount);
      YGNodeInsertChild(p.yoga, c.yoga, (uint32_t)yogaIndex);
    }
  }
  [self rune_markNeedsFlush];
}

- (void)removeChild:(NSNumber *)parentId child:(NSNumber *)childId {
  SNNode *c = _nodes[childId];
  if (!c || !c.view) return;
  
  RuneComponentDescriptor *componentDescriptor = [self.componentRegistry getDescriptor:c.type];
  if (componentDescriptor && componentDescriptor.cleanup) {
    componentDescriptor.cleanup(self, c);
  }
  
  for (UIGestureRecognizer *gr in c.view.gestureRecognizers.copy) {
    [c.view removeGestureRecognizer:gr];
  }
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
    RuneComponentDescriptor *parentDescriptor = [self.componentRegistry getDescriptor:p.type];
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
  [self.surfaceFirstFrameListeners removeAllObjects];
  [self.surfaceFirstFrameDispatched removeAllObjects];
  
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

- (void)sn_applyBorderStyle:(NSDictionary *)style toView:(UIView *)view {
  // Preserve overflow clipping when border styles are re-applied after layout changes
  BOOL overflowClip = NO;
  NSString *overflow = style[@"overflow"];
  if ([overflow isKindOfClass:[NSString class]]) {
    overflowClip = [overflow isEqualToString:@"hidden"] || [overflow isEqualToString:@"scroll"];
  }

  SNApplyBorderStyleToView(view, style, overflowClip);
  SEL updateCorner = NSSelectorFromString(@"rune_updateConfigurationCornerRadiusIfNeeded");
  if ([view respondsToSelector:updateCorner]) {
    [(id)view performSelector:updateCorner];
  }
}

- (void)sn_applyShadowLayers:(NSArray<RuneShadowLayer *> *_Nullable)layers elevation:(NSNumber *_Nullable)elevation toView:(UIView *)view {
  SNApplyShadowStyleToView(view, layers, elevation);
}

@end
