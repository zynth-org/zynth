#if __has_include(<RuneKit/RuneKit.h>)
#import <RuneKit/RuneKit.h>
#else
#import "RuneKit.h"
#import "RuneComponentRegistry.h"
#import "RuneComponentAPI.h"
#import "SNUIManager.h"
#import "SNNode.h"
#endif

#import "RunePressableView.h"

static BOOL RunePressableHandleSetProp(SNUIManager *manager,
                                       SNNode *node,
                                       NSString *name,
                                       id value,
                                       NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[RunePressableView class]]) {
    return NO;
  }

  RunePressableView *pressable = (RunePressableView *)node.view;

  if ([name isEqualToString:@"disabled"]) {
    BOOL disabled = value && value != (id)[NSNull null] ? [value boolValue] : NO;
    [pressable rune_setDisabled:disabled];
    return YES;
  }

  if ([name isEqualToString:@"pressEffect"]) {
    NSString *effect = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [pressable rune_setPressEffect:effect];
    return YES;
  }

  if ([name isEqualToString:@"pressRetentionOffset"]) {
    if ([value isKindOfClass:[NSNumber class]]) {
      [pressable rune_setPressRetentionOffset:(NSNumber *)value];
    }
    return YES;
  }

  if ([name isEqualToString:@"hitSlop"]) {
    [pressable rune_setHitSlop:value];
    return YES;
  }

  if ([name isEqualToString:@"preventFocusOnPress"]) {
    BOOL prevent = value && value != (id)[NSNull null] ? [value boolValue] : NO;
    [pressable rune_setPreventFocusOnPress:prevent];
    return YES;
  }

  if ([name isEqualToString:@"delayPressInMs"]) {
    if ([value isKindOfClass:[NSNumber class]]) {
      [pressable rune_setDelayPressIn:(NSNumber *)value];
    }
    return YES;
  }

  if ([name isEqualToString:@"delayPressOutMs"]) {
    if ([value isKindOfClass:[NSNumber class]]) {
      [pressable rune_setDelayPressOut:(NSNumber *)value];
    }
    return YES;
  }

  if ([name isEqualToString:@"delayLongPressMs"] || [name isEqualToString:@"longPressMinDurationMs"]) {
    if ([value isKindOfClass:[NSNumber class]]) {
      [pressable rune_setDelayLongPress:(NSNumber *)value];
    }
    return YES;
  }

  if ([name isEqualToString:@"allowTouchPropagation"]) {
    BOOL allow = value && value != (id)[NSNull null] ? [value boolValue] : NO;
    [pressable rune_setAllowTouchPropagation:allow];
    return YES;
  }

  if ([name isEqualToString:@"cancelOnOutside"]) {
    BOOL cancel = value && value != (id)[NSNull null] ? [value boolValue] : YES;
    [pressable rune_setCancelOnOutside:cancel];
    return YES;
  }

  if ([name isEqualToString:@"enableDoublePress"]) {
    BOOL enable = value && value != (id)[NSNull null] ? [value boolValue] : NO;
    [pressable rune_setEnableDoublePress:enable];
    return YES;
  }

  if ([name isEqualToString:@"doublePressWindowMs"]) {
    if ([value isKindOfClass:[NSNumber class]]) {
      [pressable rune_setDoublePressWindow:(NSNumber *)value];
    }
    return YES;
  }

  if ([name isEqualToString:@"focusable"]) {
    BOOL focusable = value && value != (id)[NSNull null] ? [value boolValue] : YES;
    [pressable rune_setFocusable:focusable];
    return YES;
  }

  if ([name isEqualToString:@"pointerEvents"]) {
    NSString *pointer = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [pressable rune_setPointerEvents:pointer];
    node.pointerEvents = pointer.length ? pointer : @"auto";
    [manager rune_updateInteractionStateForNode:node];
    return YES;
  }

  if ([name isEqualToString:@"activateKeys"]) {
    if ([value isKindOfClass:[NSArray class]]) {
      [pressable rune_setActivateKeys:(NSArray<NSString *> *)value];
    }
    return YES;
  }

  if ([name isEqualToString:@"__pressableCommand"]) {
    if ([value isKindOfClass:[NSDictionary class]]) {
      [pressable rune_handleCommand:(NSDictionary *)value];
    }
    return YES;
  }

  return NO;
}

static BOOL RunePressableHandleSetHandler(SNUIManager *manager,
                                          SNNode *node,
                                          NSString *name) {
  if (!node || ![node.view isKindOfClass:[RunePressableView class]]) {
    return NO;
  }

  RunePressableView *pressable = (RunePressableView *)node.view;

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
    [pressable rune_setHasLongPressHandler:YES];
    return YES;
  }

  return NO;
}

@interface SNUIManager (PressableComponent) <RunePressableViewDelegate>
@end

@implementation SNUIManager (PressableComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    RuneComponentDescriptor *descriptor = [[RuneComponentDescriptor alloc] initWithType:@"pressable"];
    descriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      RunePressableView *pressable = [RunePressableView new];
      return pressable;
    };
    descriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[RunePressableView class]]) return;
      RunePressableView *pressable = (RunePressableView *)node.view;
      pressable.delegate = manager;
      [pressable attachToManager:manager node:node];
    };
    descriptor.handleSetProp = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name, id value, NSString *rawJSON) {
      return RunePressableHandleSetProp(manager, node, name, value, rawJSON);
    };
    descriptor.handleSetHandler = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name) {
      return RunePressableHandleSetHandler(manager, node, name);
    };
    RuneRegisterComponentDescriptor(descriptor);
  });
}

#pragma mark - RunePressableViewDelegate

- (void)pressableView:(RunePressableView *)view didPressIn:(NSDictionary *)payload {
  SNNode *node = view.rune_node;
  if (!node) return;
  [self rune_dispatchEvent:@"onPressIn" payload:payload ?: @{} toNode:node];
}

- (void)pressableView:(RunePressableView *)view didPressOut:(NSDictionary *)payload cancelled:(BOOL)cancelled {
  SNNode *node = view.rune_node;
  if (!node) return;
  NSMutableDictionary *data = [payload mutableCopy] ?: [NSMutableDictionary new];
  data[@"cancelled"] = @(cancelled);
  [self rune_dispatchEvent:@"onPressOut" payload:data toNode:node];
}

- (void)pressableView:(RunePressableView *)view didPress:(NSDictionary *)payload {
  SNNode *node = view.rune_node;
  if (!node) return;
  [self rune_dispatchEvent:@"onPress" payload:payload ?: @{} toNode:node];
}

- (void)pressableView:(RunePressableView *)view didLongPress:(NSDictionary *)payload duration:(CFTimeInterval)duration {
  SNNode *node = view.rune_node;
  if (!node) return;
  NSMutableDictionary *data = [payload mutableCopy] ?: [NSMutableDictionary new];
  data[@"durationMs"] = @(duration);
  [self rune_dispatchEvent:@"onLongPress" payload:data toNode:node];
}

- (void)pressableView:(RunePressableView *)view didDoublePress:(NSDictionary *)payload {
  SNNode *node = view.rune_node;
  if (!node) return;
  [self rune_dispatchEvent:@"onDoublePress" payload:payload ?: @{} toNode:node];
}

- (void)pressableViewDidHover:(RunePressableView *)view hovering:(BOOL)hovering {
  SNNode *node = view.rune_node;
  if (!node) return;
  NSString *event = hovering ? @"onHoverIn" : @"onHoverOut";
  [self rune_dispatchEvent:event payload:@{} toNode:node];
}

- (void)pressableViewDidFocus:(RunePressableView *)view {
  SNNode *node = view.rune_node;
  if (!node) return;
  [self rune_dispatchEvent:@"onFocus" payload:@{} toNode:node];
}

- (void)pressableViewDidBlur:(RunePressableView *)view {
  SNNode *node = view.rune_node;
  if (!node) return;
  [self rune_dispatchEvent:@"onBlur" payload:@{} toNode:node];
}

- (void)pressableView:(RunePressableView *)view didEmitKeyEvent:(NSString *)phase payload:(NSDictionary *)payload {
  SNNode *node = view.rune_node;
  if (!node) return;
  [self rune_dispatchEvent:phase payload:payload ?: @{} toNode:node];
}

@end
