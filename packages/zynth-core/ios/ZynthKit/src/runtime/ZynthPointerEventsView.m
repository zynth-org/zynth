#import "ZynthPointerEventsView.h"

@implementation ZynthPointerEventsView

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    self.pointerMode = ZynthPointerEventsAuto;
  }
  return self;
}

- (instancetype)init {
  if (self = [super init]) {
    self.pointerMode = ZynthPointerEventsAuto;
  }
  return self;
}

- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event {
  if (self.hidden || self.alpha <= 0.01) return nil;

  switch (self.pointerMode) {
    case ZynthPointerEventsNone:
      return nil;

    case ZynthPointerEventsBoxNone: {
      for (UIView *subview in self.subviews.reverseObjectEnumerator) {
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
