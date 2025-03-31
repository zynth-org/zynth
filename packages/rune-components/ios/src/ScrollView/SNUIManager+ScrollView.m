#if __has_include(<RuneKit/RuneKit.h>)
#import <RuneKit/RuneKit.h>
#else
#import "RuneKit.h"
#import "RuneComponentAPI.h"
#import "SNUIManager.h"
#import "SNNode.h"
#endif

#import "RuneScrollView.h"

static BOOL RuneScrollViewHandleSetProp(SNUIManager *manager,
                                        SNNode *node,
                                        NSString *name,
                                        id value,
                                        NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[RuneScrollView class]]) {
    return NO;
  }
  RuneScrollView *scrollView = (RuneScrollView *)node.view;

  if ([name isEqualToString:@"horizontal"]) {
    BOOL horizontal = value && value != (id)[NSNull null] ? [value boolValue] : NO;
    RuneScrollAxis axis = horizontal ? RuneScrollAxisHorizontal : RuneScrollAxisVertical;
    [scrollView rune_setAxis:axis];
    return YES;
  }

  if ([name isEqualToString:@"scrollEnabled"]) {
    BOOL enabled = value && value != (id)[NSNull null] ? [value boolValue] : YES;
    [scrollView rune_setScrollEnabled:enabled];
    return YES;
  }

  if ([name isEqualToString:@"directionalLockEnabled"]) {
    BOOL enabled = value && value != (id)[NSNull null] ? [value boolValue] : YES;
    [scrollView rune_setDirectionalLockEnabled:enabled];
    return YES;
  }

  if ([name isEqualToString:@"showsVerticalScrollIndicator"]) {
    BOOL show = value && value != (id)[NSNull null] ? [value boolValue] : YES;
    [scrollView rune_setShowsVerticalScrollIndicator:show];
    return YES;
  }

  if ([name isEqualToString:@"showsHorizontalScrollIndicator"]) {
    BOOL show = value && value != (id)[NSNull null] ? [value boolValue] : YES;
    [scrollView rune_setShowsHorizontalScrollIndicator:show];
    return YES;
  }

  if ([name isEqualToString:@"indicatorStyle"]) {
    NSString *style = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [scrollView rune_setIndicatorStyle:style];
    return YES;
  }

  if ([name isEqualToString:@"overScrollBehavior"]) {
    NSString *behavior = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [scrollView rune_setOverScrollBehavior:behavior];
    return YES;
  }

  if ([name isEqualToString:@"scrollSnapType"]) {
    [scrollView rune_setScrollSnapType:value];
    return YES;
  }

  if ([name isEqualToString:@"scrollSnapAlign"]) {
    [scrollView rune_setScrollSnapAlign:value];
    return YES;
  }

  if ([name isEqualToString:@"scrollSnapStop"]) {
    [scrollView rune_setScrollSnapStop:value];
    return YES;
  }

  if ([name isEqualToString:@"scrollPadding"]) {
    [scrollView rune_setScrollPadding:value];
    return YES;
  }

  if ([name isEqualToString:@"__scrollCommand"]) {
    if ([value isKindOfClass:[NSDictionary class]]) {
      [scrollView rune_applyCommand:(NSDictionary *)value];
    }
    return YES;
  }

  return NO;
}

static BOOL RuneScrollViewHandleSetHandler(SNUIManager *manager,
                                           SNNode *node,
                                           NSString *name) {
  if (!node || ![node.view isKindOfClass:[RuneScrollView class]]) {
    return NO;
  }

  if ([name isEqualToString:@"onScroll"] ||
      [name isEqualToString:@"onScrollBeginDrag"] ||
      [name isEqualToString:@"onScrollEndDrag"] ||
      [name isEqualToString:@"onMomentumScrollBegin"] ||
      [name isEqualToString:@"onMomentumScrollEnd"]) {
    return YES;
  }

  return NO;
}

@implementation SNUIManager (ScrollViewComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    RuneComponentDescriptor *descriptor = [[RuneComponentDescriptor alloc] initWithType:@"scroll-view"];
    descriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      RuneScrollView *scrollView = [RuneScrollView new];
      return scrollView;
    };
    descriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[RuneScrollView class]]) return;
      RuneScrollView *scrollView = (RuneScrollView *)node.view;
      [scrollView attachToManager:manager node:node];
    };
    descriptor.handleSetProp = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name, id value, NSString *rawJSON) {
      return RuneScrollViewHandleSetProp(manager, node, name, value, rawJSON);
    };
    descriptor.handleSetHandler = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name) {
      return RuneScrollViewHandleSetHandler(manager, node, name);
    };
    RuneRegisterComponentDescriptor(descriptor);
  });
}

@end
