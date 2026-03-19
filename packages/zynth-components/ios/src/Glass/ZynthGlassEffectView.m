#import "ZynthGlassEffectView.h"

@interface ZynthGlassEffectView ()
@property (nonatomic, copy) NSString *glassEffect;
@property (nonatomic, assign) BOOL glassInteractive;
@property (nonatomic, strong, nullable) UIColor *glassTintColor;
@property (nonatomic, strong, nullable) UIColor *pendingBackgroundColor;
@property (nonatomic, strong, nullable) UIView *cachedContentView;
@property (nonatomic, strong, nullable) NSNumber *styleCornerRadius;
@end

@implementation ZynthGlassEffectView

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _glassEffect = @"regular";
    _glassInteractive = YES;
    _pointerMode = ZynthPointerEventsAuto;
    self.backgroundColor = [UIColor clearColor];
    [self updateGlassEffect];
  }
  return self;
}

- (void)layoutSubviews {
  [super layoutSubviews];
  if (!self.cachedContentView) {
    self.cachedContentView = [super contentView];
  }
  [self zynth_applyClampedCornerRadius];
  if (self.cachedContentView) {
    self.cachedContentView.frame = self.bounds;
    if (self.pendingBackgroundColor) {
      self.cachedContentView.backgroundColor = self.pendingBackgroundColor;
    }
  }
}

- (void)setBackgroundColor:(UIColor *)backgroundColor {
  [super setBackgroundColor:backgroundColor];
  self.pendingBackgroundColor = backgroundColor;
  if (self.cachedContentView) {
    self.cachedContentView.backgroundColor = backgroundColor;
  }
}

- (void)updateGlassEffect {
#if __IPHONE_OS_VERSION_MAX_ALLOWED >= 260000
  if (@available(iOS 26.0, *)) {
    NSString *style = self.glassEffect ?: @"regular";
    if ([style isEqualToString:@"none"]) {
      self.effect = nil;
      return;
    }
    UIGlassEffectStyle effectStyle = UIGlassEffectStyleRegular;
    if ([style isEqualToString:@"clear"]) {
      effectStyle = UIGlassEffectStyleClear;
    }
    UIGlassEffect *effect = [UIGlassEffect effectWithStyle:effectStyle];
    effect.interactive = self.glassInteractive;
    effect.tintColor = self.glassTintColor;
    self.effect = effect;
    return;
  }
#endif
  self.effect = nil;
}

- (void)zynth_setGlassEffect:(NSString *)effect {
  _glassEffect = effect ?: @"regular";
  [self updateGlassEffect];
}

- (void)zynth_setInteractive:(BOOL)interactive {
  _glassInteractive = interactive;
  [self updateGlassEffect];
}

- (void)zynth_setTintColor:(UIColor *)tintColor {
  _glassTintColor = tintColor;
  [self updateGlassEffect];
}

- (void)zynth_setPointerEvents:(NSString *)pointerEvents {
  NSString *mode = [pointerEvents isKindOfClass:[NSString class]]
      ? (NSString *)pointerEvents
      : @"auto";
  self.pointerMode = ZynthPointerEventsFromString(mode);
}

- (void)zynth_setStyleCornerRadius:(NSNumber *)radius {
  _styleCornerRadius = radius;
  [self zynth_applyClampedCornerRadius];
}

- (CGFloat)zynth_clampedCornerRadiusForRadius:(CGFloat)radius {
  CGFloat normalized = MAX(0.0, radius);
  CGFloat width = CGRectGetWidth(self.bounds);
  CGFloat height = CGRectGetHeight(self.bounds);
  if (width <= 0.0 || height <= 0.0) {
    return normalized;
  }
  return MIN(normalized, MIN(width, height) * 0.5);
}

- (void)zynth_applyClampedCornerRadius {
  CGFloat sourceRadius =
      self.styleCornerRadius ? (CGFloat)self.styleCornerRadius.doubleValue : 0.0;
  CGFloat clamped = [self zynth_clampedCornerRadiusForRadius:sourceRadius];
  self.layer.cornerRadius = clamped;
  self.layer.masksToBounds = clamped > 0.0;
  self.clipsToBounds = clamped > 0.0;
  if (self.cachedContentView) {
    self.cachedContentView.layer.cornerRadius = clamped;
    self.cachedContentView.layer.masksToBounds = clamped > 0.0;
    self.cachedContentView.clipsToBounds = clamped > 0.0;
  }
}

- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event {
  if (self.hidden || self.alpha <= 0.01) return nil;

  switch (self.pointerMode) {
    case ZynthPointerEventsNone:
      return nil;

    case ZynthPointerEventsBoxNone: {
      for (UIView *subview in self.contentView.subviews.reverseObjectEnumerator) {
        CGPoint converted = [subview convertPoint:point fromView:self];
        UIView *hit = [subview hitTest:converted withEvent:event];
        if (hit) return hit;
      }
      return nil;
    }

    case ZynthPointerEventsBoxOnly:
      return CGRectContainsPoint(self.bounds, point) ? self : nil;

    case ZynthPointerEventsAuto:
    default:
      return [super hitTest:point withEvent:event];
  }
}

@end
