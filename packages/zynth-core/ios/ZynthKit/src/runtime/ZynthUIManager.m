#import "ZynthUIManager.h"
#import "ZynthUIBindings.h"
#import "ZynthYogaLayout.h"
#import <dispatch/dispatch.h>
#import <math.h>
#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>

@implementation ZynthUIManager {
  __weak UIView *_rootView;
  NSMutableDictionary<NSNumber *, UIView *> *_nodes;
  NSMutableDictionary<NSNumber *, NSNumber *> *_parents;
  NSMutableDictionary<NSNumber *, NSString *> *_pointerEvents;
  NSMutableSet<NSNumber *> *_pressNodes;
  NSMutableSet<NSNumber *> *_longPressNodes;
  NSMutableSet<NSNumber *> *_doublePressNodes;
  NSMutableSet<NSNumber *> *_activePressNodes;
  NSMutableSet<NSNumber *> *_longPressFired;
  NSMutableDictionary<NSNumber *, NSNumber *> *_longPressDurations;
  NSMutableDictionary<NSNumber *, NSNumber *> *_doublePressWindows;
  NSMutableDictionary<NSNumber *, NSNumber *> *_lastPressTimestamps;
  NSMutableDictionary<NSNumber *, NSValue *> *_pressLocalPoints;
  NSMutableDictionary<NSNumber *, NSValue *> *_pressScreenPoints;
  NSMutableDictionary<NSNumber *, dispatch_source_t> *_longPressTimers;
  NSMutableSet<NSNumber *> *_layoutNodes;
  NSMutableSet<NSNumber *> *_layoutPending;
  NSMutableDictionary<NSNumber *, NSValue *> *_layoutFrames;
  ZynthYogaLayout *_yogaLayout;
  int _nextId;
  CADisplayLink *_displayLink;
  BOOL _needsLayout;
  BOOL _frameInProgress;
  NSUInteger _budgetOverruns;
  NSTimeInterval _lastLayoutMs;
  NSTimeInterval _lastFrameMs;
  void (^_frameProfiler)(NSTimeInterval frameMs,
                         NSTimeInterval layoutMs,
                         BOOL overBudget,
                         NSUInteger nodeCount);
}

- (instancetype)initWithRootView:(UIView *)rootView {
  self = [super init];
  if (self) {
    _rootView = rootView;
    _nodes = [NSMutableDictionary dictionary];
    _parents = [NSMutableDictionary dictionary];
    _pointerEvents = [NSMutableDictionary dictionary];
    _pressNodes = [NSMutableSet set];
    _longPressNodes = [NSMutableSet set];
    _doublePressNodes = [NSMutableSet set];
    _activePressNodes = [NSMutableSet set];
    _longPressFired = [NSMutableSet set];
    _longPressDurations = [NSMutableDictionary dictionary];
    _doublePressWindows = [NSMutableDictionary dictionary];
    _lastPressTimestamps = [NSMutableDictionary dictionary];
    _pressLocalPoints = [NSMutableDictionary dictionary];
    _pressScreenPoints = [NSMutableDictionary dictionary];
    _longPressTimers = [NSMutableDictionary dictionary];
    _layoutNodes = [NSMutableSet set];
    _layoutPending = [NSMutableSet set];
    _layoutFrames = [NSMutableDictionary dictionary];
    _yogaLayout = [[ZynthYogaLayout alloc] initWithRootView:rootView];
    _nextId = 1;
    _needsLayout = NO;
    _frameInProgress = NO;
    _budgetOverruns = 0;
    _lastLayoutMs = 0;
    _lastFrameMs = 0;
    [self ensureDisplayLink];
  }
  return self;
}

- (NSNumber *)createNode:(NSString *)type {
  int nid = _nextId++;
  UIView *view = nil;
  if ([type isEqualToString:@"text"]) {
    UILabel *label = [[UILabel alloc] initWithFrame:CGRectZero];
    label.numberOfLines = 0;
    view = label;
  } else {
    view = [[UIView alloc] initWithFrame:CGRectZero];
  }
  _nodes[@(nid)] = view;
  _pointerEvents[@(nid)] = @"auto";
  [_yogaLayout createNodeWithId:@(nid) type:type view:view];
  return @(nid);
}

- (NSNumber *)createNodeWithId:(NSNumber *)nodeId type:(NSString *)type {
  int nid = nodeId.intValue > 0 ? nodeId.intValue : _nextId++;
  if (nid >= _nextId) {
    _nextId = nid + 1;
  }
  UIView *view = nil;
  if ([type isEqualToString:@"text"]) {
    UILabel *label = [[UILabel alloc] initWithFrame:CGRectZero];
    label.numberOfLines = 0;
    view = label;
  } else {
    view = [[UIView alloc] initWithFrame:CGRectZero];
  }
  _nodes[@(nid)] = view;
  _pointerEvents[@(nid)] = @"auto";
  [_yogaLayout createNodeWithId:@(nid) type:type view:view];
  return @(nid);
}

- (void)setProp:(NSNumber *)nodeId name:(NSString *)name value:(NSString *)value {
  UIView *view = _nodes[nodeId];
  if (!view || name.length == 0) return;
  if ([name isEqualToString:@"backgroundColor"]) {
    UIColor *color = [self colorFromString:value];
    if (color) view.backgroundColor = color;
    return;
  }
  if ([name isEqualToString:@"color"] && [view isKindOfClass:[UILabel class]]) {
    UIColor *color = [self colorFromString:value];
    if (color) ((UILabel *)view).textColor = color;
    return;
  }
  if ([name isEqualToString:@"opacity"]) {
    view.alpha = (CGFloat)[value doubleValue];
    return;
  }
  if ([name isEqualToString:@"zIndex"]) {
    view.layer.zPosition = (CGFloat)[value doubleValue];
    return;
  }
  if ([name isEqualToString:@"borderRadius"]) {
    view.layer.cornerRadius = (CGFloat)[value doubleValue];
    view.clipsToBounds = YES;
    return;
  }
  if ([name isEqualToString:@"borderWidth"]) {
    view.layer.borderWidth = (CGFloat)[value doubleValue];
    return;
  }
  if ([name isEqualToString:@"borderColor"]) {
    UIColor *color = [self colorFromString:value];
    if (color) view.layer.borderColor = color.CGColor;
    return;
  }
  if ([name isEqualToString:@"delayLongPressMs"]) {
    if (value.length > 0) {
      _longPressDurations[nodeId] = @([value doubleValue]);
    } else {
      [_longPressDurations removeObjectForKey:nodeId];
    }
    return;
  }
  if ([name isEqualToString:@"doublePressWindowMs"]) {
    if (value.length > 0) {
      _doublePressWindows[nodeId] = @([value doubleValue]);
    } else {
      [_doublePressWindows removeObjectForKey:nodeId];
    }
    return;
  }
  if ([name isEqualToString:@"enableDoublePress"]) {
    if (value.length > 0) {
      NSString *lower = [value lowercaseString];
      BOOL enabled = [lower isEqualToString:@"true"] || [lower isEqualToString:@"1"];
      if (enabled) {
        [_doublePressNodes addObject:nodeId];
      } else {
        [_doublePressNodes removeObject:nodeId];
      }
    }
    return;
  }
  if ([name isEqualToString:@"pointerEvents"]) {
    if (value.length > 0) {
      _pointerEvents[nodeId] = value;
    } else {
      [_pointerEvents removeObjectForKey:nodeId];
    }
    [self updateInteractionStateForNode:nodeId];
    return;
  }
  if ([name isEqualToString:@"fontSize"] && [view isKindOfClass:[UILabel class]]) {
    UILabel *label = (UILabel *)view;
    CGFloat size = (CGFloat)[value doubleValue];
    UIFont *font = label.font ?: [UIFont systemFontOfSize:size];
    label.font = [font fontWithSize:size];
    return;
  }
  if ([name isEqualToString:@"fontWeight"] && [view isKindOfClass:[UILabel class]]) {
    UILabel *label = (UILabel *)view;
    CGFloat fontSize = label.font ? label.font.pointSize : 14.0;
    UIFontWeight weight = UIFontWeightRegular;
    if ([value isEqualToString:@"bold"] || [value isEqualToString:@"700"]) weight = UIFontWeightBold;
    else if ([value isEqualToString:@"600"]) weight = UIFontWeightSemibold;
    else if ([value isEqualToString:@"500"]) weight = UIFontWeightMedium;
    label.font = [UIFont systemFontOfSize:fontSize weight:weight];
    return;
  }
  if ([name isEqualToString:@"fontFamily"] && [view isKindOfClass:[UILabel class]]) {
    UILabel *label = (UILabel *)view;
    UIFont *font = [UIFont fontWithName:value size:label.font.pointSize];
    if (font) label.font = font;
    return;
  }
  if ([name isEqualToString:@"fontStyle"] && [view isKindOfClass:[UILabel class]]) {
    UILabel *label = (UILabel *)view;
    if ([value isEqualToString:@"italic"]) {
      UIFontDescriptor *descriptor = [label.font.fontDescriptor fontDescriptorWithSymbolicTraits:UIFontDescriptorTraitItalic];
      if (descriptor) label.font = [UIFont fontWithDescriptor:descriptor size:label.font.pointSize];
    }
    return;
  }
  if ([name isEqualToString:@"textAlign"] && [view isKindOfClass:[UILabel class]]) {
    UILabel *label = (UILabel *)view;
    if ([value isEqualToString:@"center"]) label.textAlignment = NSTextAlignmentCenter;
    else if ([value isEqualToString:@"right"]) label.textAlignment = NSTextAlignmentRight;
    else if ([value isEqualToString:@"left"]) label.textAlignment = NSTextAlignmentLeft;
    else label.textAlignment = NSTextAlignmentNatural;
    return;
  }
  if ([name isEqualToString:@"letterSpacing"] && [view isKindOfClass:[UILabel class]]) {
    UILabel *label = (UILabel *)view;
    NSString *text = label.text ?: @"";
    NSMutableAttributedString *attr = [[NSMutableAttributedString alloc] initWithString:text];
    [attr addAttribute:NSKernAttributeName value:@([value doubleValue]) range:NSMakeRange(0, attr.length)];
    label.attributedText = attr;
    return;
  }
  if ([name isEqualToString:@"width"]) {
    [_yogaLayout setStyle:nodeId name:@"width" value:value];
    return;
  }
  if ([name isEqualToString:@"height"]) {
    [_yogaLayout setStyle:nodeId name:@"height" value:value];
    return;
  }
  if ([name isEqualToString:@"flexDirection"]) {
    [_yogaLayout setStyle:nodeId name:@"flexDirection" value:value];
    return;
  }
  [_yogaLayout setStyle:nodeId name:name value:value];
}

- (void)setText:(NSNumber *)nodeId text:(NSString *)text {
  UIView *view = _nodes[nodeId];
  if ([view isKindOfClass:[UILabel class]]) {
    ((UILabel *)view).text = text ?: @"";
    [_yogaLayout markDirty:nodeId];
    NSNumber *parentId = _parents[nodeId];
    if (parentId) {
      UIView *parent = _nodes[parentId];
      if ([parent isKindOfClass:[UILabel class]]) {
        ((UILabel *)parent).text = text ?: @"";
        [_yogaLayout markDirty:parentId];
      }
    }
  }
}

- (void)insertChild:(NSNumber *)parentId child:(NSNumber *)childId index:(NSNumber *)index {
  UIView *child = _nodes[childId];
  if (!child) return;
  UIView *parent = parentId.intValue == 0 ? _rootView : _nodes[parentId];
  if (!parent) return;
  _parents[childId] = parentId;
  if ([parent isKindOfClass:[UILabel class]]) {
    if ([child isKindOfClass:[UILabel class]]) {
      ((UILabel *)parent).text = ((UILabel *)child).text ?: @"";
      [_yogaLayout markDirty:parentId];
    }
    return;
  }
  NSInteger idx = MAX(0, MIN(index.integerValue, (NSInteger)parent.subviews.count));
  [parent insertSubview:child atIndex:(NSUInteger)idx];
  [_yogaLayout insertChild:parentId child:childId index:index];
}

- (void)removeChild:(NSNumber *)parentId child:(NSNumber *)childId {
  UIView *child = _nodes[childId];
  if (!child) return;
  [_parents removeObjectForKey:childId];
  [child removeFromSuperview];
  [_yogaLayout removeChild:parentId child:childId];
}

- (void)setHandler:(NSNumber *)nodeId name:(NSString *)name {
  UIView *view = _nodes[nodeId];
  if (!view || name.length == 0) return;
  if ([name isEqualToString:@"onPress"] || [name isEqualToString:@"onPressIn"] ||
      [name isEqualToString:@"onPressOut"] || [name isEqualToString:@"onLongPress"] ||
      [name isEqualToString:@"onDoublePress"]) {
    [_pressNodes addObject:nodeId];
    if ([name isEqualToString:@"onLongPress"]) {
      [_longPressNodes addObject:nodeId];
    }
    if ([name isEqualToString:@"onDoublePress"]) {
      [_doublePressNodes addObject:nodeId];
    }
    [self attachPressRecognizerForNode:nodeId];
    [self updateInteractionStateForNode:nodeId];
    return;
  }
  if ([name isEqualToString:@"onLayout"]) {
    [_layoutNodes addObject:nodeId];
    [_layoutPending addObject:nodeId];
    [self requestLayout];
    return;
  }
}

- (void)applyBatch:(NSString *)batchJSON {
  (void)batchJSON;
}

- (void)setSurface:(NSNumber *)surfaceId {
  (void)surfaceId;
}

- (void)flush {
  [self requestLayout];
}

- (void)setFrameProfiler:(void (^)(NSTimeInterval,
                                   NSTimeInterval,
                                   BOOL,
                                   NSUInteger))profiler {
  _frameProfiler = [profiler copy];
}

- (void)dealloc {
  for (NSNumber *key in _longPressTimers) {
    dispatch_source_t timer = _longPressTimers[key];
    if (timer) dispatch_source_cancel(timer);
  }
  [_longPressTimers removeAllObjects];
  if (_displayLink) {
    [_displayLink invalidate];
    _displayLink = nil;
  }
}

- (void)ensureDisplayLink {
  if (_displayLink) return;
  if ([NSThread isMainThread]) {
    _displayLink = [CADisplayLink displayLinkWithTarget:self selector:@selector(handleDisplayLink:)];
    _displayLink.paused = YES;
    [_displayLink addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
  } else {
    dispatch_async(dispatch_get_main_queue(), ^{
      if (self->_displayLink) return;
      self->_displayLink = [CADisplayLink displayLinkWithTarget:self selector:@selector(handleDisplayLink:)];
      self->_displayLink.paused = YES;
      [self->_displayLink addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
    });
  }
}

- (void)requestLayout {
  if ([NSThread isMainThread]) {
    [self ensureDisplayLink];
    _needsLayout = YES;
    if (_displayLink) _displayLink.paused = NO;
  } else {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self ensureDisplayLink];
      self->_needsLayout = YES;
      if (self->_displayLink) self->_displayLink.paused = NO;
    });
  }
}

- (void)handleDisplayLink:(CADisplayLink *)link {
  (void)link;
  if (_frameInProgress) return;
  if (!_needsLayout) {
    _displayLink.paused = YES;
    return;
  }
  _frameInProgress = YES;
  _needsLayout = NO;

  static const NSTimeInterval kFrameBudgetMs = 14.0;
  CFTimeInterval frameStart = CACurrentMediaTime();
  [_yogaLayout applyLayout];
  CFTimeInterval frameEnd = CACurrentMediaTime();
  _lastFrameMs = (frameEnd - frameStart) * 1000.0;
  _lastLayoutMs = _lastFrameMs;
  BOOL overBudget = _lastFrameMs > kFrameBudgetMs;
  if (overBudget) {
    _budgetOverruns += 1;
    NSLog(@"[ZynthUI] frame over budget %.2fms (budget %.2fms, nodes %lu, overruns %lu)",
          _lastFrameMs, kFrameBudgetMs, (unsigned long)[_yogaLayout nodeCount],
          (unsigned long)_budgetOverruns);
  }
  if (_frameProfiler) {
    _frameProfiler(_lastFrameMs, _lastLayoutMs, overBudget, [_yogaLayout nodeCount]);
  }
  [self dispatchLayoutEvents];
  _frameInProgress = NO;
  if (!_needsLayout) {
    _displayLink.paused = YES;
  }
}

- (NSString *)pointerEventsForNode:(NSNumber *)nodeId {
  NSString *mode = _pointerEvents[nodeId];
  if (mode.length == 0) return @"auto";
  return mode;
}

- (void)updateInteractionStateForNode:(NSNumber *)nodeId {
  UIView *view = _nodes[nodeId];
  if (!view) return;
  NSString *mode = [self pointerEventsForNode:nodeId];
  BOOL hasPress = [_pressNodes containsObject:nodeId];
  BOOL enableInteraction = YES;
  BOOL enableRecognizer = hasPress;

  if ([mode isEqualToString:@"none"]) {
    enableInteraction = NO;
    enableRecognizer = NO;
  } else if ([mode isEqualToString:@"box-none"]) {
    enableInteraction = YES;
    enableRecognizer = NO;
  } else if ([mode isEqualToString:@"box-only"]) {
    enableInteraction = YES;
    enableRecognizer = hasPress;
  } else {
    enableInteraction = YES;
    enableRecognizer = hasPress;
  }

  view.userInteractionEnabled = enableInteraction;
  for (UIGestureRecognizer *recognizer in view.gestureRecognizers) {
    if (![recognizer isKindOfClass:[UILongPressGestureRecognizer class]]) continue;
    if (![recognizer.name hasPrefix:@"zynth:press:"]) continue;
    recognizer.enabled = enableRecognizer;
  }
}

- (void)attachPressRecognizerForNode:(NSNumber *)nodeId {
  UIView *view = _nodes[nodeId];
  if (!view) return;
  for (UIGestureRecognizer *recognizer in view.gestureRecognizers.copy) {
    if (![recognizer isKindOfClass:[UILongPressGestureRecognizer class]]) continue;
    if (![recognizer.name hasPrefix:@"zynth:press:"]) continue;
    [view removeGestureRecognizer:recognizer];
  }
  UILongPressGestureRecognizer *press =
      [[UILongPressGestureRecognizer alloc] initWithTarget:self action:@selector(handlePressGesture:)];
  press.minimumPressDuration = 0;
  press.cancelsTouchesInView = NO;
  press.name = [NSString stringWithFormat:@"zynth:press:%d", nodeId.intValue];
  [view addGestureRecognizer:press];
  view.userInteractionEnabled = YES;
}

- (void)handlePressGesture:(UILongPressGestureRecognizer *)recognizer {
  if (!recognizer || ![recognizer isKindOfClass:[UILongPressGestureRecognizer class]]) return;
  NSString *name = recognizer.name;
  if (![name hasPrefix:@"zynth:press:"]) return;
  int nodeId = [[name substringFromIndex:12] intValue];
  UIView *view = _nodes[@(nodeId)];
  if (!view) return;
  NSString *mode = [self pointerEventsForNode:@(nodeId)];
  if ([mode isEqualToString:@"none"] || [mode isEqualToString:@"box-none"]) return;

  CGPoint local = [recognizer locationInView:view];
  UIView *screenView = view.window ?: view;
  CGPoint screen = [recognizer locationInView:screenView];
  _pressLocalPoints[@(nodeId)] = [NSValue valueWithCGPoint:local];
  _pressScreenPoints[@(nodeId)] = [NSValue valueWithCGPoint:screen];
  double timestampMs = [[NSDate date] timeIntervalSince1970] * 1000.0;
  BOOL inside = CGRectContainsPoint(view.bounds, local);

  if (recognizer.state == UIGestureRecognizerStateBegan) {
    [_activePressNodes addObject:@(nodeId)];
    [_longPressFired removeObject:@(nodeId)];
    [self scheduleLongPressTimerForNode:@(nodeId)];
    ZynthUIInvokePressEvent(nodeId,
                            "onPressIn",
                            local.x,
                            local.y,
                            screen.x,
                            screen.y,
                            -1,
                            timestampMs,
                            false);
    return;
  }
  if (recognizer.state == UIGestureRecognizerStateEnded) {
    [self cancelLongPressTimerForNode:@(nodeId)];
    [_activePressNodes removeObject:@(nodeId)];
    BOOL longPressed = [_longPressFired containsObject:@(nodeId)];
    if (inside && !longPressed) {
      ZynthUIInvokePressEvent(nodeId,
                              "onPress",
                              local.x,
                              local.y,
                              screen.x,
                              screen.y,
                              -1,
                              timestampMs,
                              false);
      [self maybeDispatchDoublePressForNode:@(nodeId) timestampMs:timestampMs];
    }
    ZynthUIInvokePressEvent(nodeId,
                            "onPressOut",
                            local.x,
                            local.y,
                            screen.x,
                            screen.y,
                            -1,
                            timestampMs,
                            !inside);
    return;
  }
  if (recognizer.state == UIGestureRecognizerStateCancelled ||
      recognizer.state == UIGestureRecognizerStateFailed) {
    [self cancelLongPressTimerForNode:@(nodeId)];
    [_activePressNodes removeObject:@(nodeId)];
    ZynthUIInvokePressEvent(nodeId,
                            "onPressOut",
                            local.x,
                            local.y,
                            screen.x,
                            screen.y,
                            -1,
                            timestampMs,
                            true);
  }
}

- (NSTimeInterval)longPressDurationForNode:(NSNumber *)nodeId {
  NSNumber *value = _longPressDurations[nodeId];
  double duration = value ? value.doubleValue : 500.0;
  if (duration < 0) duration = 0;
  return duration;
}

- (NSTimeInterval)doublePressWindowForNode:(NSNumber *)nodeId {
  NSNumber *value = _doublePressWindows[nodeId];
  double window = value ? value.doubleValue : 250.0;
  if (window < 0) window = 0;
  return window;
}

- (void)cancelLongPressTimerForNode:(NSNumber *)nodeId {
  dispatch_source_t timer = _longPressTimers[nodeId];
  if (timer) {
    dispatch_source_cancel(timer);
    [_longPressTimers removeObjectForKey:nodeId];
  }
}

- (void)scheduleLongPressTimerForNode:(NSNumber *)nodeId {
  if (![_longPressNodes containsObject:nodeId]) return;
  [self cancelLongPressTimerForNode:nodeId];
  NSTimeInterval delayMs = [self longPressDurationForNode:nodeId];
  dispatch_source_t timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0,
                                                   dispatch_get_main_queue());
  uint64_t delayNs = (uint64_t)(delayMs * 1000000.0);
  dispatch_source_set_timer(timer, dispatch_time(DISPATCH_TIME_NOW, (int64_t)delayNs), DISPATCH_TIME_FOREVER, 1000000);
  __weak typeof(self) weakSelf = self;
  dispatch_source_set_event_handler(timer, ^{
    __strong typeof(self) strongSelf = weakSelf;
    if (!strongSelf) return;
    if (![strongSelf->_activePressNodes containsObject:nodeId]) {
      [strongSelf cancelLongPressTimerForNode:nodeId];
      return;
    }
    if ([strongSelf->_longPressFired containsObject:nodeId]) {
      [strongSelf cancelLongPressTimerForNode:nodeId];
      return;
    }
    [strongSelf->_longPressFired addObject:nodeId];
    NSValue *localVal = strongSelf->_pressLocalPoints[nodeId];
    NSValue *screenVal = strongSelf->_pressScreenPoints[nodeId];
    CGPoint local = localVal ? localVal.CGPointValue : CGPointZero;
    CGPoint screen = screenVal ? screenVal.CGPointValue : CGPointZero;
    double timestampMs = [[NSDate date] timeIntervalSince1970] * 1000.0;
    ZynthUIInvokePressEvent(nodeId.intValue,
                            "onLongPress",
                            local.x,
                            local.y,
                            screen.x,
                            screen.y,
                            delayMs,
                            timestampMs,
                            false);
    [strongSelf cancelLongPressTimerForNode:nodeId];
  });
  dispatch_resume(timer);
  _longPressTimers[nodeId] = timer;
}

- (void)maybeDispatchDoublePressForNode:(NSNumber *)nodeId timestampMs:(double)timestampMs {
  if (![_doublePressNodes containsObject:nodeId]) {
    _lastPressTimestamps[nodeId] = @(timestampMs);
    return;
  }
  NSNumber *last = _lastPressTimestamps[nodeId];
  _lastPressTimestamps[nodeId] = @(timestampMs);
  if (!last) return;
  double delta = timestampMs - last.doubleValue;
  if (delta < 0) return;
  NSTimeInterval window = [self doublePressWindowForNode:nodeId];
  if (delta > window) return;
  NSValue *localVal = _pressLocalPoints[nodeId];
  NSValue *screenVal = _pressScreenPoints[nodeId];
  CGPoint local = localVal ? localVal.CGPointValue : CGPointZero;
  CGPoint screen = screenVal ? screenVal.CGPointValue : CGPointZero;
  ZynthUIInvokePressEvent(nodeId.intValue,
                          "onDoublePress",
                          local.x,
                          local.y,
                          screen.x,
                          screen.y,
                          -1,
                          timestampMs,
                          false);
}

- (void)dispatchLayoutEvents {
  if (_layoutNodes.count == 0) return;
  for (NSNumber *nodeId in _layoutNodes) {
    UIView *view = _nodes[nodeId];
    if (!view) continue;
    CGRect frame = view.frame;
    if (!isfinite(frame.origin.x) || !isfinite(frame.origin.y) || !isfinite(frame.size.width) ||
        !isfinite(frame.size.height)) {
      continue;
    }
    BOOL force = [_layoutPending containsObject:nodeId];
    NSValue *previous = _layoutFrames[nodeId];
    BOOL changed = !previous || !CGRectEqualToRect(previous.CGRectValue, frame);
    if (!force && !changed) continue;
    _layoutFrames[nodeId] = [NSValue valueWithCGRect:frame];
    [_layoutPending removeObject:nodeId];
    ZynthUIInvokeLayoutEvent(nodeId.intValue,
                             frame.origin.x,
                             frame.origin.y,
                             frame.size.width,
                             frame.size.height);
  }
}

- (UIColor *)colorFromString:(NSString *)value {
  if (value.length == 0) return nil;
  value = [value stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (![value hasPrefix:@"#"]) return nil;
  NSString *hex = [value substringFromIndex:1];
  unsigned long long parsed = 0;
  NSScanner *scanner = [NSScanner scannerWithString:hex];
  if (![scanner scanHexLongLong:&parsed]) return nil;
  CGFloat a = 1.0;
  CGFloat r = 0.0;
  CGFloat g = 0.0;
  CGFloat b = 0.0;
  if (hex.length == 6) {
    r = ((parsed >> 16) & 0xFF) / 255.0;
    g = ((parsed >> 8) & 0xFF) / 255.0;
    b = (parsed & 0xFF) / 255.0;
  } else if (hex.length == 8) {
    a = ((parsed >> 24) & 0xFF) / 255.0;
    r = ((parsed >> 16) & 0xFF) / 255.0;
    g = ((parsed >> 8) & 0xFF) / 255.0;
    b = (parsed & 0xFF) / 255.0;
  } else {
    return nil;
  }
  return [UIColor colorWithRed:r green:g blue:b alpha:a];
}

@end
