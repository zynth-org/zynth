#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#import <ZynthKit/SNHexColor.h>
#else
#import "ZynthKit.h"
#import "ZynthComponentRegistry.h"
#import "ZynthComponentAPI.h"
#import "SNUIManager.h"
#import "SNNode.h"
#import "SNHexColor.h"
#endif

#import "ZynthPressableView.h"

static BOOL ZynthPressableHandleSetProp(SNUIManager *manager,
                                       SNNode *node,
                                       NSString *name,
                                       id value,
                                       NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[ZynthPressableView class]]) {
    return NO;
  }

  ZynthPressableView *pressable = (ZynthPressableView *)node.view;

  if ([name isEqualToString:@"disabled"]) {
    BOOL disabled = value && value != (id)[NSNull null] ? [value boolValue] : NO;
    [pressable zynth_setDisabled:disabled];
    return YES;
  }

  if ([name isEqualToString:@"pressEffect"]) {
    NSString *effect = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [pressable zynth_setPressEffect:effect];
    return YES;
  }

  if ([name isEqualToString:@"pressRetentionOffset"]) {
    if ([value isKindOfClass:[NSNumber class]]) {
      [pressable zynth_setPressRetentionOffset:(NSNumber *)value];
    }
    return YES;
  }

  if ([name isEqualToString:@"hitSlop"]) {
    [pressable zynth_setHitSlop:value];
    return YES;
  }

  if ([name isEqualToString:@"preventFocusOnPress"]) {
    BOOL prevent = value && value != (id)[NSNull null] ? [value boolValue] : NO;
    [pressable zynth_setPreventFocusOnPress:prevent];
    return YES;
  }

  if ([name isEqualToString:@"delayPressInMs"]) {
    if ([value isKindOfClass:[NSNumber class]]) {
      [pressable zynth_setDelayPressIn:(NSNumber *)value];
    }
    return YES;
  }

  if ([name isEqualToString:@"delayPressOutMs"]) {
    if ([value isKindOfClass:[NSNumber class]]) {
      [pressable zynth_setDelayPressOut:(NSNumber *)value];
    }
    return YES;
  }

  if ([name isEqualToString:@"delayLongPressMs"] || [name isEqualToString:@"longPressMinDurationMs"]) {
    if ([value isKindOfClass:[NSNumber class]]) {
      [pressable zynth_setDelayLongPress:(NSNumber *)value];
    }
    return YES;
  }

  if ([name isEqualToString:@"allowTouchPropagation"]) {
    BOOL allow = value && value != (id)[NSNull null] ? [value boolValue] : NO;
    [pressable zynth_setAllowTouchPropagation:allow];
    return YES;
  }

  if ([name isEqualToString:@"cancelOnOutside"]) {
    BOOL cancel = value && value != (id)[NSNull null] ? [value boolValue] : YES;
    [pressable zynth_setCancelOnOutside:cancel];
    return YES;
  }

  if ([name isEqualToString:@"enableDoublePress"]) {
    BOOL enable = value && value != (id)[NSNull null] ? [value boolValue] : NO;
    [pressable zynth_setEnableDoublePress:enable];
    return YES;
  }

  if ([name isEqualToString:@"doublePressWindowMs"]) {
    if ([value isKindOfClass:[NSNumber class]]) {
      [pressable zynth_setDoublePressWindow:(NSNumber *)value];
    }
    return YES;
  }

  if ([name isEqualToString:@"focusable"]) {
    BOOL focusable = value && value != (id)[NSNull null] ? [value boolValue] : YES;
    [pressable zynth_setFocusable:focusable];
    return YES;
  }

  if ([name isEqualToString:@"pointerEvents"]) {
    NSString *pointer = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [pressable zynth_setPointerEvents:pointer];
    node.pointerEvents = pointer.length ? pointer : @"auto";
    [manager zynth_updateInteractionStateForNode:node];
    return YES;
  }

  if ([name isEqualToString:@"tintColor"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = SNColorFromHex((NSString *)value);
    }
    [pressable zynth_setGlassTintColor:color];
    return YES;
  }

  if ([name isEqualToString:@"enableGlassIOS"]) {
    BOOL enabled = value && value != (id)[NSNull null] ? [value boolValue] : NO;
    [pressable zynth_setEnableGlassIOS:enabled];
    return YES;
  }

  if ([name isEqualToString:@"activateKeys"]) {
    if ([value isKindOfClass:[NSArray class]]) {
      [pressable zynth_setActivateKeys:(NSArray<NSString *> *)value];
    }
    return YES;
  }

  if ([name isEqualToString:@"__pressableCommand"]) {
    if ([value isKindOfClass:[NSDictionary class]]) {
      [pressable zynth_handleCommand:(NSDictionary *)value];
    }
    return YES;
  }

  return NO;
}

static BOOL ZynthPressableHandleSetHandler(SNUIManager *manager,
                                          SNNode *node,
                                          NSString *name) {
  if (!node || ![node.view isKindOfClass:[ZynthPressableView class]]) {
    return NO;
  }

  ZynthPressableView *pressable = (ZynthPressableView *)node.view;

  if ([name isEqualToString:@"onPress"] ||
      [name isEqualToString:@"onPressIn"] ||
      [name isEqualToString:@"onPressOut"] ||
      [name isEqualToString:@"onDoublePress"] ||
      [name isEqualToString:@"onHoverIn"] ||
      [name isEqualToString:@"onHoverOut"] ||
      [name isEqualToString:@"onFocus"] ||
      [name isEqualToString:@"onBlur"] ||
      [name isEqualToString:@"onKeyDown"] ||
      [name isEqualToString:@"onKeyUp"]) {
    return YES;
  }

  if ([name isEqualToString:@"onLongPress"]) {
    [pressable zynth_setHasLongPressHandler:YES];
    return YES;
  }

  return NO;
}

@interface SNUIManager (PressableComponent) <ZynthPressableViewDelegate>
@end

@implementation SNUIManager (PressableComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    ZynthComponentDescriptor *descriptor = [[ZynthComponentDescriptor alloc] initWithType:@"pressable"];
    descriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      ZynthPressableView *pressable = [ZynthPressableView new];
      return pressable;
    };
    descriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[ZynthPressableView class]]) return;
      ZynthPressableView *pressable = (ZynthPressableView *)node.view;
      pressable.delegate = manager;
      [pressable attachToManager:manager node:node];
    };
    descriptor.handleSetProp = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name, id value, NSString *rawJSON) {
      return ZynthPressableHandleSetProp(manager, node, name, value, rawJSON);
    };
    descriptor.handleSetHandler = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name) {
      return ZynthPressableHandleSetHandler(manager, node, name);
    };
    ZynthRegisterComponentDescriptor(descriptor);
  });
}

#pragma mark - ZynthPressableViewDelegate

- (void)pressableView:(ZynthPressableView *)view didPressIn:(NSDictionary *)payload {
  SNNode *node = view.zynth_node;
  if (!node) return;
  [self zynth_dispatchEvent:@"onPressIn" payload:payload ?: @{} toNode:node];
}

- (void)pressableView:(ZynthPressableView *)view didPressOut:(NSDictionary *)payload cancelled:(BOOL)cancelled {
  SNNode *node = view.zynth_node;
  if (!node) return;
  NSMutableDictionary *data = [payload mutableCopy] ?: [NSMutableDictionary new];
  data[@"cancelled"] = @(cancelled);
  [self zynth_dispatchEvent:@"onPressOut" payload:data toNode:node];
}

- (void)pressableView:(ZynthPressableView *)view didPress:(NSDictionary *)payload {
  SNNode *node = view.zynth_node;
  if (!node) return;
  [self zynth_dispatchEvent:@"onPress" payload:payload ?: @{} toNode:node];
}

- (void)pressableView:(ZynthPressableView *)view didLongPress:(NSDictionary *)payload duration:(CFTimeInterval)duration {
  SNNode *node = view.zynth_node;
  if (!node) return;
  NSMutableDictionary *data = [payload mutableCopy] ?: [NSMutableDictionary new];
  data[@"durationMs"] = @(duration);
  [self zynth_dispatchEvent:@"onLongPress" payload:data toNode:node];
}

- (void)pressableView:(ZynthPressableView *)view didDoublePress:(NSDictionary *)payload {
  SNNode *node = view.zynth_node;
  if (!node) return;
  [self zynth_dispatchEvent:@"onDoublePress" payload:payload ?: @{} toNode:node];
}

- (void)pressableViewDidHover:(ZynthPressableView *)view hovering:(BOOL)hovering {
  SNNode *node = view.zynth_node;
  if (!node) return;
  NSString *event = hovering ? @"onHoverIn" : @"onHoverOut";
  [self zynth_dispatchEvent:event payload:@{} toNode:node];
}

- (void)pressableViewDidFocus:(ZynthPressableView *)view {
  SNNode *node = view.zynth_node;
  if (!node) return;
  [self zynth_dispatchEvent:@"onFocus" payload:@{} toNode:node];
}

- (void)pressableViewDidBlur:(ZynthPressableView *)view {
  SNNode *node = view.zynth_node;
  if (!node) return;
  [self zynth_dispatchEvent:@"onBlur" payload:@{} toNode:node];
}

- (void)pressableView:(ZynthPressableView *)view didEmitKeyEvent:(NSString *)phase payload:(NSDictionary *)payload {
  SNNode *node = view.zynth_node;
  if (!node) return;
  [self zynth_dispatchEvent:phase payload:payload ?: @{} toNode:node];
}

@end
