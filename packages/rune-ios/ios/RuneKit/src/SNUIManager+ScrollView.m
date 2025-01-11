#import "SNUIManager+ScrollView.h"

#import "SNUIManager+Internal.h"
#import "RuneScrollView.h"

@implementation SNUIManager (ScrollView)

- (void)sn_scrollViewAttachIfNeeded:(SNNode *)node {
  if (!node || ![node.view isKindOfClass:[RuneScrollView class]]) return;
  [(RuneScrollView *)node.view attachToManager:self node:node];
}

- (BOOL)sn_scrollViewHandlesSetPropForNode:(SNNode *)node
                                      name:(NSString *)name
                                     value:(id)value
                                    rawJSON:(NSString *)rawJSON {
  if (!node || ![node.view isKindOfClass:[RuneScrollView class]]) {
    return NO;
  }

  RuneScrollView *scroll = (RuneScrollView *)node.view;

  if ([name isEqualToString:@"horizontal"]) {
    BOOL horizontal = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
    [scroll rune_setAxis:horizontal ? RuneScrollAxisHorizontal : RuneScrollAxisVertical];
    return YES;
  }

  if ([name isEqualToString:@"scrollEnabled"]) {
    BOOL enabled = value ? ([value respondsToSelector:@selector(boolValue)] ? [value boolValue] : YES) : YES;
    [scroll rune_setScrollEnabled:enabled];
    return YES;
  }

  if ([name isEqualToString:@"directionalLockEnabled"]) {
    BOOL enabled = value ? ([value respondsToSelector:@selector(boolValue)] ? [value boolValue] : YES) : YES;
    [scroll rune_setDirectionalLockEnabled:enabled];
    return YES;
  }

  if ([name isEqualToString:@"showsVerticalScrollIndicator"]) {
    BOOL show = value ? ([value respondsToSelector:@selector(boolValue)] ? [value boolValue] : YES) : YES;
    [scroll rune_setShowsVerticalScrollIndicator:show];
    return YES;
  }

  if ([name isEqualToString:@"showsHorizontalScrollIndicator"]) {
    BOOL show = value ? ([value respondsToSelector:@selector(boolValue)] ? [value boolValue] : YES) : YES;
    [scroll rune_setShowsHorizontalScrollIndicator:show];
    return YES;
  }

  if ([name isEqualToString:@"indicatorStyle"]) {
    NSString *style = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [scroll rune_setIndicatorStyle:style];
    return YES;
  }

  if ([name isEqualToString:@"overScrollBehavior"]) {
    NSString *behavior = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [scroll rune_setOverScrollBehavior:behavior];
    return YES;
  }

  if ([name isEqualToString:@"bounces"]) {
    BOOL bounce = value ? ([value respondsToSelector:@selector(boolValue)] ? [value boolValue] : YES) : YES;
    [scroll rune_setBounces:bounce];
    return YES;
  }

  if ([name isEqualToString:@"decelerationRate"]) {
    [scroll rune_setDecelerationRate:[value isKindOfClass:[NSNull class]] ? nil : value];
    return YES;
  }

  if ([name isEqualToString:@"eventThrottleMs"]) {
    [scroll rune_setEventThrottleMs:value];
    return YES;
  }

  if ([name isEqualToString:@"eventMinDisplacementPx"]) {
    [scroll rune_setEventMinDisplacement:value];
    return YES;
  }

  if ([name isEqualToString:@"bridgeCoalescing"]) {
    BOOL enabled = value ? ([value respondsToSelector:@selector(boolValue)] ? [value boolValue] : YES) : YES;
    [scroll rune_setBridgeCoalescing:enabled];
    return YES;
  }

  if ([name isEqualToString:@"contentInset"]) {
    [scroll rune_setContentInset:[value isKindOfClass:[NSDictionary class]] ? value : nil];
    return YES;
  }

  if ([name isEqualToString:@"scrollSnapType"]) {
    [scroll rune_setScrollSnapType:value];
    return YES;
  }

  if ([name isEqualToString:@"scrollSnapAlign"]) {
    [scroll rune_setScrollSnapAlign:value];
    return YES;
  }

  if ([name isEqualToString:@"scrollSnapStop"]) {
    [scroll rune_setScrollSnapStop:value];
    return YES;
  }

  if ([name isEqualToString:@"scrollPadding"]) {
    [scroll rune_setScrollPadding:value];
    return YES;
  }

  if ([name isEqualToString:@"__scrollCommand"]) {
    if ([value isKindOfClass:[NSDictionary class]]) {
      [scroll rune_applyCommand:(NSDictionary *)value];
    }
    return YES;
  }

  return NO;
}

- (BOOL)sn_scrollViewHandlesSetHandlerForNode:(SNNode *)node name:(NSString *)name {
  if (!node || ![node.view isKindOfClass:[RuneScrollView class]]) {
    return NO;
  }
  // Scroll events are dispatched automatically; nothing extra required.
  return [@[@"onScroll", @"onScrollBeginDrag", @"onScrollEndDrag",
            @"onMomentumScrollBegin", @"onMomentumScrollEnd"] containsObject:name];
}

- (void)sn_scrollViewCleanupNode:(SNNode *)node {
  if (!node || ![node.view isKindOfClass:[RuneScrollView class]]) return;
  RuneScrollView *scroll = (RuneScrollView *)node.view;
  [scroll rune_setBridgeCoalescing:NO];
  [scroll rune_lockAxis:nil];
  [scroll attachToManager:nil node:nil];
}

- (BOOL)sn_scrollViewDidInsertChild:(SNNode *)parent
                              child:(SNNode *)child
                            atIndex:(NSInteger)index {
  if (!parent || ![parent.view isKindOfClass:[RuneScrollView class]]) {
    return NO;
  }
  RuneScrollView *scroll = (RuneScrollView *)parent.view;
  [scroll insertContentSubview:child.view atIndex:index];
  return YES;
}

- (BOOL)sn_scrollViewDidRemoveChild:(SNNode *)parent child:(SNNode *)child {
  if (!parent || ![parent.view isKindOfClass:[RuneScrollView class]]) {
    return NO;
  }
  RuneScrollView *scroll = (RuneScrollView *)parent.view;
  [scroll removeContentSubview:child.view];
  return YES;
}

@end
