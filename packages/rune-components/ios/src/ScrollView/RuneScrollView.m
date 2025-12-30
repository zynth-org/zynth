#import "RuneScrollView.h"

#import "SNUIManager+Internal.h"
#import "SNUIManager.h"

#import <QuartzCore/QuartzCore.h>

static NSTimeInterval RuneScrollCurrentTime(void) {
  return CACurrentMediaTime();
}

static const CGFloat kRuneScrollGuardVelocityThreshold = 7000.0;
static const CGFloat kRuneScrollGuardDistanceMultiplier = 6.0;
static const CGFloat kRuneScrollGuardMinDistance = 2500.0;
static const NSTimeInterval kRuneScrollGuardCooldown = 0.140;
static const NSTimeInterval kRuneScrollGuardGestureWindow = 0.900;
static const CGFloat kRuneScrollGuardFallbackViewport = 960.0;
static const CGFloat kRuneScrollGuardRearmFraction = 0.05;
static const BOOL kRuneScrollGuardRequiresDistance = YES;
static const NSTimeInterval kRuneScrollProgrammaticInstantGrace = 0.120;
static const NSTimeInterval kRuneScrollProgrammaticAnimatedGrace = 0.600;

@interface RuneScrollView ()
@property(nonatomic, weak) SNUIManager *manager;
@property(nonatomic, weak) SNNode *node;
@property(nonatomic, strong) UIScrollView *scrollView;
@property(nonatomic, strong) UIView *contentView;
@property(nonatomic, assign) RuneScrollAxis axis;
@property(nonatomic, assign) BOOL scrollEnabled;
@property(nonatomic, assign) BOOL directionalLockEnabled;
@property(nonatomic, assign) BOOL bridgeCoalescing;
@property(nonatomic, assign) CGFloat eventThrottleMs;
@property(nonatomic, assign) CGFloat eventMinDisplacement;
@property(nonatomic, assign) NSTimeInterval lastDispatchTimestamp;
@property(nonatomic, assign) CGPoint lastDispatchedOffset;
@property(nonatomic, assign) CGPoint lastEventOffset;
@property(nonatomic, assign) NSTimeInterval lastEventTimestamp;
@property(nonatomic, assign) CGPoint lastVelocity;
@property(nonatomic, assign) BOOL coalesceScheduled;
@property(nonatomic, strong, nullable) NSDictionary *pendingPayload;
@property(nonatomic, assign) BOOL isDraggingState;
@property(nonatomic, assign) BOOL isDeceleratingState;
@property(nonatomic, copy, nullable) NSString *lockedAxis;
@property(nonatomic, assign) CGPoint lockOrigin;
@property(nonatomic, assign) BOOL snapEnabled;
@property(nonatomic, copy) NSString *snapAxisMode;
@property(nonatomic, copy) NSString *snapStrictness;
@property(nonatomic, copy) NSArray<NSString *> *snapAlignments;
@property(nonatomic, assign) BOOL snapStopAlways;
@property(nonatomic, assign) NSInteger snapPaddingStart;
@property(nonatomic, assign) NSInteger snapPaddingEnd;
@property(nonatomic, assign) NSInteger snapPaddingTop;
@property(nonatomic, assign) NSInteger snapPaddingBottom;
@property(nonatomic, assign) BOOL snapPendingCheck;
@property(nonatomic, assign) BOOL snapPendingForce;
@property(nonatomic, assign) BOOL contentUpdateScheduled;
@property(nonatomic, assign) BOOL contentGeometryDirty;
@property(nonatomic, assign) CGSize lastContentSize;
@property(nonatomic, assign) CGPoint lastStableOffset;
@property(nonatomic, assign) NSTimeInterval lastGestureTimestamp;
@property(nonatomic, assign) NSTimeInterval lastManualStopTimestamp;
@property(nonatomic, assign) NSTimeInterval programmaticScrollGraceDeadline;
@property(nonatomic, assign) CGFloat stopVelocityThreshold;
@property(nonatomic, assign) CGFloat stopDistanceMultiplier;
@property(nonatomic, assign) CGFloat stopMinDistance;
@property(nonatomic, assign) NSTimeInterval stopCooldownInterval;
@property(nonatomic, assign) NSTimeInterval stopGestureWindowInterval;
@property(nonatomic, assign) CGFloat stopFallbackViewport;
@property(nonatomic, assign) CGFloat stopRearmFraction;
@property(nonatomic, assign) BOOL stopRequiresDistance;
@end

@implementation RuneScrollView

- (instancetype)init {
  return [self initWithFrame:CGRectZero];
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    [self commonInit];
  }
  return self;
}

- (instancetype)initWithCoder:(NSCoder *)coder {
  if (self = [super initWithCoder:coder]) {
    [self commonInit];
  }
  return self;
}

- (void)commonInit {
  _scrollView = [[UIScrollView alloc] initWithFrame:CGRectZero];
  _scrollView.delegate = self;
  _scrollView.delaysContentTouches = NO;
  _scrollView.canCancelContentTouches = YES;
  _scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
  _scrollView.showsVerticalScrollIndicator = YES;
  _scrollView.showsHorizontalScrollIndicator = YES;
  _scrollView.alwaysBounceVertical = YES;
  _scrollView.alwaysBounceHorizontal = NO;
  _scrollView.bounces = YES;
  _scrollView.scrollsToTop = NO;

  _contentView = [[UIView alloc] initWithFrame:CGRectZero];
  _contentView.clipsToBounds = NO;
  _contentView.backgroundColor = UIColor.clearColor;

  [super insertSubview:_scrollView atIndex:0];
  [_scrollView addSubview:_contentView];

  _axis = RuneScrollAxisVertical;
  _scrollEnabled = YES;
  _directionalLockEnabled = YES;
  _eventThrottleMs = 16.0;
  _eventMinDisplacement = 0.0;
  _bridgeCoalescing = YES;
  _snapAxisMode = @"both";
  _snapStrictness = @"none";
  _snapAlignments = @[];
  _snapStopAlways = NO;
  _snapPaddingStart = 0;
  _snapPaddingEnd = 0;
  _snapPaddingTop = 0;
  _snapPaddingBottom = 0;
  _stopVelocityThreshold = kRuneScrollGuardVelocityThreshold;
  _stopDistanceMultiplier = kRuneScrollGuardDistanceMultiplier;
  _stopMinDistance = kRuneScrollGuardMinDistance;
  _stopCooldownInterval = kRuneScrollGuardCooldown;
  _stopGestureWindowInterval = kRuneScrollGuardGestureWindow;
  _stopFallbackViewport = kRuneScrollGuardFallbackViewport;
  _stopRearmFraction = kRuneScrollGuardRearmFraction;
  _stopRequiresDistance = kRuneScrollGuardRequiresDistance;
}

- (void)dealloc {
  _scrollView.delegate = nil;
}

- (void)attachToManager:(SNUIManager *_Nullable)manager node:(SNNode *_Nullable)node {
  self.manager = manager;
  self.node = node;
}

- (void)layoutSubviews {
  [super layoutSubviews];
  _scrollView.frame = self.bounds;
  self.contentGeometryDirty = YES;
  [self scheduleContentGeometryUpdate];
}

- (void)insertContentSubview:(UIView *)view atIndex:(NSInteger)index {
  NSInteger safeIndex = MAX(0, MIN(index, (NSInteger)_contentView.subviews.count));
  [_contentView insertSubview:view atIndex:safeIndex];
  [self setNeedsLayout];
  self.contentGeometryDirty = YES;
  [self scheduleContentGeometryUpdate];
}

- (void)removeContentSubview:(UIView *)view {
  [view removeFromSuperview];
  [self setNeedsLayout];
  self.contentGeometryDirty = YES;
  [self scheduleContentGeometryUpdate];
}

- (void)updateContentGeometry {
  self.contentGeometryDirty = NO;
  CGSize boundsSize = self.bounds.size;
  __block CGFloat contentWidth = boundsSize.width;
  __block CGFloat contentHeight = boundsSize.height;

  __block void (^accumulate)(UIView *);
  accumulate = ^(UIView *view) {
    CGRect rect = [view convertRect:view.bounds toView:self.contentView];
    contentWidth = MAX(contentWidth, CGRectGetMaxX(rect));
    contentHeight = MAX(contentHeight, CGRectGetMaxY(rect));
    for (UIView *child in view.subviews) {
      accumulate(child);
    }
  };

  for (UIView *subview in _contentView.subviews) {
    accumulate(subview);
  }

  if (self.axis == RuneScrollAxisHorizontal) {
    contentHeight = MAX(contentHeight, boundsSize.height);
  } else {
    contentWidth = MAX(contentWidth, boundsSize.width);
  }

  CGSize nextContentSize = CGSizeMake(contentWidth, contentHeight);
  CGFloat epsilon = 0.5f;
  if (fabs(nextContentSize.width - self.lastContentSize.width) > epsilon ||
      fabs(nextContentSize.height - self.lastContentSize.height) > epsilon) {
    _contentView.frame = CGRectMake(0, 0, nextContentSize.width, nextContentSize.height);
    _scrollView.contentSize = nextContentSize;
    self.lastContentSize = nextContentSize;
  }
}

- (void)scheduleContentGeometryUpdate {
  if (!self.contentGeometryDirty) return;
  if (self.contentUpdateScheduled) return;
  self.contentUpdateScheduled = YES;
  dispatch_async(dispatch_get_main_queue(), ^{
    self.contentUpdateScheduled = NO;
    if (self.contentGeometryDirty) {
      [self updateContentGeometry];
    }
  });
}

- (void)registerProgrammaticScroll:(BOOL)animated {
  NSTimeInterval now = RuneScrollCurrentTime();
  NSTimeInterval grace = animated ? kRuneScrollProgrammaticAnimatedGrace
                                  : kRuneScrollProgrammaticInstantGrace;
  self.programmaticScrollGraceDeadline =
      MAX(self.programmaticScrollGraceDeadline, now + grace);
}

- (BOOL)isProgrammaticScrollActive {
  if (self.programmaticScrollGraceDeadline <= 0) return NO;
  return RuneScrollCurrentTime() <= self.programmaticScrollGraceDeadline;
}

- (void)recordStableOffset:(CGPoint)offset {
  self.lastStableOffset = offset;
}

- (void)evaluateManualFlingGuard {
  if ([self isProgrammaticScrollActive]) {
    return;
  }
  if (self.isDraggingState) {
    [self recordStableOffset:self.scrollView.contentOffset];
    return;
  }
  if (!self.isDeceleratingState) {
    return;
  }

  NSTimeInterval now = RuneScrollCurrentTime();
  if (now - self.lastGestureTimestamp > self.stopGestureWindowInterval) {
    return;
  }
  if (now - self.lastManualStopTimestamp < self.stopCooldownInterval) {
    return;
  }

  CGFloat velocity = (self.axis == RuneScrollAxisHorizontal)
                         ? fabs(self.lastVelocity.x)
                         : fabs(self.lastVelocity.y);
  CGFloat viewport =
      (self.axis == RuneScrollAxisHorizontal)
          ? self.scrollView.bounds.size.width
          : self.scrollView.bounds.size.height;
  if (viewport <= 0) {
    viewport = self.stopFallbackViewport;
  }

  CGPoint currentOffset = self.scrollView.contentOffset;
  CGFloat distance =
      (self.axis == RuneScrollAxisHorizontal)
          ? fabs(currentOffset.x - self.lastStableOffset.x)
          : fabs(currentOffset.y - self.lastStableOffset.y);

  CGFloat distanceThreshold =
      MAX(self.stopMinDistance, viewport * self.stopDistanceMultiplier);

  BOOL stopDueToDistance = distance >= distanceThreshold;
  BOOL stopDueToVelocity = velocity >= self.stopVelocityThreshold;
  BOOL allowVelocityOnly = !self.stopRequiresDistance;

  if (stopDueToDistance || (allowVelocityOnly && stopDueToVelocity)) {
    [self.scrollView.layer removeAllAnimations];
    [self.scrollView setContentOffset:self.scrollView.contentOffset animated:NO];
    self.lastManualStopTimestamp = now;
    [self recordStableOffset:self.scrollView.contentOffset];
    return;
  }

  if (distance >= viewport * self.stopRearmFraction) {
    [self recordStableOffset:currentOffset];
  }
}

- (BOOL)shouldDeferContentGeometryForOffset:(CGPoint)offset {
  CGSize viewport = self.scrollView.bounds.size;
  CGSize contentSize = self.scrollView.contentSize;
  if (self.axis == RuneScrollAxisHorizontal) {
    CGFloat maxOffset = MAX(0.0, contentSize.width - viewport.width);
    return offset.x < -0.5 || offset.x > maxOffset + 0.5;
  }
  CGFloat maxOffset = MAX(0.0, contentSize.height - viewport.height);
  return offset.y < -0.5 || offset.y > maxOffset + 0.5;
}

#pragma mark - Property setters

- (void)rune_setAxis:(RuneScrollAxis)axis {
  if (_axis == axis) return;
  _axis = axis;
  BOOL horizontal = axis == RuneScrollAxisHorizontal;
  _scrollView.alwaysBounceHorizontal = horizontal;
  _scrollView.alwaysBounceVertical = !horizontal;
  _scrollView.showsHorizontalScrollIndicator = horizontal;
  _scrollView.showsVerticalScrollIndicator = !horizontal;
  [self setNeedsLayout];
  if (self.snapEnabled) {
    [self scheduleSnapCheckWithForce:(self.snapStrictness && [self.snapStrictness isEqualToString:@"mandatory"])];
  }
}

- (void)rune_setScrollEnabled:(BOOL)enabled {
  _scrollEnabled = enabled;
  _scrollView.scrollEnabled = enabled;
}

- (void)rune_setDirectionalLockEnabled:(BOOL)enabled {
  _directionalLockEnabled = enabled;
  _scrollView.directionalLockEnabled = enabled;
}

- (void)rune_setShowsVerticalScrollIndicator:(BOOL)show {
  _scrollView.showsVerticalScrollIndicator = show;
}

- (void)rune_setShowsHorizontalScrollIndicator:(BOOL)show {
  _scrollView.showsHorizontalScrollIndicator = show;
}

- (void)rune_setIndicatorStyle:(NSString *_Nullable)style {
  if (!style.length) {
    _scrollView.indicatorStyle = UIScrollViewIndicatorStyleDefault;
    return;
  }
  NSString *lower = style.lowercaseString;
  if ([lower isEqualToString:@"black"]) {
    _scrollView.indicatorStyle = UIScrollViewIndicatorStyleBlack;
  } else if ([lower isEqualToString:@"white"]) {
    _scrollView.indicatorStyle = UIScrollViewIndicatorStyleWhite;
  } else {
    _scrollView.indicatorStyle = UIScrollViewIndicatorStyleDefault;
  }
}

- (void)rune_setOverScrollBehavior:(NSString *_Nullable)behavior {
  NSString *value = behavior.lowercaseString;
  if ([value isEqualToString:@"never"]) {
    _scrollView.bounces = NO;
    _scrollView.alwaysBounceHorizontal = NO;
    _scrollView.alwaysBounceVertical = NO;
  } else if ([value isEqualToString:@"always"]) {
    _scrollView.bounces = YES;
    _scrollView.alwaysBounceHorizontal = YES;
    _scrollView.alwaysBounceVertical = YES;
  } else {
    _scrollView.bounces = YES;
    _scrollView.alwaysBounceHorizontal = _axis == RuneScrollAxisHorizontal;
    _scrollView.alwaysBounceVertical = _axis != RuneScrollAxisHorizontal;
  }
}

- (void)rune_setBounces:(BOOL)enabled {
  _scrollView.bounces = enabled;
}

- (void)rune_setDecelerationRate:(NSNumber *_Nullable)value {
  if (!value || [value isKindOfClass:[NSNull class]]) {
    _scrollView.decelerationRate = UIScrollViewDecelerationRateNormal;
    return;
  }
  if ([value isKindOfClass:[NSString class]]) {
    NSString *lower = [(NSString *)value lowercaseString];
    if ([lower isEqualToString:@"fast"]) {
      _scrollView.decelerationRate = UIScrollViewDecelerationRateFast;
    } else {
      _scrollView.decelerationRate = UIScrollViewDecelerationRateNormal;
    }
    return;
  }
  _scrollView.decelerationRate = (CGFloat)[value doubleValue];
}

- (void)rune_setEventThrottleMs:(NSNumber *_Nullable)msValue {
  if (!msValue || [msValue isKindOfClass:[NSNull class]]) {
    _eventThrottleMs = 16.0;
    return;
  }
  _eventThrottleMs = MAX(0.0, (CGFloat)[msValue doubleValue]);
}

- (void)rune_setEventMinDisplacement:(NSNumber *_Nullable)value {
  if (!value || [value isKindOfClass:[NSNull class]]) {
    _eventMinDisplacement = 0.0;
    return;
  }
  _eventMinDisplacement = MAX(0.0, (CGFloat)[value doubleValue]);
}

- (void)rune_setBridgeCoalescing:(BOOL)enabled {
  _bridgeCoalescing = enabled;
  if (!enabled) {
    _pendingPayload = nil;
    _coalesceScheduled = NO;
  }
}

- (void)rune_setContentInset:(NSDictionary *_Nullable)inset {
  if (![inset isKindOfClass:[NSDictionary class]]) {
    _scrollView.contentInset = UIEdgeInsetsZero;
    return;
  }
  UIEdgeInsets e = UIEdgeInsetsZero;
  id top = inset[@"top"];
  id left = inset[@"left"];
  id bottom = inset[@"bottom"];
  id right = inset[@"right"];
  if ([top respondsToSelector:@selector(doubleValue)]) e.top = [top doubleValue];
  if ([left respondsToSelector:@selector(doubleValue)]) e.left = [left doubleValue];
  if ([bottom respondsToSelector:@selector(doubleValue)]) e.bottom = [bottom doubleValue];
  if ([right respondsToSelector:@selector(doubleValue)]) e.right = [right doubleValue];
  _scrollView.contentInset = e;
}

- (void)resetScrollGuardConfig {
  self.stopVelocityThreshold = kRuneScrollGuardVelocityThreshold;
  self.stopDistanceMultiplier = kRuneScrollGuardDistanceMultiplier;
  self.stopMinDistance = kRuneScrollGuardMinDistance;
  self.stopCooldownInterval = kRuneScrollGuardCooldown;
  self.stopGestureWindowInterval = kRuneScrollGuardGestureWindow;
  self.stopFallbackViewport = kRuneScrollGuardFallbackViewport;
  self.stopRearmFraction = kRuneScrollGuardRearmFraction;
  self.stopRequiresDistance = kRuneScrollGuardRequiresDistance;
}

- (void)rune_setScrollGuardConfig:(NSDictionary *_Nullable)config {
  if (!config || config == (id)[NSNull null] || ![config isKindOfClass:[NSDictionary class]]) {
    [self resetScrollGuardConfig];
    return;
  }

  [self resetScrollGuardConfig];

  NSDictionary *dict = (NSDictionary *)config;
  id value = dict[@"stopVelocityThreshold"] ?: dict[@"manualStopVelocityThreshold"];
  if ([value respondsToSelector:@selector(doubleValue)]) {
    self.stopVelocityThreshold = MAX(0.0, [value doubleValue]);
  }
  value = dict[@"stopDistanceMultiplier"] ?: dict[@"manualStopDistanceMultiplier"];
  if ([value respondsToSelector:@selector(doubleValue)]) {
    self.stopDistanceMultiplier = MAX(0.0, [value doubleValue]);
  }
  value = dict[@"stopMinDistancePx"] ?: dict[@"manualStopMinDistancePx"];
  if ([value respondsToSelector:@selector(doubleValue)]) {
    self.stopMinDistance = MAX(0.0, [value doubleValue]);
  }
  value = dict[@"stopCooldownMs"] ?: dict[@"manualStopCooldownMs"];
  if ([value respondsToSelector:@selector(doubleValue)]) {
    self.stopCooldownInterval = MAX(0.0, [value doubleValue]) / 1000.0;
  }
  value = dict[@"stopGestureWindowMs"] ?: dict[@"manualStopGestureWindowMs"];
  if ([value respondsToSelector:@selector(doubleValue)]) {
    self.stopGestureWindowInterval = MAX(0.0, [value doubleValue]) / 1000.0;
  }
  value = dict[@"stopFallbackViewport"] ?: dict[@"manualStopFallbackViewport"];
  if ([value respondsToSelector:@selector(doubleValue)]) {
    self.stopFallbackViewport = MAX(0.0, [value doubleValue]);
  }
  value = dict[@"stopRearmFraction"] ?: dict[@"manualStopRearmFraction"];
  if ([value respondsToSelector:@selector(doubleValue)]) {
    CGFloat fraction = (CGFloat)[value doubleValue];
    self.stopRearmFraction = MIN(1.0, MAX(0.0, fraction));
  }
  value = dict[@"stopRequiresDistance"];
  if ([value respondsToSelector:@selector(boolValue)]) {
    self.stopRequiresDistance = [value boolValue];
  }
}

- (void)rune_setScrollSnapType:(id)value {
  if (!value || value == (id)[NSNull null]) {
    self.snapEnabled = NO;
    self.snapStrictness = @"none";
    self.snapAxisMode = @"both";
    return;
  }
  if ([value isKindOfClass:[NSString class]]) {
    NSString *lower = [(NSString *)value lowercaseString];
    if ([lower isEqualToString:@"none"]) {
      self.snapEnabled = NO;
      self.snapStrictness = @"none";
      self.snapAxisMode = @"both";
      return;
    }
    self.snapEnabled = YES;
    if ([lower isEqualToString:@"x"] || [lower isEqualToString:@"inline"]) {
      self.snapAxisMode = @"x";
    } else if ([lower isEqualToString:@"y"] || [lower isEqualToString:@"block"]) {
      self.snapAxisMode = @"y";
    } else {
      self.snapAxisMode = @"both";
    }
    self.snapStrictness = @"mandatory";
    [self scheduleSnapCheckWithForce:YES];
    return;
  }
  if ([value isKindOfClass:[NSDictionary class]]) {
    NSDictionary *dict = (NSDictionary *)value;
    NSString *axis = [dict[@"axis"] isKindOfClass:[NSString class]] ? [dict[@"axis"] lowercaseString] : @"both";
    if ([axis isEqualToString:@"x"] || [axis isEqualToString:@"inline"]) {
      self.snapAxisMode = @"x";
    } else if ([axis isEqualToString:@"y"] || [axis isEqualToString:@"block"]) {
      self.snapAxisMode = @"y";
    } else {
      self.snapAxisMode = @"both";
    }
    NSString *strictness = [dict[@"strictness"] isKindOfClass:[NSString class]] ? [dict[@"strictness"] lowercaseString] : @"proximity";
    self.snapStrictness = strictness.length ? strictness : @"proximity";
    self.snapEnabled = ![self.snapStrictness isEqualToString:@"none"];
    if (self.snapEnabled) {
      [self scheduleSnapCheckWithForce:[self.snapStrictness isEqualToString:@"mandatory"]];
    }
    return;
  }
  self.snapEnabled = YES;
  self.snapStrictness = @"mandatory";
  self.snapAxisMode = @"both";
  [self scheduleSnapCheckWithForce:YES];
}

- (void)rune_setScrollSnapAlign:(id)value {
  if (!value || value == (id)[NSNull null]) {
    self.snapAlignments = @[];
    return;
  }
  if ([value isKindOfClass:[NSString class]]) {
    self.snapAlignments = @[[((NSString *)value) lowercaseString]];
    return;
  }
  if ([value isKindOfClass:[NSArray class]]) {
    NSMutableArray<NSString *> *aligns = [NSMutableArray new];
    for (id entry in (NSArray *)value) {
      if ([entry isKindOfClass:[NSString class]]) {
        [aligns addObject:[(NSString *)entry lowercaseString]];
      }
    }
    self.snapAlignments = aligns;
    return;
  }
}

- (void)rune_setScrollSnapStop:(id)value {
  if ([value isKindOfClass:[NSString class]]) {
    self.snapStopAlways = [((NSString *)value) caseInsensitiveCompare:@"always"] == NSOrderedSame;
  } else {
    self.snapStopAlways = NO;
  }
}

- (void)rune_setScrollPadding:(id)value {
  if (!value || value == (id)[NSNull null]) {
    self.snapPaddingStart = 0;
    self.snapPaddingEnd = 0;
    self.snapPaddingTop = 0;
    self.snapPaddingBottom = 0;
    return;
  }
  if ([value respondsToSelector:@selector(doubleValue)]) {
    NSInteger padding = (NSInteger)MAX(0.0, [value doubleValue]);
    self.snapPaddingStart = padding;
    self.snapPaddingEnd = padding;
    self.snapPaddingTop = padding;
    self.snapPaddingBottom = padding;
    return;
  }
  if ([value isKindOfClass:[NSString class]]) {
    double numeric = [(NSString *)value doubleValue];
    if (!isnan(numeric)) {
      NSInteger padding = (NSInteger)MAX(0.0, numeric);
      self.snapPaddingStart = padding;
      self.snapPaddingEnd = padding;
      self.snapPaddingTop = padding;
      self.snapPaddingBottom = padding;
      return;
    }
  }
  if ([value isKindOfClass:[NSDictionary class]]) {
    NSDictionary *dict = (NSDictionary *)value;
    id top = dict[@"top"];
    id right = dict[@"right"];
    id bottom = dict[@"bottom"];
    id left = dict[@"left"];
    self.snapPaddingTop = [top respondsToSelector:@selector(doubleValue)] ? (NSInteger)MAX(0.0, [top doubleValue]) : 0;
    self.snapPaddingEnd = [right respondsToSelector:@selector(doubleValue)] ? (NSInteger)MAX(0.0, [right doubleValue]) : 0;
    self.snapPaddingBottom = [bottom respondsToSelector:@selector(doubleValue)] ? (NSInteger)MAX(0.0, [bottom doubleValue]) : 0;
    self.snapPaddingStart = [left respondsToSelector:@selector(doubleValue)] ? (NSInteger)MAX(0.0, [left doubleValue]) : 0;
    return;
  }
}

- (void)rune_applyCommand:(NSDictionary *_Nullable)command {
  if (![command isKindOfClass:[NSDictionary class]]) return;

  NSString *type = [command[@"type"] isKindOfClass:[NSString class]] ? (NSString *)command[@"type"] : nil;
  if (type.length == 0) return;

  if ([type isEqualToString:@"scrollTo"]) {
    BOOL animated = command[@"animated"] ? [command[@"animated"] boolValue] : YES;
    NSNumber *xValue = [command objectForKey:@"x"];
    NSNumber *yValue = [command objectForKey:@"y"];
    CGFloat targetX = xValue ? [xValue doubleValue] : self.scrollView.contentOffset.x;
    CGFloat targetY = yValue ? [yValue doubleValue] : self.scrollView.contentOffset.y;
    CGPoint offset = CGPointMake(targetX, targetY);
    [self registerProgrammaticScroll:animated];
    [self.scrollView setContentOffset:offset animated:animated];
    if (!animated) {
      [self emitScrollEventNamed:@"onScroll" force:YES];
    }
    return;
  }

  if ([type isEqualToString:@"scrollBy"]) {
    BOOL animated = command[@"animated"] ? [command[@"animated"] boolValue] : YES;
    CGFloat dx = [command[@"dx"] respondsToSelector:@selector(doubleValue)] ? [command[@"dx"] doubleValue] : 0;
    CGFloat dy = [command[@"dy"] respondsToSelector:@selector(doubleValue)] ? [command[@"dy"] doubleValue] : 0;
    CGPoint current = self.scrollView.contentOffset;
    CGPoint offset = CGPointMake(current.x + dx, current.y + dy);
    [self registerProgrammaticScroll:animated];
    [self.scrollView setContentOffset:offset animated:animated];
    if (!animated) {
      [self emitScrollEventNamed:@"onScroll" force:YES];
    }
    return;
  }

  if ([type isEqualToString:@"stop"]) {
    [self.scrollView.layer removeAllAnimations];
    [self.scrollView setContentOffset:self.scrollView.contentOffset animated:NO];
    [self emitScrollEventNamed:@"onScroll" force:YES];
    [self emitScrollEventNamed:@"onMomentumScrollEnd" force:YES];
    return;
  }

  if ([type isEqualToString:@"flashIndicators"]) {
    [self.scrollView flashScrollIndicators];
    return;
  }

  if ([type isEqualToString:@"lockAxis"]) {
    id axisValue = command[@"axis"];
    NSString *axis = [axisValue isKindOfClass:[NSString class]] ? (NSString *)axisValue : nil;
    [self rune_lockAxis:axis];
    return;
  }
}

- (void)rune_lockAxis:(NSString *_Nullable)axisName {
  if (axisName.length == 0) {
    self.lockedAxis = nil;
    return;
  }
  NSString *lower = axisName.lowercaseString;
  if (![lower isEqualToString:@"horizontal"] && ![lower isEqualToString:@"vertical"]) {
    self.lockedAxis = nil;
    return;
  }
  self.lockedAxis = lower;
  self.lockOrigin = self.scrollView.contentOffset;
}

#pragma mark - UIScrollViewDelegate

- (void)scrollViewWillBeginDragging:(UIScrollView *)scrollView {
  self.isDraggingState = YES;
  self.isDeceleratingState = NO;
  self.lastGestureTimestamp = RuneScrollCurrentTime();
  [self recordStableOffset:scrollView.contentOffset];
  [self emitScrollEventNamed:@"onScrollBeginDrag" force:YES];
}

- (void)scrollViewDidScroll:(UIScrollView *)scrollView {
  if (self.lockedAxis) {
    if ([self.lockedAxis isEqualToString:@"horizontal"]) {
      CGPoint current = scrollView.contentOffset;
      if (fabs(current.x - self.lockOrigin.x) > 0.5) {
        scrollView.contentOffset = CGPointMake(self.lockOrigin.x, current.y);
      }
    } else if ([self.lockedAxis isEqualToString:@"vertical"]) {
      CGPoint current = scrollView.contentOffset;
      if (fabs(current.x - self.lockOrigin.x) > 0.5) {
        scrollView.contentOffset = CGPointMake(self.lockOrigin.x, current.y);
      }
    }
  }

  [self updateVelocity];
  [self evaluateManualFlingGuard];
  [self emitScrollEventNamed:@"onScroll" force:NO];
  if (![self shouldDeferContentGeometryForOffset:scrollView.contentOffset]) {
    [self scheduleContentGeometryUpdate];
  }
}

- (void)scrollViewDidEndDragging:(UIScrollView *)scrollView willDecelerate:(BOOL)decelerate {
  self.isDraggingState = NO;
  self.lastGestureTimestamp = RuneScrollCurrentTime();
  [self emitScrollEventNamed:@"onScrollEndDrag" force:YES];
  if (!decelerate) {
    self.isDeceleratingState = NO;
    [self emitScrollEventNamed:@"onMomentumScrollEnd" force:YES];
    [self scheduleSnapCheckWithForce:[self.snapStrictness isEqualToString:@"mandatory"]];
  }
}

- (void)scrollViewWillBeginDecelerating:(UIScrollView *)scrollView {
  self.isDeceleratingState = YES;
  self.lastGestureTimestamp = RuneScrollCurrentTime();
  [self emitScrollEventNamed:@"onMomentumScrollBegin" force:YES];
}

- (void)scrollViewDidEndDecelerating:(UIScrollView *)scrollView {
  if (self.isDeceleratingState) {
    self.isDeceleratingState = NO;
    [self recordStableOffset:scrollView.contentOffset];
    [self emitScrollEventNamed:@"onMomentumScrollEnd" force:YES];
    [self scheduleSnapCheckWithForce:YES];
  }
}

- (void)scrollViewDidEndScrollingAnimation:(UIScrollView *)scrollView {
  if (self.isDeceleratingState) {
    self.isDeceleratingState = NO;
    [self emitScrollEventNamed:@"onMomentumScrollEnd" force:YES];
  }
  [self scheduleSnapCheckWithForce:YES];
}

#pragma mark - Event helpers

- (void)updateVelocity {
  NSTimeInterval now = RuneScrollCurrentTime();
  CGPoint offset = self.scrollView.contentOffset;
  if (self.lastEventTimestamp > 0) {
    NSTimeInterval dt = now - self.lastEventTimestamp;
    if (dt > 0.0001) {
      CGFloat vx = (offset.x - self.lastEventOffset.x) / dt;
      CGFloat vy = (offset.y - self.lastEventOffset.y) / dt;
      self.lastVelocity = CGPointMake(vx, vy);
    }
  }
  self.lastEventTimestamp = now;
  self.lastEventOffset = offset;
}

- (NSDictionary *)buildPayload {
  CGPoint offset = self.scrollView.contentOffset;
  CGSize contentSize = self.scrollView.contentSize;
  CGSize viewport = self.scrollView.bounds.size;
  NSDictionary *velocity = @{
    @"x": @(self.lastVelocity.x),
    @"y": @(self.lastVelocity.y),
  };
  return @{
    @"contentOffset": @{@"x": @(offset.x), @"y": @(offset.y)},
    @"contentSize": @{@"width": @(contentSize.width), @"height": @(contentSize.height)},
    @"layoutMeasurement": @{@"width": @(viewport.width), @"height": @(viewport.height)},
    @"velocity": velocity,
    @"zoomScale": @(self.scrollView.zoomScale),
  };
}

- (BOOL)shouldEmitScrollEventAtTime:(NSTimeInterval)now offset:(CGPoint)offset force:(BOOL)force name:(NSString *)name {
  if (force) return YES;
  if (![name isEqualToString:@"onScroll"]) return YES;

  CGFloat dx = fabs(offset.x - self.lastDispatchedOffset.x);
  CGFloat dy = fabs(offset.y - self.lastDispatchedOffset.y);
  if (dx < self.eventMinDisplacement && dy < self.eventMinDisplacement) {
    return NO;
  }

  if (self.eventThrottleMs <= 0) {
    return YES;
  }

  NSTimeInterval deltaMs = (now - self.lastDispatchTimestamp) * 1000.0;
  return deltaMs >= self.eventThrottleMs;
}

- (void)emitScrollEventNamed:(NSString *)name force:(BOOL)force {
  if (!self.manager || !self.node) return;

  NSTimeInterval now = RuneScrollCurrentTime();
  CGPoint offset = self.scrollView.contentOffset;
  if (![self shouldEmitScrollEventAtTime:now offset:offset force:force name:name]) {
    return;
  }

  self.lastDispatchTimestamp = now;
  self.lastDispatchedOffset = offset;

  NSDictionary *payload = [self buildPayload];

  if (self.bridgeCoalescing && [name isEqualToString:@"onScroll"] && !force) {
    self.pendingPayload = payload;
    if (!self.coalesceScheduled) {
      self.coalesceScheduled = YES;
      dispatch_async(dispatch_get_main_queue(), ^{
        self.coalesceScheduled = NO;
        NSDictionary *pending = self.pendingPayload;
        self.pendingPayload = nil;
        if (pending) {
          [self.manager sn_dispatchEvent:@"onScroll" payload:pending toNode:self.node];
        }
      });
    }
  } else {
    [self.manager sn_dispatchEvent:name payload:payload toNode:self.node];
  }
}

#pragma mark - Snapping

- (BOOL)shouldSnap {
  if (!self.snapEnabled) return NO;
  if ([self.snapAxisMode isEqualToString:@"x"] || [self.snapAxisMode isEqualToString:@"inline"]) {
    return self.axis == RuneScrollAxisHorizontal;
  }
  if ([self.snapAxisMode isEqualToString:@"y"] || [self.snapAxisMode isEqualToString:@"block"]) {
    return self.axis == RuneScrollAxisVertical;
  }
  return YES;
}

- (void)scheduleSnapCheckWithForce:(BOOL)force {
  if (![self shouldSnap]) return;
  self.snapPendingForce = self.snapPendingForce || force || self.snapStopAlways;
  if (self.snapPendingCheck) return;
  self.snapPendingCheck = YES;
  dispatch_async(dispatch_get_main_queue(), ^{
    self.snapPendingCheck = NO;
    BOOL forceSnap = self.snapPendingForce;
    self.snapPendingForce = NO;
    [self performSnapIfNecessaryForce:forceSnap];
  });
}

- (void)performSnapIfNecessaryForce:(BOOL)force {
  if (![self shouldSnap]) return;
  if (self.contentView.subviews.count == 0) return;

  CGSize viewportSize = self.scrollView.bounds.size;
  if (viewportSize.width <= 0 || viewportSize.height <= 0) return;

  CGFloat viewport = (self.axis == RuneScrollAxisHorizontal) ? viewportSize.width : viewportSize.height;
  if (viewport <= 0) return;

  CGPoint currentOffsetPoint = self.scrollView.contentOffset;
  CGFloat currentOffset = (self.axis == RuneScrollAxisHorizontal) ? currentOffsetPoint.x : currentOffsetPoint.y;
  CGSize contentSize = self.scrollView.contentSize;
  CGFloat maxScroll = (self.axis == RuneScrollAxisHorizontal) ? MAX(0, contentSize.width - viewportSize.width)
                                                              : MAX(0, contentSize.height - viewportSize.height);

  NSArray<UIView *> *candidates = [self candidateViewsForSnapping];
  if (candidates.count == 0) return;

  NSArray<NSString *> *alignments = self.snapAlignments.count > 0 ? self.snapAlignments : @[@"start"];
  CGFloat bestDistance = CGFLOAT_MAX;
  CGFloat bestTarget = -1;

  for (UIView *child in candidates) {
    CGRect rect = [child convertRect:child.bounds toView:self.contentView];
    CGFloat childStart = (self.axis == RuneScrollAxisHorizontal) ? CGRectGetMinX(rect) : CGRectGetMinY(rect);
    CGFloat childSize = (self.axis == RuneScrollAxisHorizontal) ? CGRectGetWidth(rect) : CGRectGetHeight(rect);
    if (childSize <= 0) continue;
    CGFloat childEnd = childStart + childSize;

    for (NSString *align in alignments) {
      NSString *lower = align.lowercaseString;
      CGFloat targetOffset = 0;
      if ([lower isEqualToString:@"center"]) {
        targetOffset = (childStart + childSize / 2.0) - viewport / 2.0;
      } else if ([lower isEqualToString:@"end"]) {
        NSInteger paddingEnd = (self.axis == RuneScrollAxisHorizontal) ? self.snapPaddingEnd : self.snapPaddingBottom;
        targetOffset = (childEnd + paddingEnd) - viewport;
      } else {
        NSInteger paddingStart = (self.axis == RuneScrollAxisHorizontal) ? self.snapPaddingStart : self.snapPaddingTop;
        targetOffset = childStart - paddingStart;
      }
      CGFloat clamped = MIN(MAX(targetOffset, 0), maxScroll);
      CGFloat distance = fabs(clamped - currentOffset);
      if (distance + 0.5f < bestDistance) {
        bestDistance = distance;
        bestTarget = clamped;
      }
    }
  }

  if (bestTarget < 0) return;

  CGFloat threshold = viewport * 0.25f;
  BOOL shouldSnap = force || [self.snapStrictness isEqualToString:@"mandatory"] || bestDistance <= threshold;
  if (!shouldSnap) return;

  if (self.snapStopAlways) {
    [self.scrollView.layer removeAllAnimations];
  }

  CGPoint targetOffset = self.scrollView.contentOffset;
  if (self.axis == RuneScrollAxisHorizontal) {
    targetOffset.x = bestTarget;
  } else {
    targetOffset.y = bestTarget;
  }

  [self.scrollView setContentOffset:targetOffset animated:YES];
}

- (NSArray<UIView *> *)candidateViewsForSnapping {
  if (self.contentView.subviews.count == 1) {
    UIView *sole = self.contentView.subviews.firstObject;
    if ([sole isKindOfClass:[UIView class]] && sole.subviews.count > 0) {
      return sole.subviews;
    }
  }
  return self.contentView.subviews;
}

@end
