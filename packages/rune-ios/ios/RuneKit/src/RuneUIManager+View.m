#import "RuneUIManager+View.h"
#import <objc/message.h>

@implementation SNUIManager (RuneView)

- (void)rune_initializePointerDefaultsForNode:(SNNode *)node {
  if (!node || !node.view) return;

  if (!node.pointerEvents) {
    node.pointerEvents = @"auto";
  }

  // Set pointerMode if the view supports it (via selector check to avoid import)
  if ([node.view respondsToSelector:@selector(setPointerMode:)]) {
    NSInteger mode = (NSInteger)RunePointerEventsFromString(node.pointerEvents);
    ((void (*)(id, SEL, NSInteger))objc_msgSend)(node.view, @selector(setPointerMode:), mode);
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

  // Set pointerMode if the view supports it (via selector check to avoid import)
  if ([node.view respondsToSelector:@selector(setPointerMode:)]) {
    ((void (*)(id, SEL, NSInteger))objc_msgSend)(node.view, @selector(setPointerMode:), (NSInteger)mode);
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
