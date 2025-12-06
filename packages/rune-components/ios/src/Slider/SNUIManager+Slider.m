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

#import "RuneSliderView.h"
#import <yoga/Yoga.h>

#pragma mark - Yoga Measure Function

static YGSize RuneSliderMeasureFunc(YGNodeConstRef node,
                                    float width,
                                    YGMeasureMode widthMode,
                                    float height,
                                    YGMeasureMode heightMode) {
  RuneSliderView *slider = (__bridge RuneSliderView *)YGNodeGetContext(node);
  if (![slider isKindOfClass:[RuneSliderView class]]) {
    return (YGSize){.width = 100, .height = 34};
  }

  CGSize fitting = [slider sizeThatFits:CGSizeMake(CGFLOAT_MAX, CGFLOAT_MAX)];

  float outW;
  switch (widthMode) {
    case YGMeasureModeExactly: outW = width; break;
    case YGMeasureModeAtMost: outW = MIN((float)fitting.width, width); break;
    default: outW = (float)fitting.width; break;
  }

  float outH;
  switch (heightMode) {
    case YGMeasureModeExactly: outH = height; break;
    case YGMeasureModeAtMost: outH = MIN((float)fitting.height, height); break;
    default: outH = (float)fitting.height; break;
  }

  return (YGSize){.width = outW, .height = outH};
}

#pragma mark - Property Handling

static double RuneSliderParseDouble(id value) {
  if ([value respondsToSelector:@selector(doubleValue)]) {
    return [value doubleValue];
  }
  return 0.0;
}

static BOOL RuneSliderHandleSetProp(SNUIManager *manager,
                                    SNNode *node,
                                    NSString *name,
                                    id value,
                                    NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[RuneSliderView class]]) return NO;
  RuneSliderView *sliderView = (RuneSliderView *)node.view;

  if ([name isEqualToString:@"value"]) {
    [sliderView rune_setValue:RuneSliderParseDouble(value)];
    return YES;
  }

  if ([name isEqualToString:@"minimumValue"] || [name isEqualToString:@"min"]) {
    [sliderView rune_setMinimumValue:RuneSliderParseDouble(value)];
    return YES;
  }

  if ([name isEqualToString:@"maximumValue"] || [name isEqualToString:@"max"]) {
    [sliderView rune_setMaximumValue:RuneSliderParseDouble(value)];
    return YES;
  }

  if ([name isEqualToString:@"step"]) {
    [sliderView rune_setStep:RuneSliderParseDouble(value)];
    return YES;
  }

  if ([name isEqualToString:@"disabled"]) {
    BOOL disabled = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
    [sliderView rune_setDisabled:disabled];
    return YES;
  }

  if ([name isEqualToString:@"minimumTrackTintColor"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = SNColorFromHex((NSString *)value);
    }
    [sliderView rune_setMinimumTrackColor:color];
    return YES;
  }

  if ([name isEqualToString:@"maximumTrackTintColor"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = SNColorFromHex((NSString *)value);
    }
    [sliderView rune_setMaximumTrackColor:color];
    return YES;
  }

  if ([name isEqualToString:@"thumbTintColor"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = SNColorFromHex((NSString *)value);
    }
    [sliderView rune_setThumbTintColor:color];
    return YES;
  }

  if ([name isEqualToString:@"pointerEvents"]) {
    NSString *mode = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    sliderView.pointerMode = RunePointerEventsFromString(mode);
    return YES;
  }

  return NO;
}

static BOOL RuneSliderHandleSetHandler(SNUIManager *manager,
                                       SNNode *node,
                                       NSString *name) {
  if (!node || ![node.view isKindOfClass:[RuneSliderView class]]) return NO;
  RuneSliderView *sliderView = (RuneSliderView *)node.view;

  if ([name isEqualToString:@"onValueChange"]) {
    __weak SNUIManager *weakManager = manager;
    __weak SNNode *weakNode = node;
    sliderView.onValueChange = ^(double value) {
      SNUIManager *strongManager = weakManager;
      SNNode *strongNode = weakNode;
      if (!strongManager || !strongNode) return;

      double sanitized = [sliderView snapValue:value];
      if (isnan(sanitized) || isinf(sanitized)) return;
      NSDictionary *payload = @{@"value": @(sanitized)};
      [strongManager rune_dispatchEvent:@"onValueChange" payload:payload toNode:strongNode];
    };
    return YES;
  }

  if ([name isEqualToString:@"onSlidingComplete"]) {
    __weak SNUIManager *weakManager = manager;
    __weak SNNode *weakNode = node;
    sliderView.onSlidingComplete = ^(double value) {
      SNUIManager *strongManager = weakManager;
      SNNode *strongNode = weakNode;
      if (!strongManager || !strongNode) return;

      double sanitized = [sliderView snapValue:value];
      if (isnan(sanitized) || isinf(sanitized)) return;
      NSDictionary *payload = @{@"value": @(sanitized)};
      [strongManager rune_dispatchEvent:@"onSlidingComplete" payload:payload toNode:strongNode];
    };
    return YES;
  }

  return NO;
}

@implementation SNUIManager (SliderComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    RuneComponentDescriptor *descriptor = [[RuneComponentDescriptor alloc] initWithType:@"slider-view"];
    descriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      return [RuneSliderView new];
    };
    descriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[RuneSliderView class]]) return;
      RuneSliderView *sliderView = (RuneSliderView *)node.view;
      sliderView.nodeId = node ? node.nid : -1;

      if (node.yoga) {
        YGNodeSetContext(node.yoga, (__bridge void *)sliderView);
        YGNodeSetMeasureFunc(node.yoga, RuneSliderMeasureFunc);
      }
    };
    descriptor.handleSetProp = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name, id value, NSString *rawJSON) {
      return RuneSliderHandleSetProp(manager, node, name, value, rawJSON);
    };
    descriptor.handleSetHandler = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name) {
      return RuneSliderHandleSetHandler(manager, node, name);
    };
    RuneRegisterComponentDescriptor(descriptor);
  });
}

@end
