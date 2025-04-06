#import "RuneHitTestingView.h"

@implementation RuneHitTestingView

- (instancetype)init {
  if (self = [super init]) {
    self.pointerMode = RunePointerEventsAuto;
  }
  return self;
}

- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event {
  if (self.hidden || self.alpha <= 0.01) return nil;

  switch (self.pointerMode) {
    case RunePointerEventsNone:
      return nil;

    case RunePointerEventsBoxNone: {
      for (UIView *subview in self.subviews.reverseObjectEnumerator) {
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
