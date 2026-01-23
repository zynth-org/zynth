#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthKit.h"
#import "ZynthComponentAPI.h"
#import "ZynthUIManager.h"
#import "ZynthNode.h"
#endif

#import "ZynthScrollView.h"
#import "ZynthRecyclerScrollView.h"
#import "ScrollViewUICommands.h"

static BOOL ZynthScrollViewHandleSetProp(ZynthUIManager *manager,
                                        ZynthNode *node,
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

  if ([name isEqualToString:@"contentSize"]) {
    if ([value isKindOfClass:[NSDictionary class]]) {
      [scrollView zynth_setManualContentSize:(NSDictionary *)value];
    } else {
      [scrollView zynth_setManualContentSize:nil];
    }
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

static BOOL ZynthScrollViewHandleSetHandler(ZynthUIManager *manager,
                                           ZynthNode *node,
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

@implementation ZynthUIManager (ScrollViewComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    ZynthScrollViewRegisterUICommands();
    ZynthComponentDescriptor *descriptor = [[ZynthComponentDescriptor alloc] initWithType:@"scroll-view"];
    descriptor.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      ZynthScrollView *scrollView = [ZynthScrollView new];
      return scrollView;
    };
    descriptor.attach = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[ZynthScrollView class]]) return;
      ZynthScrollView *scrollView = (ZynthScrollView *)node.view;
      [scrollView attachToManager:manager node:node];
    };
    descriptor.handleSetProp = ^BOOL(ZynthUIManager *manager, ZynthNode *node, NSString *name, id value, NSString *rawJSON) {
      return ZynthScrollViewHandleSetProp(manager, node, name, value, rawJSON);
    };
    descriptor.handleSetHandler = ^BOOL(ZynthUIManager *manager, ZynthNode *node, NSString *name) {
      return ZynthScrollViewHandleSetHandler(manager, node, name);
    };
    descriptor.handleInsertChild = ^BOOL(ZynthUIManager *manager,
                                         ZynthNode *parent,
                                         ZynthNode *child,
                                         NSNumber *childId,
                                         NSUInteger index) {
      if (!parent || ![parent.view isKindOfClass:[ZynthScrollView class]]) return NO;
      ZynthScrollView *scrollView = (ZynthScrollView *)parent.view;
      if (!child.view) return YES;
      NSUInteger target = MIN(index, parent.children.count);
      [scrollView insertContentSubview:child.view atIndex:(NSInteger)target];
      [parent.children insertObject:childId atIndex:target];
      if (child.yoga && parent.yoga) {
        YGNodeRef owner = YGNodeGetOwner(child.yoga);
        if (owner) {
          YGNodeRemoveChild(owner, child.yoga);
        }
        YGNodeInsertChild(parent.yoga, child.yoga, (uint32_t)target);
      }
      [manager zynth_markNeedsFlush];
      return YES;
    };
    descriptor.handleRemoveChild = ^BOOL(ZynthUIManager *manager,
                                         ZynthNode *parent,
                                         ZynthNode *child,
                                         NSNumber *childId) {
      if (!parent || ![parent.view isKindOfClass:[ZynthScrollView class]]) return NO;
      ZynthScrollView *scrollView = (ZynthScrollView *)parent.view;
      if (child.view) {
        [scrollView removeContentSubview:child.view];
      }
      [parent.children removeObject:childId];
      if (child.yoga && parent.yoga) {
        YGNodeRemoveChild(parent.yoga, child.yoga);
      }
      [manager zynth_markNeedsFlush];
      return YES;
    };
    ZynthRegisterComponentDescriptor(descriptor);

    // Register RecyclerScrollView
    ZynthComponentDescriptor *recyclerDescriptor = [[ZynthComponentDescriptor alloc] initWithType:@"recycler-scroll-view"];
    recyclerDescriptor.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      return [ZynthRecyclerScrollView new];
    };
    recyclerDescriptor.attach = descriptor.attach;
    recyclerDescriptor.handleSetProp = descriptor.handleSetProp;
    recyclerDescriptor.handleSetHandler = descriptor.handleSetHandler;
    recyclerDescriptor.handleInsertChild = descriptor.handleInsertChild;
    recyclerDescriptor.handleRemoveChild = descriptor.handleRemoveChild;
    ZynthRegisterComponentDescriptor(recyclerDescriptor);
  });
}

@end
