#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#import <ZynthKit/SNHexColor.h>
#else
#import "ZynthKit.h"
#import "ZynthComponentAPI.h"
#import "SNUIManager.h"
#import "SNNode.h"
#import "SNHexColor.h"
#import "ZynthViewHost.h"
#endif

#import "ZynthSliderView.h"
#import <yoga/Yoga.h>

#pragma mark - Yoga Measure Function

static YGSize ZynthSliderMeasureFunc(YGNodeConstRef node,
                                    float width,
                                    YGMeasureMode widthMode,
                                    float height,
                                    YGMeasureMode heightMode) {
  ZynthSliderView *slider = (__bridge ZynthSliderView *)YGNodeGetContext(node);
  if (![slider isKindOfClass:[ZynthSliderView class]]) {
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

static double ZynthSliderParseDouble(id value) {
  if ([value respondsToSelector:@selector(doubleValue)]) {
    return [value doubleValue];
  }
  return 0.0;
}

static BOOL ZynthSliderHandleSetProp(SNUIManager *manager,
                                    SNNode *node,
                                    NSString *name,
                                    id value,
                                    NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[ZynthSliderView class]]) return NO;
  ZynthSliderView *sliderView = (ZynthSliderView *)node.view;

  if ([name isEqualToString:@"value"]) {
    [sliderView zynth_setValue:ZynthSliderParseDouble(value)];
    return YES;
  }

  if ([name isEqualToString:@"minimumValue"] || [name isEqualToString:@"min"]) {
    [sliderView zynth_setMinimumValue:ZynthSliderParseDouble(value)];
    return YES;
  }

  if ([name isEqualToString:@"maximumValue"] || [name isEqualToString:@"max"]) {
    [sliderView zynth_setMaximumValue:ZynthSliderParseDouble(value)];
    return YES;
  }

  if ([name isEqualToString:@"step"]) {
    [sliderView zynth_setStep:ZynthSliderParseDouble(value)];
    return YES;
  }

  if ([name isEqualToString:@"disabled"]) {
    BOOL disabled = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
    [sliderView zynth_setDisabled:disabled];
    return YES;
  }

  if ([name isEqualToString:@"minimumTrackTintColor"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = SNColorFromHex((NSString *)value);
    }
    [sliderView zynth_setMinimumTrackColor:color];
    return YES;
  }

  if ([name isEqualToString:@"maximumTrackTintColor"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = SNColorFromHex((NSString *)value);
    }
    [sliderView zynth_setMaximumTrackColor:color];
    return YES;
  }

  if ([name isEqualToString:@"thumbTintColor"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = SNColorFromHex((NSString *)value);
    }
    [sliderView zynth_setThumbTintColor:color];
    return YES;
  }

  if ([name isEqualToString:@"pointerEvents"]) {
    NSString *mode = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    sliderView.pointerMode = ZynthPointerEventsFromString(mode);
    return YES;
  }

  return NO;
}

static BOOL ZynthSliderHandleSetHandler(SNUIManager *manager,
                                       SNNode *node,
                                       NSString *name) {
  if (!node || ![node.view isKindOfClass:[ZynthSliderView class]]) return NO;
  ZynthSliderView *sliderView = (ZynthSliderView *)node.view;

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
      [strongManager zynth_dispatchEvent:@"onValueChange" payload:payload toNode:strongNode];
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
      [strongManager zynth_dispatchEvent:@"onSlidingComplete" payload:payload toNode:strongNode];
    };
    return YES;
  }

  return NO;
}

@implementation SNUIManager (SliderComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    ZynthComponentDescriptor *descriptor = [[ZynthComponentDescriptor alloc] initWithType:@"slider-view"];
    descriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      return [ZynthSliderView new];
    };
    descriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[ZynthSliderView class]]) return;
      ZynthSliderView *sliderView = (ZynthSliderView *)node.view;
      sliderView.nodeId = node ? node.nid : -1;

      if (node.yoga) {
        YGNodeSetContext(node.yoga, (__bridge void *)sliderView);
        YGNodeSetMeasureFunc(node.yoga, ZynthSliderMeasureFunc);
      }
    };
    descriptor.handleSetProp = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name, id value, NSString *rawJSON) {
      return ZynthSliderHandleSetProp(manager, node, name, value, rawJSON);
    };
    descriptor.handleSetHandler = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name) {
      return ZynthSliderHandleSetHandler(manager, node, name);
    };
    ZynthRegisterComponentDescriptor(descriptor);
  });
}

@end
