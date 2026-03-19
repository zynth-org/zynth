#import "ZynthGlassContainerView.h"

@interface ZynthGlassContainerView ()
@property (nonatomic, assign) CGFloat spacing;
@property (nonatomic, strong, nullable) UIColor *pendingBackgroundColor;
@property (nonatomic, strong, nullable) UIView *cachedContentView;
@property (nonatomic, strong, nullable) NSNumber *styleCornerRadius;
@end

@implementation ZynthGlassContainerView

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _spacing = 0.0;
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
    UIGlassContainerEffect *effect = [UIGlassContainerEffect new];
    effect.spacing = self.spacing;
    self.effect = effect;
    return;
  }
#endif
  self.effect = nil;
}

- (void)zynth_setSpacing:(NSNumber *)spacing {
  _spacing = spacing ? spacing.doubleValue : 0.0;
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
