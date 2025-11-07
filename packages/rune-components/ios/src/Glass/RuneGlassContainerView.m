#import "RuneGlassContainerView.h"

@interface RuneGlassContainerView ()
@property (nonatomic, assign) CGFloat spacing;
@property (nonatomic, strong, nullable) UIColor *pendingBackgroundColor;
@property (nonatomic, strong, nullable) UIView *cachedContentView;
@end

@implementation RuneGlassContainerView

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _spacing = 0.0;
    _pointerMode = RunePointerEventsAuto;
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

- (void)rune_setSpacing:(NSNumber *)spacing {
  _spacing = spacing ? spacing.doubleValue : 0.0;
  [self updateGlassEffect];
}

- (void)rune_setPointerEvents:(NSString *)pointerEvents {
  NSString *mode = [pointerEvents isKindOfClass:[NSString class]]
      ? (NSString *)pointerEvents
      : @"auto";
  self.pointerMode = RunePointerEventsFromString(mode);
}

- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event {
  if (self.hidden || self.alpha <= 0.01) return nil;

  switch (self.pointerMode) {
    case RunePointerEventsNone:
      return nil;

    case RunePointerEventsBoxNone: {
      for (UIView *subview in self.contentView.subviews.reverseObjectEnumerator) {
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
      return [super hitTest:point withEvent:event];
  }
}

@end
