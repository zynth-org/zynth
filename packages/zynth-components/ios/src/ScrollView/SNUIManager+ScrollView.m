#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthKit.h"
#import "ZynthComponentAPI.h"
#import "SNUIManager.h"
#import "SNNode.h"
#endif

#import "ZynthScrollView.h"

static BOOL ZynthScrollViewHandleSetProp(SNUIManager *manager,
                                        SNNode *node,
                                        NSString *name,
                                        id value,
                                        NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[ZynthScrollView class]]) {
    return NO;
  }
  ZynthScrollView *scrollView = (ZynthScrollView *)node.view;

  if ([name isEqualToString:@"horizontal"]) {
    BOOL horizontal = value && value != (id)[NSNull null] ? [value boolValue] : NO;
    ZynthScrollAxis axis = horizontal ? ZynthScrollAxisHorizontal : ZynthScrollAxisVertical;
    [scrollView zynth_setAxis:axis];
    return YES;
  }

  if ([name isEqualToString:@"scrollEnabled"]) {
    BOOL enabled = value && value != (id)[NSNull null] ? [value boolValue] : YES;
    [scrollView zynth_setScrollEnabled:enabled];
    return YES;
  }

  if ([name isEqualToString:@"directionalLockEnabled"]) {
    BOOL enabled = value && value != (id)[NSNull null] ? [value boolValue] : YES;
    [scrollView zynth_setDirectionalLockEnabled:enabled];
    return YES;
  }

  if ([name isEqualToString:@"showsVerticalScrollIndicator"]) {
    BOOL show = value && value != (id)[NSNull null] ? [value boolValue] : YES;
    [scrollView zynth_setShowsVerticalScrollIndicator:show];
    return YES;
  }

  if ([name isEqualToString:@"showsHorizontalScrollIndicator"]) {
    BOOL show = value && value != (id)[NSNull null] ? [value boolValue] : YES;
    [scrollView zynth_setShowsHorizontalScrollIndicator:show];
    return YES;
  }

  if ([name isEqualToString:@"indicatorStyle"]) {
    NSString *style = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [scrollView zynth_setIndicatorStyle:style];
    return YES;
  }

  if ([name isEqualToString:@"overScrollBehavior"]) {
    NSString *behavior = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [scrollView zynth_setOverScrollBehavior:behavior];
    return YES;
  }

  if ([name isEqualToString:@"bounces"]) {
    BOOL enabled = value && value != (id)[NSNull null] ? [value boolValue] : YES;
    [scrollView zynth_setBounces:enabled];
    return YES;
  }

  if ([name isEqualToString:@"decelerationRate"]) {
    [scrollView zynth_setDecelerationRate:value];
    return YES;
  }

  if ([name isEqualToString:@"contentInset"]) {
    if ([value isKindOfClass:[NSDictionary class]]) {
      [scrollView zynth_setContentInset:(NSDictionary *)value];
    } else {
      [scrollView zynth_setContentInset:nil];
    }
    return YES;
  }

  if ([name isEqualToString:@"eventThrottleMs"]) {
    [scrollView zynth_setEventThrottleMs:value];
    return YES;
  }

  if ([name isEqualToString:@"eventMinDisplacementPx"]) {
    [scrollView zynth_setEventMinDisplacement:value];
    return YES;
  }

  if ([name isEqualToString:@"bridgeCoalescing"]) {
    BOOL enabled = value && value != (id)[NSNull null] ? [value boolValue] : NO;
    [scrollView zynth_setBridgeCoalescing:enabled];
    return YES;
  }

  if ([name isEqualToString:@"scrollGuardConfig"]) {
    if ([value isKindOfClass:[NSDictionary class]]) {
      [scrollView zynth_setScrollGuardConfig:(NSDictionary *)value];
    } else {
      [scrollView zynth_setScrollGuardConfig:nil];
    }
    return YES;
  }

  if ([name isEqualToString:@"scrollSnapType"]) {
    [scrollView zynth_setScrollSnapType:value];
    return YES;
  }

  if ([name isEqualToString:@"scrollSnapAlign"]) {
    [scrollView zynth_setScrollSnapAlign:value];
    return YES;
  }

  if ([name isEqualToString:@"scrollSnapStop"]) {
    [scrollView zynth_setScrollSnapStop:value];
    return YES;
  }

  if ([name isEqualToString:@"scrollPadding"]) {
    [scrollView zynth_setScrollPadding:value];
    return YES;
  }

  if ([name isEqualToString:@"__scrollCommand"]) {
    if ([value isKindOfClass:[NSDictionary class]]) {
      [scrollView zynth_applyCommand:(NSDictionary *)value];
    }
    return YES;
  }

  return NO;
}

static BOOL ZynthScrollViewHandleSetHandler(SNUIManager *manager,
                                           SNNode *node,
                                           NSString *name) {
  if (!node || ![node.view isKindOfClass:[ZynthScrollView class]]) {
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
    ZynthComponentDescriptor *descriptor = [[ZynthComponentDescriptor alloc] initWithType:@"scroll-view"];
    descriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      ZynthScrollView *scrollView = [ZynthScrollView new];
      return scrollView;
    };
    descriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[ZynthScrollView class]]) return;
      ZynthScrollView *scrollView = (ZynthScrollView *)node.view;
      [scrollView attachToManager:manager node:node];
    };
    descriptor.handleSetProp = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name, id value, NSString *rawJSON) {
      return ZynthScrollViewHandleSetProp(manager, node, name, value, rawJSON);
    };
    descriptor.handleSetHandler = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name) {
      return ZynthScrollViewHandleSetHandler(manager, node, name);
    };
    ZynthRegisterComponentDescriptor(descriptor);
  });
}

@end
