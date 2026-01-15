#import "ZynthGlassContainerView.h"

@interface ZynthGlassContainerView ()
@property (nonatomic, assign) CGFloat spacing;
@property (nonatomic, strong, nullable) UIColor *pendingBackgroundColor;
@property (nonatomic, strong, nullable) UIView *cachedContentView;
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
