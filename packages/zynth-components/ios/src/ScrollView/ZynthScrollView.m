#import "ZynthScrollView.h"

#import "ZynthUIManager+Internal.h"
#import "ZynthUIManager.h"

#import <QuartzCore/QuartzCore.h>

static NSTimeInterval ZynthScrollCurrentTime(void) {
  return CACurrentMediaTime();
}

@class ZynthScrollView;

// Forward declare the content view class
@interface ZynthScrollViewContentView : UIView
@property(nonatomic, weak) ZynthScrollView *scrollView;
@end

// Declare private properties and methods for ZynthScrollView FIRST
@interface ZynthScrollView ()
@property(nonatomic, weak) ZynthUIManager *manager;
@property(nonatomic, weak) ZynthNode *node;
@property(nonatomic, strong) UIScrollView *scrollView;
@property(nonatomic, strong) ZynthScrollViewContentView *contentView;
@property(nonatomic, assign) ZynthScrollAxis axis;
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
@property(nonatomic, assign) CGSize manualContentSize;
@property(nonatomic, assign) NSTimeInterval lastGestureTimestamp;

- (void)scheduleContentGeometryUpdate;
@end

// Implementation of the content view
@implementation ZynthScrollViewContentView

- (void)didAddSubview:(UIView *)subview {
  [super didAddSubview:subview];
  [subview addObserver:self forKeyPath:@"center" options:NSKeyValueObservingOptionNew context:nil];
  [subview addObserver:self forKeyPath:@"bounds" options:NSKeyValueObservingOptionNew context:nil];
  self.scrollView.contentGeometryDirty = YES;
  [self.scrollView scheduleContentGeometryUpdate];
}

- (void)willRemoveSubview:(UIView *)subview {
  [super willRemoveSubview:subview];
  [subview removeObserver:self forKeyPath:@"center"];
  [subview removeObserver:self forKeyPath:@"bounds"];
  self.scrollView.contentGeometryDirty = YES;
  [self.scrollView scheduleContentGeometryUpdate];
}

- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary<NSKeyValueChangeKey,id> *)change context:(void *)context {
  if ([keyPath isEqualToString:@"center"] || [keyPath isEqualToString:@"bounds"]) {
    self.scrollView.contentGeometryDirty = YES;
    [self.scrollView scheduleContentGeometryUpdate];
  } else {
    [super observeValueForKeyPath:keyPath ofObject:object change:change context:context];
  }
}

@end

@interface ZynthInternalScrollView : UIScrollView
@end

@implementation ZynthInternalScrollView
- (BOOL)touchesShouldCancelInContentView:(UIView *)view {
  if ([view isKindOfClass:[UIControl class]]) {
    return NO;
  }
  return [super touchesShouldCancelInContentView:view];
}
@end

@implementation ZynthScrollView

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
  _scrollView = [[ZynthInternalScrollView alloc] initWithFrame:CGRectZero];
  _scrollView.delegate = self;
  _scrollView.delaysContentTouches = YES;
  _scrollView.canCancelContentTouches = YES;
  _scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
  _scrollView.showsVerticalScrollIndicator = YES;
  _scrollView.showsHorizontalScrollIndicator = YES;
  _scrollView.alwaysBounceVertical = YES;
  _scrollView.alwaysBounceHorizontal = NO;
  _scrollView.bounces = YES;
  _scrollView.scrollsToTop = NO;

  _contentView = [[ZynthScrollViewContentView alloc] initWithFrame:CGRectZero];
  _contentView.scrollView = self;
  _contentView.clipsToBounds = NO;
  _contentView.backgroundColor = UIColor.clearColor;

  [super insertSubview:_scrollView atIndex:0];
  [_scrollView addSubview:_contentView];

  _axis = ZynthScrollAxisVertical;
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
}

- (void)dealloc {
  _scrollView.delegate = nil;
}

- (void)attachToManager:(ZynthUIManager *_Nullable)manager node:(ZynthNode *_Nullable)node {
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
  
  // 1. If manual size is provided, use it directly.
  if (self.manualContentSize.width > 0 || self.manualContentSize.height > 0) {
    CGFloat w = MAX(self.manualContentSize.width, boundsSize.width);
    CGFloat h = MAX(self.manualContentSize.height, boundsSize.height);
    CGSize nextContentSize = CGSizeMake(w, h);
    
    // Always update the content view frame to match the scrollable area
    _contentView.frame = CGRectMake(0, 0, nextContentSize.width, nextContentSize.height);
    
    CGFloat epsilon = 0.5f;
    if (fabs(nextContentSize.width - self.lastContentSize.width) > epsilon ||
        fabs(nextContentSize.height - self.lastContentSize.height) > epsilon) {
      _scrollView.contentSize = nextContentSize;
      self.lastContentSize = nextContentSize;
    }
    return;
  }

  // 2. Otherwise, calculate from subviews (legacy behavior)
  __block CGFloat contentWidth = boundsSize.width;
  __block CGFloat contentHeight = boundsSize.height;

  __block void (^accumulate)(UIView *);
  accumulate = ^(UIView *view) {
    CGRect rect = [view convertRect:view.bounds toView:self.contentView];
    contentWidth = MAX(contentWidth, CGRectGetMaxX(rect));
    contentHeight = MAX(contentHeight, CGRectGetMaxY(rect));
    
    // Stop recursion for controls (Switch, Slider, etc.) to avoid measuring 
    // their internal implementation subviews which may have erratic frames.
    if ([view isKindOfClass:[UIControl class]]) {
      return;
    }
    
    for (UIView *child in view.subviews) {
      accumulate(child);
    }
  };

  for (UIView *subview in _contentView.subviews) {
    accumulate(subview);
  }

  if (self.axis == ZynthScrollAxisHorizontal) {
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
  // If we have a manual size, update immediately (no deferral needed)
  if (self.manualContentSize.width > 0 || self.manualContentSize.height > 0) {
    self.contentGeometryDirty = YES;
    [self updateContentGeometry];
    return;
  }

  if (!self.contentGeometryDirty) return;
  if ([self shouldDeferContentGeometryForOffset:self.scrollView.contentOffset]) return;
  if (self.contentUpdateScheduled) return;
  self.contentUpdateScheduled = YES;
  dispatch_async(dispatch_get_main_queue(), ^{
    self.contentUpdateScheduled = NO;
    if (self.contentGeometryDirty) {
      [self updateContentGeometry];
    }
  });
}

- (BOOL)shouldDeferContentGeometryForOffset:(CGPoint)offset {
  // Only defer if the user is actively dragging.
  // We used to defer if overscrolling, but that causes deadlocks when the content size
  // needs to grow/shrink while the user is pulling against the edge.
  return self.isDraggingState;
}

#pragma mark - Property setters

- (void)zynth_setAxis:(ZynthScrollAxis)axis {
  if (_axis == axis) return;
  _axis = axis;
  BOOL horizontal = axis == ZynthScrollAxisHorizontal;
  _scrollView.alwaysBounceHorizontal = horizontal;
  _scrollView.alwaysBounceVertical = !horizontal;
  _scrollView.showsHorizontalScrollIndicator = horizontal;
  _scrollView.showsVerticalScrollIndicator = !horizontal;
  [self setNeedsLayout];
  if (self.snapEnabled) {
    [self scheduleSnapCheckWithForce:(self.snapStrictness && [self.snapStrictness isEqualToString:@"mandatory"])];
  }
}

- (void)zynth_setScrollEnabled:(BOOL)enabled {
  _scrollEnabled = enabled;
  _scrollView.scrollEnabled = enabled;
}

- (void)zynth_setDirectionalLockEnabled:(BOOL)enabled {
  _directionalLockEnabled = enabled;
  _scrollView.directionalLockEnabled = enabled;
}

- (void)zynth_setShowsVerticalScrollIndicator:(BOOL)show {
  _scrollView.showsVerticalScrollIndicator = show;
}

- (void)zynth_setShowsHorizontalScrollIndicator:(BOOL)show {
  _scrollView.showsHorizontalScrollIndicator = show;
}

- (void)zynth_setIndicatorStyle:(NSString *_Nullable)style {
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

- (void)zynth_setOverScrollBehavior:(NSString *_Nullable)behavior {
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
    _scrollView.alwaysBounceHorizontal = _axis == ZynthScrollAxisHorizontal;
    _scrollView.alwaysBounceVertical = _axis != ZynthScrollAxisHorizontal;
  }
}

- (void)zynth_setBounces:(BOOL)enabled {
  _scrollView.bounces = enabled;
}

- (void)zynth_setDecelerationRate:(NSNumber *_Nullable)value {
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

- (void)zynth_setEventThrottleMs:(NSNumber *_Nullable)msValue {
  if (!msValue || [msValue isKindOfClass:[NSNull class]]) {
    _eventThrottleMs = 16.0;
    return;
  }
  _eventThrottleMs = MAX(0.0, (CGFloat)[msValue doubleValue]);
}

- (void)zynth_setEventMinDisplacement:(NSNumber *_Nullable)value {
  if (!value || [value isKindOfClass:[NSNull class]]) {
    _eventMinDisplacement = 0.0;
    return;
  }
  _eventMinDisplacement = MAX(0.0, (CGFloat)[value doubleValue]);
}

- (void)zynth_setBridgeCoalescing:(BOOL)enabled {
  _bridgeCoalescing = enabled;
  if (!enabled) {
    _pendingPayload = nil;
    _coalesceScheduled = NO;
  }
}

- (void)zynth_setContentInset:(NSDictionary *_Nullable)inset {
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

- (void)zynth_setScrollGuardConfig:(NSDictionary *_Nullable)config {
  // No-op: Scroll guard removed to restore vanilla UIScrollView behavior.
}

- (void)zynth_setScrollSnapType:(id)value {
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

- (void)zynth_setScrollSnapAlign:(id)value {
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

- (void)zynth_setScrollSnapStop:(id)value {
  if ([value isKindOfClass:[NSString class]]) {
    self.snapStopAlways = [((NSString *)value) caseInsensitiveCompare:@"always"] == NSOrderedSame;
  } else {
    self.snapStopAlways = NO;
  }
}

- (void)zynth_setScrollPadding:(id)value {
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

- (void)zynth_setManualContentSize:(NSDictionary *_Nullable)size {
  if (![size isKindOfClass:[NSDictionary class]]) {
    self.manualContentSize = CGSizeZero;
  } else {
    CGFloat width = [size[@"width"] respondsToSelector:@selector(doubleValue)] ? [size[@"width"] doubleValue] : 0;
    CGFloat height = [size[@"height"] respondsToSelector:@selector(doubleValue)] ? [size[@"height"] doubleValue] : 0;
    self.manualContentSize = CGSizeMake(width, height);
  }
  self.contentGeometryDirty = YES;
  [self updateContentGeometry];
}

- (void)zynth_applyCommand:(NSDictionary *_Nullable)command {
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
    [self zynth_lockAxis:axis];
    return;
  }
}

- (void)zynth_lockAxis:(NSString *_Nullable)axisName {
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
  self.lastGestureTimestamp = ZynthScrollCurrentTime();
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
  [self emitScrollEventNamed:@"onScroll" force:NO];
  if (![self shouldDeferContentGeometryForOffset:scrollView.contentOffset]) {
    [self scheduleContentGeometryUpdate];
  }
}

- (void)scrollViewDidEndDragging:(UIScrollView *)scrollView willDecelerate:(BOOL)decelerate {
  self.isDraggingState = NO;
  self.lastGestureTimestamp = ZynthScrollCurrentTime();
  [self emitScrollEventNamed:@"onScrollEndDrag" force:YES];
  if (!decelerate) {
    self.isDeceleratingState = NO;
    [self emitScrollEventNamed:@"onMomentumScrollEnd" force:YES];
    [self scheduleSnapCheckWithForce:[self.snapStrictness isEqualToString:@"mandatory"]];
    [self scheduleContentGeometryUpdate];
  }
}

- (void)scrollViewWillBeginDecelerating:(UIScrollView *)scrollView {
  self.isDeceleratingState = YES;
  self.lastGestureTimestamp = ZynthScrollCurrentTime();
  [self emitScrollEventNamed:@"onMomentumScrollBegin" force:YES];
}

- (void)scrollViewDidEndDecelerating:(UIScrollView *)scrollView {
  if (self.isDeceleratingState) {
    self.isDeceleratingState = NO;
    [self emitScrollEventNamed:@"onMomentumScrollEnd" force:YES];
    [self scheduleSnapCheckWithForce:YES];
    [self scheduleContentGeometryUpdate];
  }
}

- (void)scrollViewDidEndScrollingAnimation:(UIScrollView *)scrollView {
  if (self.isDeceleratingState) {
    self.isDeceleratingState = NO;
    [self emitScrollEventNamed:@"onMomentumScrollEnd" force:YES];
  }
  [self scheduleSnapCheckWithForce:YES];
  [self scheduleContentGeometryUpdate];
}

#pragma mark - Event helpers

- (void)updateVelocity {
  NSTimeInterval now = ZynthScrollCurrentTime();
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

  NSTimeInterval now = ZynthScrollCurrentTime();
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
          [self.manager zynth_dispatchEvent:@"onScroll" payload:pending toNode:self.node];
        }
      });
    }
  } else {
    [self.manager zynth_dispatchEvent:name payload:payload toNode:self.node];
  }
}

#pragma mark - Snapping

- (BOOL)shouldSnap {
  if (!self.snapEnabled) return NO;
  if ([self.snapAxisMode isEqualToString:@"x"] || [self.snapAxisMode isEqualToString:@"inline"]) {
    return self.axis == ZynthScrollAxisHorizontal;
  }
  if ([self.snapAxisMode isEqualToString:@"y"] || [self.snapAxisMode isEqualToString:@"block"]) {
    return self.axis == ZynthScrollAxisVertical;
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

  CGFloat viewport = (self.axis == ZynthScrollAxisHorizontal) ? viewportSize.width : viewportSize.height;
  if (viewport <= 0) return;

  CGPoint currentOffsetPoint = self.scrollView.contentOffset;
  CGFloat currentOffset = (self.axis == ZynthScrollAxisHorizontal) ? currentOffsetPoint.x : currentOffsetPoint.y;
  CGSize contentSize = self.scrollView.contentSize;
  CGFloat maxScroll = (self.axis == ZynthScrollAxisHorizontal) ? MAX(0, contentSize.width - viewportSize.width)
                                                              : MAX(0, contentSize.height - viewportSize.height);

  NSArray<UIView *> *candidates = [self candidateViewsForSnapping];
  if (candidates.count == 0) return;

  NSArray<NSString *> *alignments = self.snapAlignments.count > 0 ? self.snapAlignments : @[@"start"];
  CGFloat bestDistance = CGFLOAT_MAX;
  CGFloat bestTarget = -1;

  for (UIView *child in candidates) {
    CGRect rect = [child convertRect:child.bounds toView:self.contentView];
    CGFloat childStart = (self.axis == ZynthScrollAxisHorizontal) ? CGRectGetMinX(rect) : CGRectGetMinY(rect);
    CGFloat childSize = (self.axis == ZynthScrollAxisHorizontal) ? CGRectGetWidth(rect) : CGRectGetHeight(rect);
    if (childSize <= 0) continue;
    CGFloat childEnd = childStart + childSize;

    for (NSString *align in alignments) {
      NSString *lower = align.lowercaseString;
      CGFloat targetOffset = 0;
      if ([lower isEqualToString:@"center"]) {
        targetOffset = (childStart + childSize / 2.0) - viewport / 2.0;
      } else if ([lower isEqualToString:@"end"]) {
        NSInteger paddingEnd = (self.axis == ZynthScrollAxisHorizontal) ? self.snapPaddingEnd : self.snapPaddingBottom;
        targetOffset = (childEnd + paddingEnd) - viewport;
      } else {
        NSInteger paddingStart = (self.axis == ZynthScrollAxisHorizontal) ? self.snapPaddingStart : self.snapPaddingTop;
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
  if (self.axis == ZynthScrollAxisHorizontal) {
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
