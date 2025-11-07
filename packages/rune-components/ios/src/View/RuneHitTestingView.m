#import "RuneHitTestingView.h"
#if __has_include("RuneComponents-Swift.h")
#import "RuneComponents-Swift.h"
#endif

@interface RuneHitTestingView ()
@property (nonatomic, assign) BOOL runeGlassEnabled;
@property (nonatomic, strong, nullable) UIView *glassEffectView;
@property (nonatomic, strong, nullable) UIColor *glassTintColor;
@end

@implementation RuneHitTestingView

- (instancetype)init {
  if (self = [super init]) {
    self.pointerMode = RunePointerEventsAuto;
  }
  return self;
}

- (void)layoutSubviews {
  [super layoutSubviews];
  if (self.glassEffectView) {
    self.glassEffectView.frame = self.bounds;
    [self sendSubviewToBack:self.glassEffectView];
    [self updateGlassMask];
  }
}

- (void)rune_setEnableGlassIOS:(BOOL)enabled {
  self.runeGlassEnabled = enabled;
  [self updateGlassEffectView];
}

- (void)rune_setGlassTintColor:(UIColor *)tintColor {
  self.glassTintColor = tintColor;
  [self updateGlassEffectView];
}

- (UIVisualEffect *)rune_createGlassEffect {
#if __IPHONE_OS_VERSION_MAX_ALLOWED >= 260000
  if (@available(iOS 26.0, *)) {
    UIGlassEffect *effect =
        [UIGlassEffect effectWithStyle:UIGlassEffectStyleRegular];
    effect.interactive = YES;
    effect.tintColor = self.glassTintColor;
    return effect;
  }
#endif
  return nil;
}

- (UIView *)rune_createGlassEffectView {
#if __IPHONE_OS_VERSION_MAX_ALLOWED >= 260000
  if (@available(iOS 26.0, *)) {
#if __has_include("RuneComponents-Swift.h")
    RuneGlassEffectHostingView *hostingView =
        [[RuneGlassEffectHostingView alloc] initWithFrame:self.bounds];
    hostingView.userInteractionEnabled = NO;
    hostingView.cornerRadius = self.layer.cornerRadius;
    hostingView.cornerStyle =
        (self.layer.cornerCurve == kCACornerCurveContinuous) ? @"continuous"
                                                             : @"circular";
    hostingView.glassType = @"regular";
    hostingView.interactive = YES;
    hostingView.glassTintColor = self.glassTintColor;
    return hostingView;
#endif
    UIVisualEffect *effect = [self rune_createGlassEffect];
    if (effect) {
      UIVisualEffectView *glassView =
          [[UIVisualEffectView alloc] initWithEffect:effect];
      glassView.userInteractionEnabled = NO;
      return glassView;
    }
  }
#endif
  return nil;
}

- (void)removeGlassEffectView {
  if (!self.glassEffectView) return;
  [self.glassEffectView removeFromSuperview];
  self.glassEffectView = nil;
}

- (void)updateGlassMask {
  if (!self.glassEffectView) return;
#if __has_include("RuneComponents-Swift.h")
  if ([self.glassEffectView isKindOfClass:[RuneGlassEffectHostingView class]]) {
    RuneGlassEffectHostingView *hostingView =
        (RuneGlassEffectHostingView *)self.glassEffectView;
    hostingView.cornerRadius = self.layer.cornerRadius;
    hostingView.cornerStyle =
        (self.layer.cornerCurve == kCACornerCurveContinuous) ? @"continuous"
                                                             : @"circular";
  }
#endif
  self.glassEffectView.layer.cornerRadius = self.layer.cornerRadius;
  self.glassEffectView.layer.maskedCorners = self.layer.maskedCorners;
  if (@available(iOS 13.0, *)) {
    self.glassEffectView.layer.cornerCurve = self.layer.cornerCurve;
  }
  BOOL shouldClip = self.layer.cornerRadius > 0.0;
  self.glassEffectView.clipsToBounds = shouldClip;
}

- (void)updateGlassEffectView {
  if (!self.runeGlassEnabled) {
    [self removeGlassEffectView];
    return;
  }

  if (!self.glassEffectView) {
    UIView *glassView = [self rune_createGlassEffectView];
    if (!glassView) {
      [self removeGlassEffectView];
      return;
    }
    glassView.frame = self.bounds;
    glassView.autoresizingMask =
        UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    [self insertSubview:glassView atIndex:0];
    self.glassEffectView = glassView;
    [self updateGlassMask];
    return;
  }

  if ([self.glassEffectView isKindOfClass:[UIVisualEffectView class]]) {
    UIVisualEffect *effect = [self rune_createGlassEffect];
    if (!effect) {
      [self removeGlassEffectView];
      return;
    }
    UIVisualEffectView *glassView =
        (UIVisualEffectView *)self.glassEffectView;
    glassView.effect = effect;
  } else {
    [self updateGlassMask];
  }
  [self sendSubviewToBack:self.glassEffectView];
  [self updateGlassMask];
}

- (void)rune_setGlassPressed:(BOOL)pressed animated:(BOOL)animated {
  if (!self.glassEffectView) return;
  CGFloat scale = pressed ? 1.05 : 1.0;
  CGAffineTransform transform = CGAffineTransformMakeScale(scale, scale);
  if (!animated) {
    self.glassEffectView.transform = transform;
    return;
  }
  [UIView animateWithDuration:pressed ? 0.2 : 0.18
                        delay:0
       usingSpringWithDamping:0.7
        initialSpringVelocity:0.2
                      options:UIViewAnimationOptionBeginFromCurrentState |
                              UIViewAnimationOptionAllowUserInteraction
                   animations:^{
                     self.glassEffectView.transform = transform;
                   }
                   completion:nil];
}

- (UIView *)rune_glassEffectView {
  return self.glassEffectView;
}

- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event {
  if (self.hidden || self.alpha <= 0.01) return nil;

  switch (self.pointerMode) {
    case RunePointerEventsNone:
      return nil;

    case RunePointerEventsBoxNone: {
      for (UIView *subview in self.subviews.reverseObjectEnumerator) {
        if (subview == self.glassEffectView) continue;
        CGPoint converted = [subview convertPoint:point fromView:self];
        UIView *hit = [subview hitTest:converted withEvent:event];
        if (hit) return hit;
      }
      return nil;
    }

    case RunePointerEventsBoxOnly:
      return CGRectContainsPoint(self.bounds, point) ? self : nil;

    case RunePointerEventsAuto:
    default:
      {
        UIView *hit = [super hitTest:point withEvent:event];
        if (!self.glassEffectView) return hit;
        if (hit == self.glassEffectView ||
            [hit isDescendantOfView:self.glassEffectView]) {
          return self;
        }
        return hit;
      }
  }
}

@end
