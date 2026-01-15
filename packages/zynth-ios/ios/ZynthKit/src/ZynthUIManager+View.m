#import "ZynthUIManager+View.h"
#import <objc/message.h>

@implementation SNUIManager (ZynthView)

- (void)zynth_initializePointerDefaultsForNode:(SNNode *)node {
  if (!node || !node.view) return;

  if (!node.pointerEvents) {
    node.pointerEvents = @"auto";
  }

  // Set pointerMode if the view supports it (via selector check to avoid import)
  if ([node.view respondsToSelector:@selector(setPointerMode:)]) {
    NSInteger mode = (NSInteger)ZynthPointerEventsFromString(node.pointerEvents);
    ((void (*)(id, SEL, NSInteger))objc_msgSend)(node.view, @selector(setPointerMode:), mode);
  }

  if ([node.pointerEvents isEqualToString:@"none"]) {
    node.view.userInteractionEnabled = NO;
  } else {
    node.view.userInteractionEnabled = ![node.view isKindOfClass:[UILabel class]];
  }
}

- (void)zynth_updateInteractionStateForNode:(SNNode *)node {
  if (!node || !node.view) return;

  ZynthPointerEventsMode mode = ZynthPointerEventsFromString(node.pointerEvents);
  BOOL hasTap = node.hasOnPressHandler;

  // Set pointerMode if the view supports it (via selector check to avoid import)
  if ([node.view respondsToSelector:@selector(setPointerMode:)]) {
    ((void (*)(id, SEL, NSInteger))objc_msgSend)(node.view, @selector(setPointerMode:), (NSInteger)mode);
  }

  switch (mode) {
    case ZynthPointerEventsNone:
      node.view.userInteractionEnabled = NO;
      break;
    case ZynthPointerEventsBoxNone:
      node.view.userInteractionEnabled = YES;
      break;
    case ZynthPointerEventsBoxOnly:
    case ZynthPointerEventsAuto:
      node.view.userInteractionEnabled = YES;
      break;
  }

  for (UIGestureRecognizer *recognizer in node.view.gestureRecognizers) {
    if (![recognizer isKindOfClass:[UITapGestureRecognizer class]]) continue;
    NSString *name = recognizer.name;
    if (!(name && [name hasPrefix:@"node:"])) continue;

    switch (mode) {
      case ZynthPointerEventsNone:
      case ZynthPointerEventsBoxNone:
        recognizer.enabled = NO;
        break;
      case ZynthPointerEventsBoxOnly:
      case ZynthPointerEventsAuto:
        recognizer.enabled = hasTap;
        break;
    }
  }
}

- (void)zynth_attachTapRecognizerForNode:(SNNode *)node {
  if (!node || !node.view) return;

  for (UIGestureRecognizer *recognizer in node.view.gestureRecognizers.copy) {
    if ([recognizer isKindOfClass:[UITapGestureRecognizer class]]) {
      [node.view removeGestureRecognizer:recognizer];
    }
  }

  UITapGestureRecognizer *tap = [[UITapGestureRecognizer alloc] initWithTarget:self action:@selector(zynth_handleTap:)];
  tap.name = [NSString stringWithFormat:@"node:%d", node.nid];
  [node.view addGestureRecognizer:tap];
  node.hasOnPressHandler = YES;
  [self zynth_updateInteractionStateForNode:node];
}

- (void)zynth_handleTap:(UIGestureRecognizer *)recognizer {
  if (![recognizer isKindOfClass:[UITapGestureRecognizer class]]) return;

  NSString *name = recognizer.name;
  if (![name hasPrefix:@"node:"]) return;

  NSNumber *nodeId = @([[name substringFromIndex:5] intValue]);
  SNNode *node = self.nodes[nodeId];
  if (!node) return;

  ZynthPointerEventsMode mode = ZynthPointerEventsFromString(node.pointerEvents);
  if (mode == ZynthPointerEventsNone || mode == ZynthPointerEventsBoxNone) {
    return;
  }

  BOOL invoked = NO;
  if (node.hasOnPressHandler && self.jsInvoker) {
    [self.jsInvoker invokeHandlerForNode:node.nid name:@"onPress"];
    invoked = YES;
  }

  (void)invoked;
}

@end
