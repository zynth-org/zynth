#import "RuneUIManager+View.h"

@implementation RuneHitTestingView
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

@implementation SNUIManager (RuneView)

- (UIView *)rune_makeContainerView {
  RuneHitTestingView *view = [RuneHitTestingView new];
  view.pointerMode = RunePointerEventsAuto;
  return view;
}

- (void)rune_initializePointerDefaultsForNode:(SNNode *)node {
  if (!node || !node.view) return;

  if (!node.pointerEvents) {
    node.pointerEvents = @"auto";
  }

  if ([node.view isKindOfClass:[RuneHitTestingView class]]) {
    ((RuneHitTestingView *)node.view).pointerMode = RunePointerEventsFromString(node.pointerEvents);
  }

  if ([node.pointerEvents isEqualToString:@"none"]) {
    node.view.userInteractionEnabled = NO;
  } else {
    node.view.userInteractionEnabled = ![node.view isKindOfClass:[UILabel class]];
  }
}

- (void)rune_updateInteractionStateForNode:(SNNode *)node {
  if (!node || !node.view) return;

  RunePointerEventsMode mode = RunePointerEventsFromString(node.pointerEvents);
  BOOL hasTap = node.hasOnPressHandler;

  if ([node.view isKindOfClass:[RuneHitTestingView class]]) {
    ((RuneHitTestingView *)node.view).pointerMode = mode;
  }

  switch (mode) {
    case RunePointerEventsNone:
      node.view.userInteractionEnabled = NO;
      break;
    case RunePointerEventsBoxNone:
      node.view.userInteractionEnabled = YES;
      break;
    case RunePointerEventsBoxOnly:
    case RunePointerEventsAuto:
      node.view.userInteractionEnabled = YES;
      break;
  }

  for (UIGestureRecognizer *recognizer in node.view.gestureRecognizers) {
    if (![recognizer isKindOfClass:[UITapGestureRecognizer class]]) continue;
    NSString *name = recognizer.name;
    if (!(name && [name hasPrefix:@"node:"])) continue;

    switch (mode) {
      case RunePointerEventsNone:
      case RunePointerEventsBoxNone:
        recognizer.enabled = NO;
        break;
      case RunePointerEventsBoxOnly:
      case RunePointerEventsAuto:
        recognizer.enabled = hasTap;
        break;
    }
  }
}

- (void)rune_attachTapRecognizerForNode:(SNNode *)node {
  if (!node || !node.view) return;

  for (UIGestureRecognizer *recognizer in node.view.gestureRecognizers.copy) {
    if ([recognizer isKindOfClass:[UITapGestureRecognizer class]]) {
      [node.view removeGestureRecognizer:recognizer];
    }
  }

  UITapGestureRecognizer *tap = [[UITapGestureRecognizer alloc] initWithTarget:self action:@selector(rune_handleTap:)];
  tap.name = [NSString stringWithFormat:@"node:%d", node.nid];
  [node.view addGestureRecognizer:tap];
  node.hasOnPressHandler = YES;
  [self rune_updateInteractionStateForNode:node];
}

- (void)rune_handleTap:(UIGestureRecognizer *)recognizer {
  if (![recognizer isKindOfClass:[UITapGestureRecognizer class]]) return;

  NSString *name = recognizer.name;
  if (![name hasPrefix:@"node:"]) return;

  NSNumber *nodeId = @([[name substringFromIndex:5] intValue]);
  SNNode *node = self.nodes[nodeId];
  if (!node) return;

  RunePointerEventsMode mode = RunePointerEventsFromString(node.pointerEvents);
  if (mode == RunePointerEventsNone || mode == RunePointerEventsBoxNone) {
    return;
  }

  BOOL invoked = NO;
  if (node.hasOnPressHandler && self.jsInvoker) {
    [self.jsInvoker invokeHandlerForNode:node.nid name:@"onPress"];
    invoked = YES;
  }

  if (!invoked && node.onPressCallback && ![node.onPressCallback isUndefined]) {
    [node.onPressCallback callWithArguments:@[]];
  }
}

@end
