#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#import <ZynthKit/ZynthHexColor.h>
#else
#import "ZynthKit.h"
#import "ZynthComponentAPI.h"
#import "ZynthUIManager.h"
#import "ZynthNode.h"
#import "ZynthHexColor.h"
#import "ZynthViewHost.h"
#endif

#import "ZynthButtonView.h"

static BOOL ZynthButtonHandleSetProp(ZynthUIManager *manager,
                                    ZynthNode *node,
                                    NSString *name,
                                    id value,
                                    NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[ZynthButtonView class]]) {
    return NO;
  }
  ZynthButtonView *button = (ZynthButtonView *)node.view;

  if ([name isEqualToString:@"disabled"]) {
    BOOL disabled = value && value != (id)[NSNull null] ? [value boolValue] : NO;
    [button zynth_setDisabled:disabled];
    return YES;
  }

  if ([name isEqualToString:@"loading"]) {
    BOOL loading = value && value != (id)[NSNull null] ? [value boolValue] : NO;
    [button zynth_setLoading:loading];
    return YES;
  }

  if ([name isEqualToString:@"loadingAriaLabel"]) {
    NSString *text = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [button zynth_setLoadingText:text];
    return YES;
  }

  if ([name isEqualToString:@"loadingPlacement"]) {
    NSString *placement = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [button zynth_setLoadingPlacement:placement];
    return YES;
  }

  if ([name isEqualToString:@"variant"]) {
    NSString *variant = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [button zynth_setVariant:variant];
    return YES;
  }
  
  if ([name isEqualToString:@"role"]) {
    NSString *role = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [button zynth_setRole:role];
    return YES;
  }
  
  if ([name isEqualToString:@"size"]) {
    NSString *size = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [button zynth_setSize:size];
    return YES;
  }
  
  if ([name isEqualToString:@"title"]) {
    NSString *title = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [button zynth_setTitle:title];
    return YES;
  }
  
  if ([name isEqualToString:@"baseColor"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = ZynthColorFromHex((NSString *)value);
    }
    [button zynth_setBaseColor:color];
    return YES;
  }

  if ([name isEqualToString:@"tintColor"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = ZynthColorFromHex((NSString *)value);
    }
    [button zynth_setGlassTintColor:color];
    return YES;
  }
  
  if ([name isEqualToString:@"pointerEvents"]) {
    NSString *mode = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    button.pointerMode = ZynthPointerEventsFromString(mode);
    return YES;
  }

  if ([name isEqualToString:@"enableGlassIOS"]) {
    BOOL enabled = value && value != (id)[NSNull null] ? [value boolValue] : NO;
    [button zynth_setEnableGlassIOS:enabled];
    return YES;
  }

  if ([name isEqualToString:@"pressEffect"]) {
    NSString *effect = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [button zynth_setPressEffect:effect];
    return YES;
  }

  if ([name isEqualToString:@"pressRetentionOffset"]) {
    if ([value isKindOfClass:[NSNumber class]]) {
      [button zynth_setPressRetentionOffset:(NSNumber *)value];
    }
    return YES;
  }

  if ([name isEqualToString:@"hitSlop"]) {
    [button zynth_setHitSlop:value];
    return YES;
  }

  if ([name isEqualToString:@"minimumTouchSize"]) {
    [button zynth_setMinimumTouchSize:value];
    return YES;
  }

  if ([name isEqualToString:@"rounded"]) {
    NSString *rounded = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [button zynth_setRounded:rounded];
    return YES;
  }

  if ([name isEqualToString:@"borderRadius"]) {
    NSNumber *radius = [value isKindOfClass:[NSNumber class]] ? (NSNumber *)value : nil;
    [button zynth_setStyleCornerRadius:radius];
    return YES;
  }

  if ([name isEqualToString:@"preventFocusOnPress"]) {
    BOOL prevent = value && value != (id)[NSNull null] ? [value boolValue] : NO;
    [button zynth_setPreventFocusOnPress:prevent];
    return YES;
  }

  if ([name isEqualToString:@"haptics"]) {
    NSString *mode = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [button zynth_setHapticsMode:mode];
    return YES;
  }

  if ([name isEqualToString:@"__buttonCommand"]) {
    if ([value isKindOfClass:[NSDictionary class]]) {
      [button zynth_handleCommand:(NSDictionary *)value];
    }
    return YES;
  }

  return NO;
}

static BOOL ZynthButtonHandleSetHandler(ZynthUIManager *manager,
                                       ZynthNode *node,
                                       NSString *name) {
  if (!node || ![node.view isKindOfClass:[ZynthButtonView class]]) {
    return NO;
  }
  ZynthButtonView *button = (ZynthButtonView *)node.view;

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
    [button zynth_setHasLongPressHandler:YES];
    return YES;
  }

  return NO;
}

@interface ZynthUIManager (ButtonComponent) <ZynthButtonViewDelegate>
@end

@implementation ZynthUIManager (ButtonComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    ZynthComponentDescriptor *descriptor = [[ZynthComponentDescriptor alloc] initWithType:@"button"];
    descriptor.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      ZynthButtonView *button = [ZynthButtonView new];
      return button;
    };
    descriptor.attach = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[ZynthButtonView class]]) return;
      ZynthButtonView *button = (ZynthButtonView *)node.view;
      button.delegate = manager;
      [button attachToManager:manager node:node];
    };
    descriptor.handleSetProp = ^BOOL(ZynthUIManager *manager, ZynthNode *node, NSString *name, id value, NSString *rawJSON) {
      return ZynthButtonHandleSetProp(manager, node, name, value, rawJSON);
    };
    descriptor.handleSetHandler = ^BOOL(ZynthUIManager *manager, ZynthNode *node, NSString *name) {
      return ZynthButtonHandleSetHandler(manager, node, name);
    };
    ZynthRegisterComponentDescriptor(descriptor);
  });
}

#pragma mark - ZynthButtonViewDelegate

- (void)buttonViewDidPressIn:(ZynthButtonView *)button {
  ZynthNode *node = [self zynth_nodeForId:@(button.nodeId)];
  if (!node) return;
  [self zynth_dispatchEvent:@"onPressIn" payload:@{} toNode:node];
}

- (void)buttonViewDidPressOut:(ZynthButtonView *)button cancelled:(BOOL)cancelled {
  ZynthNode *node = [self zynth_nodeForId:@(button.nodeId)];
  if (!node) return;
  NSDictionary *payload = @{@"cancelled" : @(cancelled)};
  [self zynth_dispatchEvent:@"onPressOut" payload:payload toNode:node];
}

- (void)buttonViewDidActivate:(ZynthButtonView *)button {
  ZynthNode *node = [self zynth_nodeForId:@(button.nodeId)];
  if (!node) return;
  [self zynth_dispatchEvent:@"onPress" payload:@{} toNode:node];
}

- (void)buttonView:(ZynthButtonView *)button didLongPressWithDuration:(CFTimeInterval)duration {
  ZynthNode *node = [self zynth_nodeForId:@(button.nodeId)];
  if (!node) return;
  NSDictionary *payload = @{@"durationMs" : @(duration)};
  [self zynth_dispatchEvent:@"onLongPress" payload:payload toNode:node];
}

- (void)buttonViewDidFocus:(ZynthButtonView *)button {
  ZynthNode *node = [self zynth_nodeForId:@(button.nodeId)];
  if (!node) return;
  [self zynth_dispatchEvent:@"onFocus" payload:@{} toNode:node];
}

- (void)buttonViewDidBlur:(ZynthButtonView *)button {
  ZynthNode *node = [self zynth_nodeForId:@(button.nodeId)];
  if (!node) return;
  [self zynth_dispatchEvent:@"onBlur" payload:@{} toNode:node];
}

- (void)buttonView:(ZynthButtonView *)button didEmitKeyEvent:(NSString *)phase key:(NSString *)key {
  ZynthNode *node = [self zynth_nodeForId:@(button.nodeId)];
  if (!node) return;
  NSDictionary *payload = key.length ? @{@"key" : key} : @{};
  [self zynth_dispatchEvent:phase payload:payload toNode:node];
}

@end
