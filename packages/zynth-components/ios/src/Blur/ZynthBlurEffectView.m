#import "ZynthBlurEffectView.h"

@interface ZynthBlurEffectView ()
@property (nonatomic, strong, nullable) NSNumber *blurIntensity;
@property (nonatomic, copy) NSString *blurTint;
@property (nonatomic, copy) NSString *blurVariant;
@property (nonatomic, assign) BOOL blurInteractive;
@property (nonatomic, strong, nullable) UIColor *blurTintColor;
@property (nonatomic, strong, nullable) UIColor *pendingBackgroundColor;
@property (nonatomic, strong, nullable) UIView *cachedContentView;
@property (nonatomic, strong, nullable) NSNumber *styleCornerRadius;
@end

@implementation ZynthBlurEffectView

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _blurIntensity = @(20.0);
    _blurTint = @"default";
    _blurVariant = @"blur";
    _blurInteractive = NO;
    _pointerMode = ZynthPointerEventsAuto;
    self.backgroundColor = [UIColor clearColor];
    [self updateBlurEffect];
  }
  return self;
}

- (void)layoutSubviews {
  [super layoutSubviews];
  if (!self.cachedContentView) {
    self.cachedContentView = [super contentView];
  }
  [self zynth_applyClampedCornerRadius];
  [self zynth_applyContentBackground];
  if (self.cachedContentView) {
    self.cachedContentView.frame = self.bounds;
  }
}

- (void)setBackgroundColor:(UIColor *)backgroundColor {
  [super setBackgroundColor:backgroundColor];
  self.pendingBackgroundColor = backgroundColor;
  [self zynth_applyContentBackground];
}

- (void)zynth_setBlurIntensity:(NSNumber *)intensity {
  _blurIntensity = intensity ?: @(20.0);
  [self updateBlurEffect];
}

- (void)zynth_setBlurTint:(NSString *)tint {
  _blurTint = tint.length ? tint : @"default";
  [self updateBlurEffect];
}

- (void)zynth_setBlurVariant:(NSString *)variant {
  _blurVariant = variant.length ? variant : @"blur";
  [self updateBlurEffect];
}

- (void)zynth_setInteractive:(BOOL)interactive {
  _blurInteractive = interactive;
  [self updateBlurEffect];
}

- (void)zynth_setTintColor:(UIColor *)tintColor {
  _blurTintColor = tintColor;
  [self updateBlurEffect];
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

- (void)updateBlurEffect {
#if __IPHONE_OS_VERSION_MAX_ALLOWED >= 260000
  if ([self.blurVariant.lowercaseString isEqualToString:@"glass"]) {
    if (@available(iOS 26.0, *)) {
      UIGlassEffect *effect = [UIGlassEffect effectWithStyle:UIGlassEffectStyleRegular];
      effect.interactive = self.blurInteractive;
      effect.tintColor = self.blurTintColor;
      self.effect = effect;
      [self zynth_applyContentBackground];
      return;
    }
  }
#endif

  if (self.blurIntensity.doubleValue <= 0.0) {
    self.effect = nil;
    [self zynth_applyContentBackground];
    return;
  }

  self.effect = [UIBlurEffect effectWithStyle:[self zynth_resolvedBlurStyle]];
  [self zynth_applyContentBackground];
}

- (UIBlurEffectStyle)zynth_resolvedBlurStyle {
  CGFloat intensity = MAX(0.0, MIN(100.0, self.blurIntensity.doubleValue));
  NSString *tint = self.blurTint.lowercaseString ?: @"default";

  if ([tint isEqualToString:@"light"]) {
    if (intensity <= 10.0) return UIBlurEffectStyleSystemUltraThinMaterialLight;
    if (intensity <= 25.0) return UIBlurEffectStyleSystemThinMaterialLight;
    if (intensity <= 40.0) return UIBlurEffectStyleSystemMaterialLight;
    if (intensity <= 60.0) return UIBlurEffectStyleSystemThickMaterialLight;
    return UIBlurEffectStyleSystemChromeMaterialLight;
  }

  if ([tint isEqualToString:@"dark"]) {
    if (intensity <= 10.0) return UIBlurEffectStyleSystemUltraThinMaterialDark;
    if (intensity <= 25.0) return UIBlurEffectStyleSystemThinMaterialDark;
    if (intensity <= 40.0) return UIBlurEffectStyleSystemMaterialDark;
    if (intensity <= 60.0) return UIBlurEffectStyleSystemThickMaterialDark;
    return UIBlurEffectStyleSystemChromeMaterialDark;
  }

  if (intensity <= 10.0) return UIBlurEffectStyleSystemUltraThinMaterial;
  if (intensity <= 25.0) return UIBlurEffectStyleSystemThinMaterial;
  if (intensity <= 40.0) return UIBlurEffectStyleSystemMaterial;
  if (intensity <= 60.0) return UIBlurEffectStyleSystemThickMaterial;
  return UIBlurEffectStyleSystemChromeMaterial;
}

- (void)zynth_applyContentBackground {
  if (!self.cachedContentView) return;
  UIColor *background = self.pendingBackgroundColor;
  if (!background && self.blurTintColor) {
    CGFloat intensity = MAX(0.0, MIN(100.0, self.blurIntensity.doubleValue));
    CGFloat alpha = 0.04 + (intensity / 100.0) * 0.18;
    background = [self.blurTintColor colorWithAlphaComponent:alpha];
  }
  self.cachedContentView.backgroundColor = background ?: UIColor.clearColor;
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
