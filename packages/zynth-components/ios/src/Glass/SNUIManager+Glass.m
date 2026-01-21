#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#import <ZynthKit/ZynthHexColor.h>
#else
#import "ZynthKit.h"
#import "ZynthComponentRegistry.h"
#import "ZynthComponentAPI.h"
#import "ZynthUIManager.h"
#import "ZynthNode.h"
#import "ZynthHexColor.h"
#endif

#import "ZynthGlassEffectView.h"
#import "ZynthGlassContainerView.h"

static BOOL ZynthGlassViewHandleSetProp(ZynthUIManager *manager,
                                       ZynthNode *node,
                                       NSString *name,
                                       id value,
                                       NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[ZynthGlassEffectView class]]) {
    return NO;
  }

  ZynthGlassEffectView *glassView = (ZynthGlassEffectView *)node.view;

  if ([name isEqualToString:@"glassEffect"]) {
    NSString *effect = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [glassView zynth_setGlassEffect:effect];
    return YES;
  }

  if ([name isEqualToString:@"interactive"]) {
    BOOL interactive = value && value != (id)[NSNull null] ? [value boolValue] : NO;
    [glassView zynth_setInteractive:interactive];
    return YES;
  }

  if ([name isEqualToString:@"tintColor"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = ZynthColorFromHex((NSString *)value);
    }
    [glassView zynth_setTintColor:color];
    return YES;
  }

  if ([name isEqualToString:@"pointerEvents"]) {
    NSString *pointer = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [glassView zynth_setPointerEvents:pointer];
    node.pointerEvents = pointer.length ? pointer : @"auto";
    [manager zynth_updateInteractionStateForNode:node];
    return YES;
  }

  return NO;
}

static BOOL ZynthGlassContainerHandleSetProp(ZynthUIManager *manager,
                                            ZynthNode *node,
                                            NSString *name,
                                            id value,
                                            NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[ZynthGlassContainerView class]]) {
    return NO;
  }

  ZynthGlassContainerView *container = (ZynthGlassContainerView *)node.view;

  if ([name isEqualToString:@"spacing"]) {
    if ([value isKindOfClass:[NSNumber class]]) {
      [container zynth_setSpacing:(NSNumber *)value];
    } else {
      [container zynth_setSpacing:nil];
    }
    return YES;
  }

  if ([name isEqualToString:@"pointerEvents"]) {
    NSString *pointer = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [container zynth_setPointerEvents:pointer];
    node.pointerEvents = pointer.length ? pointer : @"auto";
    [manager zynth_updateInteractionStateForNode:node];
    return YES;
  }

  return NO;
}

@implementation ZynthUIManager (GlassComponents)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    ZynthComponentDescriptor *glassDescriptor =
        [[ZynthComponentDescriptor alloc] initWithType:@"glass-view"];
    glassDescriptor.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      ZynthGlassEffectView *view = [ZynthGlassEffectView new];
      return view;
    };
    glassDescriptor.attach = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[ZynthGlassEffectView class]]) return;
      if (!node.pointerEvents) {
        node.pointerEvents = @"auto";
      }
      ZynthGlassEffectView *view = (ZynthGlassEffectView *)node.view;
      [view zynth_setPointerEvents:node.pointerEvents];
    };
    glassDescriptor.handleSetProp = ^BOOL(ZynthUIManager *manager,
                                          ZynthNode *node,
                                          NSString *name,
                                          id value,
                                          NSString *rawJSON) {
      return ZynthGlassViewHandleSetProp(manager, node, name, value, rawJSON);
    };
    glassDescriptor.handleInsertChild = ^BOOL(ZynthUIManager *manager,
                                              ZynthNode *parent,
                                              ZynthNode *child,
                                              NSNumber *childId,
                                              NSUInteger index) {
      if (![parent.view isKindOfClass:[ZynthGlassEffectView class]]) return NO;
      ZynthGlassEffectView *glassView = (ZynthGlassEffectView *)parent.view;
      UIView *contentView = glassView.contentView;
      if (!contentView) return NO;
      NSUInteger target = MIN(index, contentView.subviews.count);
      [contentView insertSubview:child.view atIndex:target];
      if (parent.children) {
        NSUInteger childTarget = MIN(target, parent.children.count);
        [parent.children insertObject:childId atIndex:childTarget];
      }
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
    ZynthRegisterComponentDescriptor(glassDescriptor);

    ZynthComponentDescriptor *containerDescriptor =
        [[ZynthComponentDescriptor alloc] initWithType:@"glass-container"];
    containerDescriptor.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      ZynthGlassContainerView *view = [ZynthGlassContainerView new];
      return view;
    };
    containerDescriptor.attach = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[ZynthGlassContainerView class]]) return;
      if (!node.pointerEvents) {
        node.pointerEvents = @"auto";
      }
      ZynthGlassContainerView *view = (ZynthGlassContainerView *)node.view;
      [view zynth_setPointerEvents:node.pointerEvents];
    };
    containerDescriptor.handleSetProp = ^BOOL(ZynthUIManager *manager,
                                              ZynthNode *node,
                                              NSString *name,
                                              id value,
                                              NSString *rawJSON) {
      return ZynthGlassContainerHandleSetProp(manager, node, name, value, rawJSON);
    };
    containerDescriptor.handleInsertChild = ^BOOL(ZynthUIManager *manager,
                                                  ZynthNode *parent,
                                                  ZynthNode *child,
                                                  NSNumber *childId,
                                                  NSUInteger index) {
      if (![parent.view isKindOfClass:[ZynthGlassContainerView class]]) return NO;
      ZynthGlassContainerView *container = (ZynthGlassContainerView *)parent.view;
      UIView *contentView = container.contentView;
      if (!contentView) return NO;
      NSUInteger target = MIN(index, contentView.subviews.count);
      [contentView insertSubview:child.view atIndex:target];
      if (parent.children) {
        NSUInteger childTarget = MIN(target, parent.children.count);
        [parent.children insertObject:childId atIndex:childTarget];
      }
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
    ZynthRegisterComponentDescriptor(containerDescriptor);
  });
}

@end
