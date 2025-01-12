#import "SNUIManager+Button.h"

#import "SNUIManager+Internal.h"
#import "RuneButtonView.h"

@interface SNUIManager (ButtonDelegate) <RuneButtonViewDelegate>
@end

@implementation SNUIManager (Button)

- (void)sn_buttonAttachIfNeeded:(SNNode *)node {
  if (!node || ![node.view isKindOfClass:[RuneButtonView class]]) return;
  RuneButtonView *button = (RuneButtonView *)node.view;
  button.delegate = self;
  [button attachToManager:self node:node];
}

- (BOOL)sn_buttonHandlesSetPropForNode:(SNNode *)node
                                  name:(NSString *)name
                                 value:(id)value
                                rawJSON:(NSString *)rawJSON {
  if (!node || ![node.view isKindOfClass:[RuneButtonView class]]) {
    return NO;
  }
  RuneButtonView *button = (RuneButtonView *)node.view;

  if ([name isEqualToString:@"disabled"]) {
    BOOL disabled = value && value != (id)[NSNull null] ? [value boolValue] : NO;
    [button rune_setDisabled:disabled];
    return YES;
  }

  if ([name isEqualToString:@"loading"]) {
    BOOL loading = value && value != (id)[NSNull null] ? [value boolValue] : NO;
    [button rune_setLoading:loading];
    return YES;
  }

  if ([name isEqualToString:@"pressEffect"]) {
    NSString *effect = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [button rune_setPressEffect:effect];
    return YES;
  }

  if ([name isEqualToString:@"pressRetentionOffset"]) {
    if ([value isKindOfClass:[NSNumber class]]) {
      [button rune_setPressRetentionOffset:(NSNumber *)value];
    }
    return YES;
  }

  if ([name isEqualToString:@"hitSlop"]) {
    [button rune_setHitSlop:value];
    return YES;
  }

  if ([name isEqualToString:@"minimumTouchSize"]) {
    [button rune_setMinimumTouchSize:value];
    return YES;
  }

  if ([name isEqualToString:@"preventFocusOnPress"]) {
    BOOL prevent = value && value != (id)[NSNull null] ? [value boolValue] : NO;
    [button rune_setPreventFocusOnPress:prevent];
    return YES;
  }

  if ([name isEqualToString:@"haptics"]) {
    NSString *mode = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [button rune_setHapticsMode:mode];
    return YES;
  }

  if ([name isEqualToString:@"__buttonCommand"]) {
    if ([value isKindOfClass:[NSDictionary class]]) {
      [button rune_handleCommand:(NSDictionary *)value];
    }
    return YES;
  }

  return NO;
}

- (BOOL)sn_buttonHandlesSetHandlerForNode:(SNNode *)node name:(NSString *)name {
  if (!node || ![node.view isKindOfClass:[RuneButtonView class]]) {
    return NO;
  }
  RuneButtonView *button = (RuneButtonView *)node.view;

  if ([name isEqualToString:@"onPress"]) {
    node.hasOnPressHandler = YES;
    return YES;
  }

  if ([name isEqualToString:@"onPressIn"] ||
      [name isEqualToString:@"onPressOut"] ||
      [name isEqualToString:@"onFocus"] ||
      [name isEqualToString:@"onBlur"] ||
      [name isEqualToString:@"onKeyDown"] ||
      [name isEqualToString:@"onKeyUp"]) {
    return YES;
  }

  if ([name isEqualToString:@"onLongPress"]) {
    [button rune_setHasLongPressHandler:YES];
    return YES;
  }

  return NO;
}

#pragma mark - RuneButtonViewDelegate

- (void)buttonViewDidPressIn:(RuneButtonView *)button {
  SNNode *node = self.nodes[@(button.nodeId)];
  if (!node) return;
  [self sn_dispatchEvent:@"onPressIn" payload:@{} toNode:node];
}

- (void)buttonViewDidPressOut:(RuneButtonView *)button cancelled:(BOOL)cancelled {
  SNNode *node = self.nodes[@(button.nodeId)];
  if (!node) return;
  NSDictionary *payload = @{@"cancelled" : @(cancelled)};
  [self sn_dispatchEvent:@"onPressOut" payload:payload toNode:node];
}

- (void)buttonViewDidActivate:(RuneButtonView *)button {
  SNNode *node = self.nodes[@(button.nodeId)];
  if (!node) return;
  [self sn_dispatchEvent:@"onPress" payload:@{} toNode:node];
}

- (void)buttonView:(RuneButtonView *)button didLongPressWithDuration:(CFTimeInterval)duration {
  SNNode *node = self.nodes[@(button.nodeId)];
  if (!node) return;
  NSDictionary *payload = @{@"durationMs" : @(duration)};
  [self sn_dispatchEvent:@"onLongPress" payload:payload toNode:node];
}

- (void)buttonViewDidFocus:(RuneButtonView *)button {
  SNNode *node = self.nodes[@(button.nodeId)];
  if (!node) return;
  [self sn_dispatchEvent:@"onFocus" payload:@{} toNode:node];
}

- (void)buttonViewDidBlur:(RuneButtonView *)button {
  SNNode *node = self.nodes[@(button.nodeId)];
  if (!node) return;
  [self sn_dispatchEvent:@"onBlur" payload:@{} toNode:node];
}

- (void)buttonView:(RuneButtonView *)button didEmitKeyEvent:(NSString *)phase key:(NSString *)key {
  SNNode *node = self.nodes[@(button.nodeId)];
  if (!node) return;
  NSDictionary *payload = key.length ? @{@"key" : key} : @{};
  [self sn_dispatchEvent:phase payload:payload toNode:node];
}

@end
