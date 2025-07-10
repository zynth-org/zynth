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

#import "RuneSwitchView.h"
#import <yoga/Yoga.h>

#pragma mark - Yoga Measure Function

static YGSize RuneSwitchMeasureFunc(YGNodeConstRef node,
                                    float width,
                                    YGMeasureMode widthMode,
                                    float height,
                                    YGMeasureMode heightMode) {
  RuneSwitchView *switchView = (__bridge RuneSwitchView *)YGNodeGetContext(node);
  if (![switchView isKindOfClass:[RuneSwitchView class]]) {
    // Fallback to default UISwitch size
    return (YGSize){.width = 51, .height = 31};
  }
  
  CGSize intrinsicSize = [switchView intrinsicContentSize];
  
  float outW;
  switch (widthMode) {
    case YGMeasureModeExactly: outW = width; break;
    case YGMeasureModeAtMost: outW = MIN((float)intrinsicSize.width, width); break;
    default: outW = (float)intrinsicSize.width; break;
  }
  
  float outH;
  switch (heightMode) {
    case YGMeasureModeExactly: outH = height; break;
    case YGMeasureModeAtMost: outH = MIN((float)intrinsicSize.height, height); break;
    default: outH = (float)intrinsicSize.height; break;
  }
  
  return (YGSize){.width = outW, .height = outH};
}

#pragma mark - Property Handling

static BOOL RuneSwitchHandleSetProp(SNUIManager *manager,
                                    SNNode *node,
                                    NSString *name,
                                    id value,
                                    NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[RuneSwitchView class]]) {
    return NO;
  }
  RuneSwitchView *switchView = (RuneSwitchView *)node.view;

  if ([name isEqualToString:@"value"]) {
    BOOL boolValue = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
    [switchView rune_setValue:boolValue];
    return YES;
  }

  if ([name isEqualToString:@"disabled"]) {
    BOOL disabled = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
    [switchView rune_setDisabled:disabled];
    return YES;
  }

  if ([name isEqualToString:@"trackColor"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = SNColorFromHex((NSString *)value);
    }
    [switchView rune_setTrackColor:color];
    return YES;
  }

  if ([name isEqualToString:@"thumbColor"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = SNColorFromHex((NSString *)value);
    }
    [switchView rune_setThumbColor:color];
    return YES;
  }

  if ([name isEqualToString:@"pointerEvents"]) {
    NSString *mode = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    switchView.pointerMode = RunePointerEventsFromString(mode);
    return YES;
  }

  return NO;
}

static BOOL RuneSwitchHandleSetHandler(SNUIManager *manager,
                                       SNNode *node,
                                       NSString *name) {
  if (!node || ![node.view isKindOfClass:[RuneSwitchView class]]) return NO;
  RuneSwitchView *switchView = (RuneSwitchView *)node.view;

  if ([name isEqualToString:@"onValueChange"]) {
    __weak SNUIManager *weakManager = manager;
    __weak SNNode *weakNode = node;
    
    switchView.onValueChange = ^(BOOL value) {
      SNUIManager *strongManager = weakManager;
      SNNode *strongNode = weakNode;
      if (!strongManager || !strongNode) return;
      
      NSDictionary *payload = @{@"value": @(value)};
      [strongManager rune_dispatchEvent:@"onValueChange" payload:payload toNode:strongNode];
    };
    return YES;
  }

  return NO;
}

@implementation SNUIManager (SwitchComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    RuneComponentDescriptor *descriptor = [[RuneComponentDescriptor alloc] initWithType:@"switch-view"];
    descriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      RuneSwitchView *switchView = [RuneSwitchView new];
      return switchView;
    };
    descriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[RuneSwitchView class]]) return;
      RuneSwitchView *switchView = (RuneSwitchView *)node.view;
      switchView.nodeId = node ? node.nid : -1;
      
      // Set up Yoga measure function for proper layout sizing
      if (node.yoga) {
        YGNodeSetContext(node.yoga, (__bridge void *)switchView);
        YGNodeSetMeasureFunc(node.yoga, RuneSwitchMeasureFunc);
      }
    };
    descriptor.handleSetProp = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name, id value, NSString *rawJSON) {
      return RuneSwitchHandleSetProp(manager, node, name, value, rawJSON);
    };
    descriptor.handleSetHandler = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name) {
      return RuneSwitchHandleSetHandler(manager, node, name);
    };
    RuneRegisterComponentDescriptor(descriptor);
  });
}

@end
