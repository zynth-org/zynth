#import "RuneButtonView.h"

#import <QuartzCore/QuartzCore.h>

#import "SNUIManager+Internal.h"

static const CFTimeInterval kRuneButtonLongPressDuration = 0.5;

@interface RuneButtonView ()
@property(nonatomic, weak, nullable) SNUIManager *manager;
@property(nonatomic, weak, nullable) SNNode *node;
@property(nonatomic, assign) BOOL runeDisabled;
@property(nonatomic, assign) BOOL runeLoading;
@property(nonatomic, assign) BOOL pressed;
@property(nonatomic, assign) BOOL longPressFired;
@property(nonatomic, assign) BOOL preventFocusOnPress;
@property(nonatomic, assign) CGFloat pressRetentionOffset;
@property(nonatomic, assign) UIEdgeInsets hitSlopInsets;
@property(nonatomic, assign) CGSize minimumTouchSize;
@property(nonatomic, strong, nullable) NSTimer *longPressTimer;
@property(nonatomic, assign) CFTimeInterval pressStartTimestamp;
@property(nonatomic, assign) CGPoint initialTouchPoint;
@property(nonatomic, assign) NSInteger lastCommandSeq;
@property(nonatomic, copy) NSString *pressEffect;
@property(nonatomic, copy) NSString *hapticsMode;
@property(nonatomic, assign) BOOL hasLongPressHandler;
@property(nonatomic, assign) BOOL isHighlightActive;
@end

@implementation RuneButtonView

- (instancetype)init {
  return [self initWithFrame:CGRectZero];
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _pressRetentionOffset = 14.0;
    _hitSlopInsets = UIEdgeInsetsZero;
    _minimumTouchSize = CGSizeMake(44.0, 44.0);
    _pressEffect = @"highlight";
    _hapticsMode = @"none";
    _lastCommandSeq = -1;
    self.exclusiveTouch = YES;
    self.multipleTouchEnabled = NO;
    self.layer.opacity = 1.0;
  }
  return self;
}

- (void)dealloc {
  [self.longPressTimer invalidate];
}

- (BOOL)canBecomeFirstResponder {
  return YES;
}

- (void)attachToManager:(SNUIManager *)manager node:(SNNode *)node {
  self.manager = manager;
  self.node = node;
  self.nodeId = node ? node.nid : -1;
}

- (BOOL)shouldHandleTouch {
  if (self.runeDisabled || self.runeLoading) return NO;
  return self.userInteractionEnabled;
}

- (void)startLongPressTimer {
  if (!self.hasLongPressHandler) return;
  [self.longPressTimer invalidate];
  self.pressStartTimestamp = CACurrentMediaTime();
  self.longPressFired = NO;
  self.longPressTimer =
      [NSTimer scheduledTimerWithTimeInterval:kRuneButtonLongPressDuration
                                       target:self
                                     selector:@selector(handleLongPressTimer)
                                     userInfo:nil
                                      repeats:NO];
}

- (void)cancelLongPressTimer {
  [self.longPressTimer invalidate];
  self.longPressTimer = nil;
}

- (void)handleLongPressTimer {
  self.longPressFired = YES;
  [self cancelLongPressTimer];
  if (![self shouldHandleTouch]) return;
  CFTimeInterval duration = CACurrentMediaTime() - self.pressStartTimestamp;
  if (duration < kRuneButtonLongPressDuration) {
    duration = kRuneButtonLongPressDuration;
  }
  if (self.delegate && [self.delegate respondsToSelector:@selector(buttonView:didLongPressWithDuration:)]) {
    [self.delegate buttonView:self didLongPressWithDuration:duration * 1000.0];
  }
}

- (void)updateInteractivity {
  BOOL enabled = !(self.runeDisabled || self.runeLoading);
  self.userInteractionEnabled = enabled;
  self.alpha = enabled ? 1.0 : 0.5;
}

- (void)setHighlightActive:(BOOL)active animated:(BOOL)animated {
  if (self.isHighlightActive == active) return;
  self.isHighlightActive = active;
  if ([self.pressEffect.lowercaseString isEqualToString:@"none"]) return;
  float target = active ? 0.85f : 1.0f;
  if (animated) {
    [CATransaction begin];
    [CATransaction setAnimationDuration:0.12];
    self.layer.opacity = target;
    [CATransaction commit];
  } else {
    self.layer.opacity = target;
  }
}

- (void)triggerHapticsIfNeeded {
#if __has_include(<UIKit/UIKit.h>)
  if (!self.hapticsMode || [self.hapticsMode isEqualToString:@"none"]) return;
  NSString *mode = self.hapticsMode.lowercaseString;
  if ([mode isEqualToString:@"light"]) {
    UIImpactFeedbackGenerator *generator = [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleLight];
    [generator impactOccurred];
  } else if ([mode isEqualToString:@"medium"]) {
    UIImpactFeedbackGenerator *generator = [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleMedium];
    [generator impactOccurred];
  } else if ([mode isEqualToString:@"heavy"]) {
    UIImpactFeedbackGenerator *generator = [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleHeavy];
    [generator impactOccurred];
  } else if ([mode isEqualToString:@"success"]) {
    UINotificationFeedbackGenerator *generator = [[UINotificationFeedbackGenerator alloc] init];
    [generator notificationOccurred:UINotificationFeedbackTypeSuccess];
  } else if ([mode isEqualToString:@"warning"]) {
    UINotificationFeedbackGenerator *generator = [[UINotificationFeedbackGenerator alloc] init];
    [generator notificationOccurred:UINotificationFeedbackTypeWarning];
  } else if ([mode isEqualToString:@"error"]) {
    UINotificationFeedbackGenerator *generator = [[UINotificationFeedbackGenerator alloc] init];
    [generator notificationOccurred:UINotificationFeedbackTypeError];
  }
#endif
}

- (void)notifyPressIn {
  if (self.delegate && [self.delegate respondsToSelector:@selector(buttonViewDidPressIn:)]) {
    [self.delegate buttonViewDidPressIn:self];
  }
}

- (void)notifyPressOutWithCancel:(BOOL)cancelled {
  if (self.delegate && [self.delegate respondsToSelector:@selector(buttonViewDidPressOut:cancelled:)]) {
    [self.delegate buttonViewDidPressOut:self cancelled:cancelled];
  }
}

- (void)notifyActivate {
  if (self.delegate && [self.delegate respondsToSelector:@selector(buttonViewDidActivate:)]) {
    [self.delegate buttonViewDidActivate:self];
  }
}

- (void)touchesBegan:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
  [super touchesBegan:touches withEvent:event];
  if (![self shouldHandleTouch]) return;
  UITouch *touch = touches.anyObject;
  if (!touch) return;
  self.initialTouchPoint = [touch locationInView:self];
  self.pressed = YES;
  self.pressStartTimestamp = CACurrentMediaTime();
  if (!self.preventFocusOnPress) {
    [self becomeFirstResponder];
  }
  [self setHighlightActive:YES animated:YES];
  [self notifyPressIn];
  [self startLongPressTimer];
}

- (void)touchesMoved:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
  [super touchesMoved:touches withEvent:event];
  if (!self.pressed) return;
  UITouch *touch = touches.anyObject;
  if (!touch) return;
  if (self.pressRetentionOffset <= 0) return;
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
  [self cancelLongPressTimer];
  [self setHighlightActive:NO animated:YES];
  BOOL longPressTriggered = self.longPressFired;
  self.longPressFired = NO;
  self.pressed = NO;
  if (!longPressTriggered) {
    [self triggerHapticsIfNeeded];
    [self notifyActivate];
  }
  [self notifyPressOutWithCancel:NO];
}

- (void)touchesCancelled:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
  [super touchesCancelled:touches withEvent:event];
  if (!self.pressed) return;
  [self cancelCurrentPress:YES];
}

- (void)cancelCurrentPress:(BOOL)cancelled {
  [self cancelLongPressTimer];
  if (!self.pressed) return;
  self.pressed = NO;
  self.longPressFired = NO;
  [self setHighlightActive:NO animated:YES];
  [self notifyPressOutWithCancel:cancelled];
}

- (BOOL)pointInside:(CGPoint)point withEvent:(UIEvent *)event {
  CGRect bounds = self.bounds;
  if (bounds.size.width < self.minimumTouchSize.width) {
    CGFloat inset = (self.minimumTouchSize.width - bounds.size.width) / 2.0;
    bounds = CGRectInset(bounds, -inset, 0);
  }
  if (bounds.size.height < self.minimumTouchSize.height) {
    CGFloat inset = (self.minimumTouchSize.height - bounds.size.height) / 2.0;
    bounds = CGRectInset(bounds, 0, -inset);
  }
  bounds.origin.x -= self.hitSlopInsets.left;
  bounds.origin.y -= self.hitSlopInsets.top;
  bounds.size.width += (self.hitSlopInsets.left + self.hitSlopInsets.right);
  bounds.size.height += (self.hitSlopInsets.top + self.hitSlopInsets.bottom);
  return CGRectContainsPoint(bounds, point);
}

- (BOOL)becomeFirstResponder {
  BOOL result = [super becomeFirstResponder];
  if (result && self.delegate && [self.delegate respondsToSelector:@selector(buttonViewDidFocus:)]) {
    [self.delegate buttonViewDidFocus:self];
  }
  return result;
}

- (BOOL)resignFirstResponder {
  BOOL result = [super resignFirstResponder];
  if (result && self.delegate && [self.delegate respondsToSelector:@selector(buttonViewDidBlur:)]) {
    [self.delegate buttonViewDidBlur:self];
  }
  return result;
}

- (void)pressesBegan:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
  [super pressesBegan:presses withEvent:event];
  for (UIPress *press in presses) {
    if (!press.key) continue;
    NSString *key = press.key.charactersIgnoringModifiers ?: press.key.characters ?: @"";
    if (self.delegate && [self.delegate respondsToSelector:@selector(buttonView:didEmitKeyEvent:key:)]) {
      [self.delegate buttonView:self didEmitKeyEvent:@"onKeyDown" key:key];
    }
  }
}

- (void)pressesEnded:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
  [super pressesEnded:presses withEvent:event];
  for (UIPress *press in presses) {
    if (!press.key) continue;
    NSString *key = press.key.charactersIgnoringModifiers ?: press.key.characters ?: @"";
    if (self.delegate && [self.delegate respondsToSelector:@selector(buttonView:didEmitKeyEvent:key:)]) {
      [self.delegate buttonView:self didEmitKeyEvent:@"onKeyUp" key:key];
    }
  }
}

- (void)performProgrammaticActivation {
  if (![self shouldHandleTouch]) return;
  [self setHighlightActive:YES animated:NO];
  [self notifyPressIn];
  [self triggerHapticsIfNeeded];
  [self notifyActivate];
  [self notifyPressOutWithCancel:NO];
  [self setHighlightActive:NO animated:YES];
}

- (void)rune_setDisabled:(BOOL)disabled {
  self.runeDisabled = disabled;
  [self updateInteractivity];
}

- (void)rune_setLoading:(BOOL)loading {
  self.runeLoading = loading;
  [self updateInteractivity];
}

- (void)rune_setPressEffect:(NSString *)effect {
  self.pressEffect = effect ?: @"highlight";
}

- (void)rune_setPressRetentionOffset:(NSNumber *)offset {
  if (!offset || [offset isKindOfClass:[NSNull class]]) return;
  self.pressRetentionOffset = MAX(0.0, offset.doubleValue);
}

- (void)rune_setHitSlop:(id)hitSlop {
  if (!hitSlop || [hitSlop isKindOfClass:[NSNull class]]) {
    self.hitSlopInsets = UIEdgeInsetsZero;
    return;
  }
  if ([hitSlop isKindOfClass:[NSNumber class]]) {
    CGFloat inset = ((NSNumber *)hitSlop).doubleValue;
    self.hitSlopInsets = UIEdgeInsetsMake(inset, inset, inset, inset);
    return;
  }
  if ([hitSlop isKindOfClass:[NSDictionary class]]) {
    NSDictionary *dict = (NSDictionary *)hitSlop;
    CGFloat top = [dict[@"top"] respondsToSelector:@selector(doubleValue)] ? [dict[@"top"] doubleValue] : 0.0;
    CGFloat left = [dict[@"left"] respondsToSelector:@selector(doubleValue)] ? [dict[@"left"] doubleValue] : 0.0;
    CGFloat bottom = [dict[@"bottom"] respondsToSelector:@selector(doubleValue)] ? [dict[@"bottom"] doubleValue] : 0.0;
    CGFloat right = [dict[@"right"] respondsToSelector:@selector(doubleValue)] ? [dict[@"right"] doubleValue] : 0.0;
    self.hitSlopInsets = UIEdgeInsetsMake(top, left, bottom, right);
    return;
  }
}

- (void)rune_setMinimumTouchSize:(id)sizeValue {
  if (!sizeValue || [sizeValue isKindOfClass:[NSNull class]]) {
    self.minimumTouchSize = CGSizeMake(44.0, 44.0);
    return;
  }
  if ([sizeValue isKindOfClass:[NSDictionary class]]) {
    NSDictionary *dict = (NSDictionary *)sizeValue;
    CGFloat width = [dict[@"width"] respondsToSelector:@selector(doubleValue)] ? [dict[@"width"] doubleValue] : 44.0;
    CGFloat height = [dict[@"height"] respondsToSelector:@selector(doubleValue)] ? [dict[@"height"] doubleValue] : 44.0;
    self.minimumTouchSize = CGSizeMake(MAX(0.0, width), MAX(0.0, height));
    return;
  }
  self.minimumTouchSize = CGSizeMake(44.0, 44.0);
}

- (void)rune_setPreventFocusOnPress:(BOOL)prevent {
  self.preventFocusOnPress = prevent;
}

- (void)rune_setHapticsMode:(NSString *)mode {
  if (!mode || [mode isKindOfClass:[NSNull class]]) {
    self.hapticsMode = @"none";
    return;
  }
  self.hapticsMode = mode;
}

- (void)rune_setHasLongPressHandler:(BOOL)hasHandler {
  self.hasLongPressHandler = hasHandler;
}

- (void)rune_handleCommand:(NSDictionary *)command {
  if (![command isKindOfClass:[NSDictionary class]]) return;
  NSNumber *seq = command[@"seq"];
  if (seq && [seq respondsToSelector:@selector(integerValue)]) {
    NSInteger nextSeq = seq.integerValue;
    if (nextSeq <= self.lastCommandSeq) {
      return;
    }
    self.lastCommandSeq = nextSeq;
  }

  NSString *type = command[@"type"];
  if (![type isKindOfClass:[NSString class]]) return;

  if ([type isEqualToString:@"focus"]) {
    [self becomeFirstResponder];
    return;
  }
  if ([type isEqualToString:@"blur"]) {
    if (self.isFirstResponder) {
      [self resignFirstResponder];
    }
    return;
  }
  if ([type isEqualToString:@"click"]) {
    [self setHighlightActive:YES animated:NO];
    [self notifyPressIn];
    [self triggerHapticsIfNeeded];
    [self notifyActivate];
    [self notifyPressOutWithCancel:NO];
    [self setHighlightActive:NO animated:YES];
    return;
  }
}

@end
