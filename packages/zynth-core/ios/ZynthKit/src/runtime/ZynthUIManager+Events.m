#import "ZynthUIBindings.h"
#import "ZynthUIManager+Private.h"
#import "ZynthUIManager+Events.h"

@implementation ZynthUIManager (Events)

static inline void *ZynthRuntimePtrForManager(ZynthUIManager *manager) {
  return ZynthUIRuntimeForManager(manager);
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
    void *runtimePtr = ZynthRuntimePtrForManager(self);
    ZynthUIInvokePressEventWithRuntime(runtimePtr,
                                       nodeId,
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
      void *runtimePtr = ZynthRuntimePtrForManager(self);
      ZynthUIInvokePressEventWithRuntime(runtimePtr,
                                         nodeId,
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
    void *runtimePtr = ZynthRuntimePtrForManager(self);
    ZynthUIInvokePressEventWithRuntime(runtimePtr,
                                       nodeId,
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
    void *runtimePtr = ZynthRuntimePtrForManager(self);
    ZynthUIInvokePressEventWithRuntime(runtimePtr,
                                       nodeId,
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
    void *runtimePtr = ZynthRuntimePtrForManager(self);
    ZynthUIInvokePressEventWithRuntime(runtimePtr,
                                       nodeId.intValue,
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
  void *runtimePtr = ZynthRuntimePtrForManager(self);
  ZynthUIInvokePressEventWithRuntime(runtimePtr,
                                     nodeId.intValue,
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
  NSArray *nodes = [_layoutNodes allObjects];
  for (NSNumber *nodeId in nodes) {
    if (![_layoutNodes containsObject:nodeId]) continue;
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
    void *runtimePtr = ZynthRuntimePtrForManager(self);
    ZynthUIInvokeLayoutEventWithRuntime(runtimePtr,
                                        nodeId.intValue,
                             frame.origin.x,
                             frame.origin.y,
                             frame.size.width,
                             frame.size.height);
  }
}

- (void)detachNode:(NSNumber *)nodeId {
  // Cancel active animations/timers but preserve node state
  dispatch_source_t timer = _longPressTimers[nodeId];
  if (timer) {
    dispatch_source_cancel(timer);
    [_longPressTimers removeObjectForKey:nodeId];
  }
  [_nodeSurfaces removeObjectForKey:nodeId];
}

- (void)destroyNode:(NSNumber *)nodeId {
  [self detachNode:nodeId];
  
  ZynthNode *node = _nodeStates[nodeId];
  if (node) {
    ZynthComponentDescriptor *descriptor = ZynthGetComponentDescriptor(node.type);
    if (descriptor && descriptor.cleanup) {
      descriptor.cleanup((ZynthUIManager *)self, node);
    }
  }
  [_pointerEvents removeObjectForKey:nodeId];
  [_pressNodes removeObject:nodeId];
  [_longPressNodes removeObject:nodeId];
  [_doublePressNodes removeObject:nodeId];
  [_activePressNodes removeObject:nodeId];
  [_longPressFired removeObject:nodeId];
  [_longPressDurations removeObjectForKey:nodeId];
  [_doublePressWindows removeObjectForKey:nodeId];
  [_lastPressTimestamps removeObjectForKey:nodeId];
  [_pressLocalPoints removeObjectForKey:nodeId];
  [_pressScreenPoints removeObjectForKey:nodeId];
  [_layoutNodes removeObject:nodeId];
  [_layoutPending removeObject:nodeId];
  [_layoutFrames removeObjectForKey:nodeId];
  [_styleDirtyNodes removeObject:nodeId];
  [_styleStates removeObjectForKey:nodeId];
  [_styleLayoutFrames removeObjectForKey:nodeId];
  [_styleLayoutDirtyNodes removeObject:nodeId];
  [_textStyleStates removeObjectForKey:nodeId];
  [_yogaStyleCache removeObjectForKey:nodeId];
  
  UIView *view = _nodes[nodeId];
  if (view) {
    for (UIGestureRecognizer *recognizer in view.gestureRecognizers.copy) {
      if (![recognizer isKindOfClass:[UILongPressGestureRecognizer class]]) continue;
      if (![recognizer.name hasPrefix:@"zynth:press:"]) continue;
      [view removeGestureRecognizer:recognizer];
    }
  }
}

@end
