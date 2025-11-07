#if __has_include(<RuneKit/RuneKit.h>)
#import <RuneKit/RuneKit.h>
#import <RuneKit/SNHexColor.h>
#else
#import "RuneKit.h"
#import "RuneComponentRegistry.h"
#import "RuneComponentAPI.h"
#import "SNUIManager.h"
#import "SNNode.h"
#import "SNHexColor.h"
#endif

#import "RuneGlassEffectView.h"
#import "RuneGlassContainerView.h"

static BOOL RuneGlassViewHandleSetProp(SNUIManager *manager,
                                       SNNode *node,
                                       NSString *name,
                                       id value,
                                       NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[RuneGlassEffectView class]]) {
    return NO;
  }

  RuneGlassEffectView *glassView = (RuneGlassEffectView *)node.view;

  if ([name isEqualToString:@"glassEffect"]) {
    NSString *effect = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [glassView rune_setGlassEffect:effect];
    return YES;
  }

  if ([name isEqualToString:@"interactive"]) {
    BOOL interactive = value && value != (id)[NSNull null] ? [value boolValue] : NO;
    [glassView rune_setInteractive:interactive];
    return YES;
  }

  if ([name isEqualToString:@"tintColor"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = SNColorFromHex((NSString *)value);
    }
    [glassView rune_setTintColor:color];
    return YES;
  }

  if ([name isEqualToString:@"pointerEvents"]) {
    NSString *pointer = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [glassView rune_setPointerEvents:pointer];
    node.pointerEvents = pointer.length ? pointer : @"auto";
    [manager rune_updateInteractionStateForNode:node];
    return YES;
  }

  return NO;
}

static BOOL RuneGlassContainerHandleSetProp(SNUIManager *manager,
                                            SNNode *node,
                                            NSString *name,
                                            id value,
                                            NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[RuneGlassContainerView class]]) {
    return NO;
  }

  RuneGlassContainerView *container = (RuneGlassContainerView *)node.view;

  if ([name isEqualToString:@"spacing"]) {
    if ([value isKindOfClass:[NSNumber class]]) {
      [container rune_setSpacing:(NSNumber *)value];
    } else {
      [container rune_setSpacing:nil];
    }
    return YES;
  }

  if ([name isEqualToString:@"pointerEvents"]) {
    NSString *pointer = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [container rune_setPointerEvents:pointer];
    node.pointerEvents = pointer.length ? pointer : @"auto";
    [manager rune_updateInteractionStateForNode:node];
    return YES;
  }

  return NO;
}

@implementation SNUIManager (GlassComponents)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    RuneComponentDescriptor *glassDescriptor =
        [[RuneComponentDescriptor alloc] initWithType:@"glass-view"];
    glassDescriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      RuneGlassEffectView *view = [RuneGlassEffectView new];
      return view;
    };
    glassDescriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[RuneGlassEffectView class]]) return;
      if (!node.pointerEvents) {
        node.pointerEvents = @"auto";
      }
      RuneGlassEffectView *view = (RuneGlassEffectView *)node.view;
      [view rune_setPointerEvents:node.pointerEvents];
    };
    glassDescriptor.handleSetProp = ^BOOL(SNUIManager *manager,
                                          SNNode *node,
                                          NSString *name,
                                          id value,
                                          NSString *rawJSON) {
      return RuneGlassViewHandleSetProp(manager, node, name, value, rawJSON);
    };
    glassDescriptor.handleInsertChild = ^BOOL(SNUIManager *manager,
                                              SNNode *parent,
                                              SNNode *child,
                                              NSNumber *childId,
                                              NSUInteger index) {
      if (![parent.view isKindOfClass:[RuneGlassEffectView class]]) return NO;
      RuneGlassEffectView *glassView = (RuneGlassEffectView *)parent.view;
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
      [manager rune_markNeedsFlush];
      return YES;
    };
    RuneRegisterComponentDescriptor(glassDescriptor);

    RuneComponentDescriptor *containerDescriptor =
        [[RuneComponentDescriptor alloc] initWithType:@"glass-container"];
    containerDescriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      RuneGlassContainerView *view = [RuneGlassContainerView new];
      return view;
    };
    containerDescriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[RuneGlassContainerView class]]) return;
      if (!node.pointerEvents) {
        node.pointerEvents = @"auto";
      }
      RuneGlassContainerView *view = (RuneGlassContainerView *)node.view;
      [view rune_setPointerEvents:node.pointerEvents];
    };
    containerDescriptor.handleSetProp = ^BOOL(SNUIManager *manager,
                                              SNNode *node,
                                              NSString *name,
                                              id value,
                                              NSString *rawJSON) {
      return RuneGlassContainerHandleSetProp(manager, node, name, value, rawJSON);
    };
    containerDescriptor.handleInsertChild = ^BOOL(SNUIManager *manager,
                                                  SNNode *parent,
                                                  SNNode *child,
                                                  NSNumber *childId,
                                                  NSUInteger index) {
      if (![parent.view isKindOfClass:[RuneGlassContainerView class]]) return NO;
      RuneGlassContainerView *container = (RuneGlassContainerView *)parent.view;
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
      [manager rune_markNeedsFlush];
      return YES;
    };
    RuneRegisterComponentDescriptor(containerDescriptor);
  });
}

@end
