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

#import "ZynthBlurEffectView.h"

static BOOL ZynthBlurViewHandleSetProp(ZynthUIManager *manager,
                                      ZynthNode *node,
                                      NSString *name,
                                      id value,
                                      NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[ZynthBlurEffectView class]]) {
    return NO;
  }

  ZynthBlurEffectView *blurView = (ZynthBlurEffectView *)node.view;

  if ([name isEqualToString:@"blurIntensity"]) {
    NSNumber *intensity = [value isKindOfClass:[NSNumber class]] ? (NSNumber *)value : nil;
    [blurView zynth_setBlurIntensity:intensity];
    return YES;
  }

  if ([name isEqualToString:@"blurTint"]) {
    NSString *tint = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [blurView zynth_setBlurTint:tint];
    return YES;
  }

  if ([name isEqualToString:@"blurVariant"]) {
    NSString *variant = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [blurView zynth_setBlurVariant:variant];
    return YES;
  }

  if ([name isEqualToString:@"interactive"]) {
    BOOL interactive = value && value != (id)[NSNull null] ? [value boolValue] : NO;
    [blurView zynth_setInteractive:interactive];
    return YES;
  }

  if ([name isEqualToString:@"tintColor"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = ZynthColorFromHex((NSString *)value);
    }
    [blurView zynth_setTintColor:color];
    return YES;
  }

  if ([name isEqualToString:@"pointerEvents"]) {
    NSString *pointer = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [blurView zynth_setPointerEvents:pointer];
    node.pointerEvents = pointer.length ? pointer : @"auto";
    [manager zynth_updateInteractionStateForNode:node];
    return YES;
  }

  if ([name isEqualToString:@"borderRadius"]) {
    NSNumber *radius = [value isKindOfClass:[NSNumber class]] ? (NSNumber *)value : nil;
    [blurView zynth_setStyleCornerRadius:radius];
    return YES;
  }

  return NO;
}

@implementation ZynthUIManager (BlurComponents)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    ZynthComponentDescriptor *descriptor =
        [[ZynthComponentDescriptor alloc] initWithType:@"blur-view"];
    descriptor.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      return [ZynthBlurEffectView new];
    };
    descriptor.attach = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[ZynthBlurEffectView class]]) return;
      if (!node.pointerEvents) {
        node.pointerEvents = @"auto";
      }
      ZynthBlurEffectView *view = (ZynthBlurEffectView *)node.view;
      [view zynth_setPointerEvents:node.pointerEvents];
    };
    descriptor.handleSetProp = ^BOOL(ZynthUIManager *manager,
                                     ZynthNode *node,
                                     NSString *name,
                                     id value,
                                     NSString *rawJSON) {
      return ZynthBlurViewHandleSetProp(manager, node, name, value, rawJSON);
    };
    descriptor.handleInsertChild = ^BOOL(ZynthUIManager *manager,
                                         ZynthNode *parent,
                                         ZynthNode *child,
                                         NSNumber *childId,
                                         NSUInteger index) {
      if (![parent.view isKindOfClass:[ZynthBlurEffectView class]]) return NO;
      ZynthBlurEffectView *blurView = (ZynthBlurEffectView *)parent.view;
      UIView *contentView = blurView.contentView;
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
    ZynthRegisterComponentDescriptor(descriptor);
  });
}

@end
