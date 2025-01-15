#import "SNUIManager+Pressable.h"

#import "SNUIManager+Internal.h"
#import "RunePressableView.h"

@interface SNUIManager (PressableDelegate) <RunePressableViewDelegate>
@end

@implementation SNUIManager (Pressable)

- (void)sn_pressableAttachIfNeeded:(SNNode *)node {
  if (!node || ![node.view isKindOfClass:[RunePressableView class]]) return;
  RunePressableView *pressable = (RunePressableView *)node.view;
  pressable.delegate = self;
  [pressable attachToManager:self node:node];
}

- (BOOL)sn_pressableHandlesSetPropForNode:(SNNode *)node
                                    name:(NSString *)name
                                   value:(id)value
                                  rawJSON:(NSString *)rawJSON {
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
    [self rune_updateInteractionStateForNode:node];
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

- (BOOL)sn_pressableHandlesSetHandlerForNode:(SNNode *)node name:(NSString *)name {
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

#pragma mark - RunePressableViewDelegate

- (void)pressableView:(RunePressableView *)view didPressIn:(NSDictionary *)payload {
  SNNode *node = self.nodes[@(view.nodeId)];
  if (!node) return;
  [self sn_dispatchEvent:@"onPressIn" payload:payload ?: @{} toNode:node];
}

- (void)pressableView:(RunePressableView *)view didPressOut:(NSDictionary *)payload cancelled:(BOOL)cancelled {
  SNNode *node = self.nodes[@(view.nodeId)];
  if (!node) return;
  NSMutableDictionary *data = [payload mutableCopy] ?: [NSMutableDictionary new];
  data[@"cancelled"] = @(cancelled);
  [self sn_dispatchEvent:@"onPressOut" payload:data toNode:node];
}

- (void)pressableView:(RunePressableView *)view didPress:(NSDictionary *)payload {
  SNNode *node = self.nodes[@(view.nodeId)];
  if (!node) return;
  [self sn_dispatchEvent:@"onPress" payload:payload ?: @{} toNode:node];
}

- (void)pressableView:(RunePressableView *)view didLongPress:(NSDictionary *)payload duration:(CFTimeInterval)duration {
  SNNode *node = self.nodes[@(view.nodeId)];
  if (!node) return;
  NSMutableDictionary *data = [payload mutableCopy] ?: [NSMutableDictionary new];
  data[@"durationMs"] = @(duration);
  [self sn_dispatchEvent:@"onLongPress" payload:data toNode:node];
}

- (void)pressableView:(RunePressableView *)view didDoublePress:(NSDictionary *)payload {
  SNNode *node = self.nodes[@(view.nodeId)];
  if (!node) return;
  [self sn_dispatchEvent:@"onDoublePress" payload:payload ?: @{} toNode:node];
}

- (void)pressableViewDidFocus:(RunePressableView *)view {
  SNNode *node = self.nodes[@(view.nodeId)];
  if (!node) return;
  [self sn_dispatchEvent:@"onFocus" payload:@{} toNode:node];
}

- (void)pressableViewDidBlur:(RunePressableView *)view {
  SNNode *node = self.nodes[@(view.nodeId)];
  if (!node) return;
  [self sn_dispatchEvent:@"onBlur" payload:@{} toNode:node];
}

- (void)pressableView:(RunePressableView *)view didEmitKeyEvent:(NSString *)phase payload:(NSDictionary *)payload {
  SNNode *node = self.nodes[@(view.nodeId)];
  if (!node) return;
  [self sn_dispatchEvent:phase payload:payload ?: @{} toNode:node];
}

@end
