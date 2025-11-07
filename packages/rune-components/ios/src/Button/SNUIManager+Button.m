#if __has_include(<RuneKit/RuneKit.h>)
#import <RuneKit/RuneKit.h>
#import <RuneKit/SNHexColor.h>
#else
#import "RuneKit.h"
#import "RuneComponentAPI.h"
#import "SNUIManager.h"
#import "SNNode.h"
#import "SNHexColor.h"
#import "RuneViewHost.h"
#endif

#import "RuneButtonView.h"

static BOOL RuneButtonHandleSetProp(SNUIManager *manager,
                                    SNNode *node,
                                    NSString *name,
                                    id value,
                                    NSString *rawJSON) {
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

  if ([name isEqualToString:@"variant"]) {
    NSString *variant = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [button rune_setVariant:variant];
    return YES;
  }
  
  if ([name isEqualToString:@"role"]) {
    NSString *role = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [button rune_setRole:role];
    return YES;
  }
  
  if ([name isEqualToString:@"size"]) {
    NSString *size = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [button rune_setSize:size];
    return YES;
  }
  
  if ([name isEqualToString:@"title"]) {
    NSString *title = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [button rune_setTitle:title];
    return YES;
  }
  
  if ([name isEqualToString:@"baseColor"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = SNColorFromHex((NSString *)value);
    }
    [button rune_setBaseColor:color];
    return YES;
  }

  if ([name isEqualToString:@"tintColor"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = SNColorFromHex((NSString *)value);
    }
    [button rune_setGlassTintColor:color];
    return YES;
  }
  
  if ([name isEqualToString:@"pointerEvents"]) {
    NSString *mode = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    button.pointerMode = RunePointerEventsFromString(mode);
    return YES;
  }

  if ([name isEqualToString:@"enableGlassIOS"]) {
    BOOL enabled = value && value != (id)[NSNull null] ? [value boolValue] : NO;
    [button rune_setEnableGlassIOS:enabled];
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

  if ([name isEqualToString:@"rounded"]) {
    NSString *rounded = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [button rune_setRounded:rounded];
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

static BOOL RuneButtonHandleSetHandler(SNUIManager *manager,
                                       SNNode *node,
                                       NSString *name) {
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

@interface SNUIManager (ButtonComponent) <RuneButtonViewDelegate>
@end

@implementation SNUIManager (ButtonComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    RuneComponentDescriptor *descriptor = [[RuneComponentDescriptor alloc] initWithType:@"button"];
    descriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      RuneButtonView *button = [RuneButtonView new];
      return button;
    };
    descriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[RuneButtonView class]]) return;
      RuneButtonView *button = (RuneButtonView *)node.view;
      button.delegate = manager;
      [button attachToManager:manager node:node];
    };
    descriptor.handleSetProp = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name, id value, NSString *rawJSON) {
      return RuneButtonHandleSetProp(manager, node, name, value, rawJSON);
    };
    descriptor.handleSetHandler = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name) {
      return RuneButtonHandleSetHandler(manager, node, name);
    };
    RuneRegisterComponentDescriptor(descriptor);
  });
}

#pragma mark - RuneButtonViewDelegate

- (void)buttonViewDidPressIn:(RuneButtonView *)button {
  SNNode *node = [self rune_nodeForId:@(button.nodeId)];
  if (!node) return;
  [self rune_dispatchEvent:@"onPressIn" payload:@{} toNode:node];
}

- (void)buttonViewDidPressOut:(RuneButtonView *)button cancelled:(BOOL)cancelled {
  SNNode *node = [self rune_nodeForId:@(button.nodeId)];
  if (!node) return;
  NSDictionary *payload = @{@"cancelled" : @(cancelled)};
  [self rune_dispatchEvent:@"onPressOut" payload:payload toNode:node];
}

- (void)buttonViewDidActivate:(RuneButtonView *)button {
  SNNode *node = [self rune_nodeForId:@(button.nodeId)];
  if (!node) return;
  [self rune_dispatchEvent:@"onPress" payload:@{} toNode:node];
}

- (void)buttonView:(RuneButtonView *)button didLongPressWithDuration:(CFTimeInterval)duration {
  SNNode *node = [self rune_nodeForId:@(button.nodeId)];
  if (!node) return;
  NSDictionary *payload = @{@"durationMs" : @(duration)};
  [self rune_dispatchEvent:@"onLongPress" payload:payload toNode:node];
}

- (void)buttonViewDidFocus:(RuneButtonView *)button {
  SNNode *node = [self rune_nodeForId:@(button.nodeId)];
  if (!node) return;
  [self rune_dispatchEvent:@"onFocus" payload:@{} toNode:node];
}

- (void)buttonViewDidBlur:(RuneButtonView *)button {
  SNNode *node = [self rune_nodeForId:@(button.nodeId)];
  if (!node) return;
  [self rune_dispatchEvent:@"onBlur" payload:@{} toNode:node];
}

- (void)buttonView:(RuneButtonView *)button didEmitKeyEvent:(NSString *)phase key:(NSString *)key {
  SNNode *node = [self rune_nodeForId:@(button.nodeId)];
  if (!node) return;
  NSDictionary *payload = key.length ? @{@"key" : key} : @{};
  [self rune_dispatchEvent:phase payload:payload toNode:node];
}

@end
