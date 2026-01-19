#import "ZynthPressableView.h"

#import <QuartzCore/QuartzCore.h>
#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthKit.h"
#import "ZynthComponentAPI.h"
#import "SNUIManager.h"
#import "SNNode.h"
#endif

static const CFTimeInterval kZynthPressableDefaultLongPressMs = 500.0;
static const CGFloat kZynthPressableDefaultRetention = 20.0;
static const CFTimeInterval kZynthPressableDefaultDoublePressWindowMs = 250.0;

@interface ZynthPressableView ()
@property(nonatomic, weak, nullable) SNUIManager *manager;
@property(nonatomic, weak, nullable) SNNode *node;
@property(nonatomic, assign) BOOL disabled;
@property(nonatomic, assign) BOOL pressed;
@property(nonatomic, assign) BOOL longPressFired;
@property(nonatomic, assign) BOOL preventFocusOnPress;
@property(nonatomic, assign) CGFloat pressRetentionOffset;
@property(nonatomic, assign) UIEdgeInsets hitSlopInsets;
@property(nonatomic, strong, nullable) NSTimer *pressInTimer;
@property(nonatomic, strong, nullable) NSTimer *pressOutTimer;
@property(nonatomic, strong, nullable) NSTimer *longPressTimer;
@property(nonatomic, assign) CFTimeInterval pressStartTimestamp;
@property(nonatomic, assign) CGPoint initialTouchPoint;
@property(nonatomic, strong, nullable) UITouch *lastTouch;
@property(nonatomic, assign) NSInteger lastCommandSeq;
@property(nonatomic, copy) NSString *pressEffect;
@property(nonatomic, assign) BOOL hasLongPressHandler;
@property(nonatomic, assign) BOOL allowTouchPropagation;
@property(nonatomic, assign) BOOL cancelOnOutside;
@property(nonatomic, assign) BOOL enableDoublePress;
@property(nonatomic, assign) CFTimeInterval doublePressWindowMs;
@property(nonatomic, assign) CFTimeInterval lastPressTimestampMs;
@property(nonatomic, copy) NSArray<NSString *> *activateKeys;
@property(nonatomic, assign) BOOL focusable;
@property(nonatomic, copy) NSString *pointerEvents;
@property(nonatomic, assign) CFTimeInterval delayPressInMs;
@property(nonatomic, assign) CFTimeInterval delayPressOutMs;
@property(nonatomic, assign) CFTimeInterval delayLongPressMs;
@end

@implementation ZynthPressableView

- (instancetype)init {
  return [self initWithFrame:CGRectZero];
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _pressRetentionOffset = kZynthPressableDefaultRetention;
    _hitSlopInsets = UIEdgeInsetsZero;
    _pressEffect = @"none";
    _doublePressWindowMs = kZynthPressableDefaultDoublePressWindowMs;
    _lastCommandSeq = -1;
    _delayPressInMs = 0;
    _delayPressOutMs = 0;
    _delayLongPressMs = kZynthPressableDefaultLongPressMs;
    _allowTouchPropagation = NO;
    _cancelOnOutside = YES;
    _enableDoublePress = NO;
    _activateKeys = @[];
    _focusable = YES;
    _pointerEvents = @"auto";
    _lastPressTimestampMs = -1;

    self.exclusiveTouch = YES;
    self.multipleTouchEnabled = NO;
    self.layer.opacity = 1.0;
  }
  return self;
}

- (SNNode *)zynth_node {
  return self.node;
}

- (void)dealloc {
  [self.pressInTimer invalidate];
  [self.pressOutTimer invalidate];
  [self.longPressTimer invalidate];
}

- (BOOL)canBecomeFirstResponder {
  return self.focusable;
}

- (void)attachToManager:(SNUIManager *)manager node:(SNNode *)node {
  self.manager = manager;
  self.node = node;
  self.nodeId = node ? node.nid : -1;
}

- (BOOL)shouldHandleTouch {
  if (self.disabled) return NO;
  if ([self.pointerEvents isEqualToString:@"none"]) return NO;
  return self.userInteractionEnabled;
}

- (void)updateInteractivity {
  BOOL enabled = !self.disabled && ![self.pointerEvents isEqualToString:@"none"];
  self.userInteractionEnabled = enabled;
  self.alpha = enabled ? 1.0 : 0.5;
}

- (BOOL)becomeFirstResponder {
  if (!self.focusable) return NO;
  BOOL result = [super becomeFirstResponder];
  if (result && [self.delegate respondsToSelector:@selector(pressableViewDidFocus:)]) {
    [self.delegate pressableViewDidFocus:self];
  }
  return result;
}

- (BOOL)resignFirstResponder {
  BOOL result = [super resignFirstResponder];
  if (result && [self.delegate respondsToSelector:@selector(pressableViewDidBlur:)]) {
    [self.delegate pressableViewDidBlur:self];
  }
  return result;
}

- (void)updateHighlightAnimated:(BOOL)animated {
  if (![self.pressEffect isEqualToString:@"highlight"]) {
    return;
  }
  CGFloat target = self.pressed ? 0.85f : 1.0f;
  if (animated) {
    [CATransaction begin];
    [CATransaction setAnimationDuration:0.12];
    self.layer.opacity = target;
    [CATransaction commit];
  } else {
    self.layer.opacity = target;
  }
}

- (void)zynth_setDisabled:(BOOL)disabled {
  self.disabled = disabled;
  [self updateInteractivity];
}

- (void)zynth_setPressEffect:(NSString *)effect {
  self.pressEffect = effect.length ? effect.lowercaseString : @"none";
  [self updateHighlightAnimated:NO];
}

- (void)zynth_setPressRetentionOffset:(NSNumber *)offset {
  self.pressRetentionOffset = offset ? offset.doubleValue : kZynthPressableDefaultRetention;
}

- (void)zynth_setHitSlop:(id)hitSlop {
  if ([hitSlop isKindOfClass:[NSDictionary class]]) {
    NSDictionary *dict = (NSDictionary *)hitSlop;
    CGFloat top = [dict[@"top"] doubleValue];
    CGFloat left = [dict[@"left"] doubleValue];
    CGFloat bottom = [dict[@"bottom"] doubleValue];
    CGFloat right = [dict[@"right"] doubleValue];
    self.hitSlopInsets = UIEdgeInsetsMake(top, left, bottom, right);
  } else if ([hitSlop isKindOfClass:[NSNumber class]]) {
    CGFloat inset = [(NSNumber *)hitSlop doubleValue];
    self.hitSlopInsets = UIEdgeInsetsMake(inset, inset, inset, inset);
  } else {
    self.hitSlopInsets = UIEdgeInsetsZero;
  }
}

- (void)zynth_setPreventFocusOnPress:(BOOL)prevent {
  self.preventFocusOnPress = prevent;
}

- (void)zynth_setDelayPressIn:(NSNumber *)delay {
  self.delayPressInMs = delay ? delay.doubleValue : 0;
}

- (void)zynth_setDelayPressOut:(NSNumber *)delay {
  self.delayPressOutMs = delay ? delay.doubleValue : 0;
}

- (void)zynth_setDelayLongPress:(NSNumber *)delay {
  self.delayLongPressMs = delay ? delay.doubleValue : kZynthPressableDefaultLongPressMs;
}

- (void)zynth_setAllowTouchPropagation:(BOOL)allow {
  self.allowTouchPropagation = allow;
  self.exclusiveTouch = !allow;
}

- (void)zynth_setCancelOnOutside:(BOOL)cancel {
  self.cancelOnOutside = cancel;
}

- (void)zynth_setEnableDoublePress:(BOOL)enable {
  self.enableDoublePress = enable;
}

- (void)zynth_setDoublePressWindow:(NSNumber *)window {
  self.doublePressWindowMs = window ? MAX(0.0, window.doubleValue) : kZynthPressableDefaultDoublePressWindowMs;
}

- (void)zynth_setActivateKeys:(NSArray<NSString *> *)keys {
  NSMutableArray<NSString *> *normalized = [NSMutableArray arrayWithCapacity:keys.count];
  for (NSString *key in keys) {
    if (![key isKindOfClass:[NSString class]]) continue;
    [normalized addObject:key.uppercaseString];
  }
  self.activateKeys = normalized;
}

- (void)zynth_setFocusable:(BOOL)focusable {
  self.focusable = focusable;
  if (!focusable && [self isFirstResponder]) {
    [self resignFirstResponder];
  }
}

- (void)zynth_setPointerEvents:(NSString *)pointerEvents {
  self.pointerEvents = pointerEvents ?: @"auto";
  [self updateInteractivity];
}

- (void)zynth_setHasLongPressHandler:(BOOL)hasHandler {
  self.hasLongPressHandler = hasHandler;
}

- (void)invalidateTimer:(NSTimer *)timer {
  [timer invalidate];
}

- (void)cancelPressInTimer {
  if (self.pressInTimer) {
    [self invalidateTimer:self.pressInTimer];
    self.pressInTimer = nil;
  }
}

- (void)cancelPressOutTimer {
  if (self.pressOutTimer) {
    [self invalidateTimer:self.pressOutTimer];
    self.pressOutTimer = nil;
  }
}

- (void)cancelLongPressTimer {
  if (self.longPressTimer) {
    [self invalidateTimer:self.longPressTimer];
    self.longPressTimer = nil;
  }
}

- (NSDictionary *)payloadForTouch:(UITouch *)touch {
  UITouch *reference = touch ?: self.lastTouch;
  if (!reference) {
    CFTimeInterval now = CACurrentMediaTime() * 1000.0;
    return @{ @"x" : @0, @"y" : @0, @"screenX" : @0, @"screenY" : @0, @"timestamp" : @(now), @"pointerType" : @"touch" };
  }
  CGPoint point = [reference locationInView:self];
  CGPoint windowPoint = [reference locationInView:self.window];
  CFTimeInterval timestampMs = reference.timestamp * 1000.0;
  NSString *pointerType = @"touch";
#if __IPHONE_OS_VERSION_MAX_ALLOWED >= 130000
  if (@available(iOS 13.4, *)) {
    switch (reference.type) {
      case UITouchTypeIndirectPointer:
        pointerType = @"mouse";
        break;
      case UITouchTypeStylus:
        pointerType = @"pen";
        break;
      default:
        pointerType = @"touch";
        break;
    }
  }
#endif
  return @{ @"x" : @(point.x),
            @"y" : @(point.y),
            @"screenX" : @(windowPoint.x),
            @"screenY" : @(windowPoint.y),
            @"timestamp" : @(timestampMs),
            @"pointerType" : pointerType };
}

- (void)firePressIn {
  if (!self.pressed) return;
  NSDictionary *payload = [self payloadForTouch:self.lastTouch];
  if ([self.delegate respondsToSelector:@selector(pressableView:didPressIn:)]) {
    [self.delegate pressableView:self didPressIn:payload];
  }
  [self updateHighlightAnimated:YES];
  [self zynth_setGlassPressed:YES animated:YES];
}

- (void)firePressOutWithCancelled:(BOOL)cancelled {
  NSDictionary *payload = [self payloadForTouch:self.lastTouch];
  if ([self.delegate respondsToSelector:@selector(pressableView:didPressOut:cancelled:)]) {
    [self.delegate pressableView:self didPressOut:payload cancelled:cancelled];
  }
  [self updateHighlightAnimated:YES];
  [self zynth_setGlassPressed:NO animated:YES];
}

- (void)schedulePressIn {
  [self cancelPressInTimer];
  if (self.delayPressInMs <= 0) {
    [self firePressIn];
    return;
  }
  __weak typeof(self) weakSelf = self;
  self.pressInTimer = [NSTimer scheduledTimerWithTimeInterval:self.delayPressInMs / 1000.0
                                                        repeats:NO
                                                          block:^(NSTimer *_Nonnull timer) {
                                                            __strong typeof(weakSelf) strongSelf = weakSelf;
                                                            [strongSelf firePressIn];
                                                          }];
}

- (void)schedulePressOutWithCancelled:(BOOL)cancelled {
  [self cancelPressOutTimer];
  __weak typeof(self) weakSelf = self;
  CFTimeInterval delaySeconds = self.delayPressOutMs / 1000.0;
  self.pressOutTimer = [NSTimer scheduledTimerWithTimeInterval:delaySeconds
                                                        repeats:NO
                                                          block:^(NSTimer *_Nonnull timer) {
                                                            __strong typeof(weakSelf) strongSelf = weakSelf;
                                                            [strongSelf firePressOutWithCancelled:cancelled];
                                                          }];
}

- (void)scheduleLongPress {
  [self cancelLongPressTimer];
  if (!self.hasLongPressHandler || self.delayLongPressMs <= 0) return;
  __weak typeof(self) weakSelf = self;
  CFTimeInterval delaySeconds = self.delayLongPressMs / 1000.0;
  self.longPressTimer = [NSTimer scheduledTimerWithTimeInterval:delaySeconds
                                                         repeats:NO
                                                           block:^(NSTimer *_Nonnull timer) {
                                                             __strong typeof(weakSelf) strongSelf = weakSelf;
                                                             if (!strongSelf || !strongSelf.pressed) return;
                                                             strongSelf.longPressFired = YES;
                                                             NSDictionary *payload = [strongSelf payloadForTouch:strongSelf.lastTouch];
                                                             if ([strongSelf.delegate respondsToSelector:@selector(pressableView:didLongPress:duration:)]) {
                                                               [strongSelf.delegate pressableView:strongSelf didLongPress:payload duration:strongSelf.delayLongPressMs];
                                                             }
                                                           }];
}

- (void)beginPressWithTouch:(UITouch *)touch {
  self.pressed = YES;
  self.longPressFired = NO;
  self.pressStartTimestamp = CACurrentMediaTime() * 1000.0;
  self.initialTouchPoint = [touch locationInView:self];
  self.lastTouch = touch;
  if (!self.preventFocusOnPress && self.focusable) {
    [self becomeFirstResponder];
  }
  [self schedulePressIn];
  [self scheduleLongPress];
}

- (void)endPressWithTouch:(UITouch *)touch cancelled:(BOOL)cancelled {
  self.lastTouch = touch ?: self.lastTouch;
  [self cancelPressInTimer];
  [self cancelLongPressTimer];
  BOOL wasLongPress = self.longPressFired;
  self.longPressFired = NO;
  self.pressed = NO;
  if (!wasLongPress) {
    NSDictionary *payload = [self payloadForTouch:self.lastTouch];
    if ([self.delegate respondsToSelector:@selector(pressableView:didPress:)]) {
      [self.delegate pressableView:self didPress:payload];
    }
    if (self.enableDoublePress) {
      CFTimeInterval now = CACurrentMediaTime() * 1000.0;
      if (self.lastPressTimestampMs > 0 && (now - self.lastPressTimestampMs) <= self.doublePressWindowMs) {
        if ([self.delegate respondsToSelector:@selector(pressableView:didDoublePress:)]) {
          [self.delegate pressableView:self didDoublePress:payload];
        }
      }
      self.lastPressTimestampMs = now;
    }
  }
  [self schedulePressOutWithCancelled:cancelled];
}

- (void)cancelCurrentPress:(BOOL)cancelled {
  if (!self.pressed) return;
  [self endPressWithTouch:nil cancelled:cancelled];
}

- (void)touchesBegan:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
  [super touchesBegan:touches withEvent:event];
  if (![self shouldHandleTouch]) return;
  UITouch *touch = touches.anyObject;
  if (!touch) return;
  [self beginPressWithTouch:touch];
}

- (void)touchesMoved:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
  [super touchesMoved:touches withEvent:event];
  if (!self.pressed) return;
  UITouch *touch = touches.anyObject;
  if (!touch) return;
  self.lastTouch = touch;
  if (!self.cancelOnOutside || self.pressRetentionOffset <= 0) return;
  CGPoint point = [touch locationInView:self];
  CGFloat dx = point.x - self.initialTouchPoint.x;
  CGFloat dy = point.y - self.initialTouchPoint.y;
  CGFloat distance = hypot(dx, dy);
  if (distance > self.pressRetentionOffset) {
    [self cancelCurrentPress:YES];
  }
}

- (void)touchesEnded:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
  [super touchesEnded:touches withEvent:event];
  if (!self.pressed) return;
  UITouch *touch = touches.anyObject;
  [self endPressWithTouch:touch cancelled:NO];
}

- (void)touchesCancelled:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
  [super touchesCancelled:touches withEvent:event];
  [self cancelCurrentPress:YES];
}

- (BOOL)pointInside:(CGPoint)point withEvent:(UIEvent *)event {
  CGRect bounds = self.bounds;
  CGRect expanded = CGRectInset(bounds, -self.hitSlopInsets.left, -self.hitSlopInsets.top);
  expanded.size.width += self.hitSlopInsets.left + self.hitSlopInsets.right;
  expanded.size.height += self.hitSlopInsets.top + self.hitSlopInsets.bottom;
  expanded.origin.x -= self.hitSlopInsets.left;
  expanded.origin.y -= self.hitSlopInsets.top;
  return CGRectContainsPoint(expanded, point);
}

- (void)pressesBegan:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
  [super pressesBegan:presses withEvent:event];
  for (UIPress *press in presses) {
    UIKey *key = press.key;
    if (!key) continue;
    NSString *characters = key.charactersIgnoringModifiers ?: key.characters;
    NSString *identifier = characters.uppercaseString;
    NSDictionary *payload = characters.length ? @{ @"key" : characters } : @{};
    if ([self.delegate respondsToSelector:@selector(pressableView:didEmitKeyEvent:payload:)]) {
      [self.delegate pressableView:self didEmitKeyEvent:@"onKeyDown" payload:payload];
    }
    if (![self.activateKeys containsObject:identifier]) {
      continue;
    }
    if (!self.pressed) {
      self.pressed = YES;
      self.lastTouch = nil;
      [self updateHighlightAnimated:YES];
      [self zynth_setGlassPressed:YES animated:YES];
      if ([self.delegate respondsToSelector:@selector(pressableView:didPressIn:)]) {
        [self.delegate pressableView:self didPressIn:@{ @"pointerType" : @"keyboard" }];
      }
    }
  }
}

- (void)pressesEnded:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
  [super pressesEnded:presses withEvent:event];
  for (UIPress *press in presses) {
    UIKey *key = press.key;
    if (!key) continue;
    NSString *characters = key.charactersIgnoringModifiers ?: key.characters;
    NSString *identifier = characters.uppercaseString;
    NSDictionary *payload = characters.length ? @{ @"key" : characters } : @{};
    if ([self.delegate respondsToSelector:@selector(pressableView:didEmitKeyEvent:payload:)]) {
      [self.delegate pressableView:self didEmitKeyEvent:@"onKeyUp" payload:payload];
    }
    if (![self.activateKeys containsObject:identifier]) {
      continue;
    }
    if (self.pressed) {
      self.pressed = NO;
      [self zynth_setGlassPressed:NO animated:YES];
      if ([self.delegate respondsToSelector:@selector(pressableView:didPress:)]) {
        [self.delegate pressableView:self didPress:@{ @"pointerType" : @"keyboard" }];
      }
      if ([self.delegate respondsToSelector:@selector(pressableView:didPressOut:cancelled:)]) {
        [self.delegate pressableView:self didPressOut:@{ @"pointerType" : @"keyboard" } cancelled:NO];
      }
      [self updateHighlightAnimated:YES];
    }
  }
}

- (void)pressesCancelled:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
  [super pressesCancelled:presses withEvent:event];
  for (UIPress *press in presses) {
    UIKey *key = press.key;
    NSString *characters = key ? (key.charactersIgnoringModifiers ?: key.characters) : nil;
    if (characters.length && [self.delegate respondsToSelector:@selector(pressableView:didEmitKeyEvent:payload:)]) {
      [self.delegate pressableView:self didEmitKeyEvent:@"onKeyUp" payload:@{ @"key" : characters }];
    }
  }
  if (self.pressed) {
    self.pressed = NO;
    [self zynth_setGlassPressed:NO animated:YES];
    if ([self.delegate respondsToSelector:@selector(pressableView:didPressOut:cancelled:)]) {
      [self.delegate pressableView:self didPressOut:@{ @"pointerType" : @"keyboard" } cancelled:YES];
    }
    [self updateHighlightAnimated:YES];
  }
}

- (void)zynth_handleCommand:(NSDictionary *)command {
  if (!command || ![command isKindOfClass:[NSDictionary class]]) return;
  NSInteger seq = [command[@"seq"] integerValue];
  if (seq >= 0 && seq <= self.lastCommandSeq) return;
  if (seq >= 0) self.lastCommandSeq = seq;
  NSString *type = command[@"type"];
  if ([type isEqualToString:@"focus"]) {
    if (!self.focusable) return;
    if (![self isFirstResponder]) {
      [self becomeFirstResponder];
    }
    return;
  }
  if ([type isEqualToString:@"blur"]) {
    if ([self isFirstResponder]) {
      [self resignFirstResponder];
    }
    return;
  }
  if ([type isEqualToString:@"click"]) {
    if (self.disabled) return;
    NSDictionary *payload = @{ @"pointerType" : @"programmatic" };
    if ([self.delegate respondsToSelector:@selector(pressableView:didPressIn:)]) {
      [self.delegate pressableView:self didPressIn:payload];
    }
    if ([self.delegate respondsToSelector:@selector(pressableView:didPress:)]) {
      [self.delegate pressableView:self didPress:payload];
    }
    if ([self.delegate respondsToSelector:@selector(pressableView:didPressOut:cancelled:)]) {
      [self.delegate pressableView:self didPressOut:payload cancelled:NO];
    }
    return;
  }
  if ([type isEqualToString:@"cancel"]) {
    [self cancelCurrentPress:YES];
    if ([self isFirstResponder]) {
      [self resignFirstResponder];
    }
  }
}

@end
