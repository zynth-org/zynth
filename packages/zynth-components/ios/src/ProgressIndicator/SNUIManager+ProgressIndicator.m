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

#import "ZynthProgressIndicatorView.h"
#import <yoga/Yoga.h>

#pragma mark - Yoga Measure Function

static YGSize ZynthProgressIndicatorMeasureFunc(YGNodeConstRef node,
                                                float width,
                                                YGMeasureMode widthMode,
                                                float height,
                                                YGMeasureMode heightMode) {
  ZynthProgressIndicatorView *indicator = (__bridge ZynthProgressIndicatorView *)YGNodeGetContext(node);
  if (![indicator isKindOfClass:[ZynthProgressIndicatorView class]]) {
    return (YGSize){.width = 20, .height = 20};
  }
  
  CGFloat indicatorSize = [indicator zynth_indicatorSize];
  
  float outW;
  switch (widthMode) {
    case YGMeasureModeExactly: outW = width; break;
    case YGMeasureModeAtMost: outW = MIN((float)indicatorSize, width); break;
    default: outW = (float)indicatorSize; break;
  }
  
  float outH;
  switch (heightMode) {
    case YGMeasureModeExactly: outH = height; break;
    case YGMeasureModeAtMost: outH = MIN((float)indicatorSize, height); break;
    default: outH = (float)indicatorSize; break;
  }
  
  return (YGSize){.width = outW, .height = outH};
}

#pragma mark - Property Handling

static BOOL ZynthProgressIndicatorHandleSetProp(SNUIManager *manager,
                                               SNNode *node,
                                               NSString *name,
                                               id value,
                                               NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[ZynthProgressIndicatorView class]]) {
    return NO;
  }
  ZynthProgressIndicatorView *indicator = (ZynthProgressIndicatorView *)node.view;

  if ([name isEqualToString:@"color"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = SNColorFromHex((NSString *)value);
    }
    [indicator zynth_setColor:color];
    return YES;
  }

  if ([name isEqualToString:@"size"]) {
    NSString *size = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [indicator zynth_setSize:size];
    // Mark yoga node dirty to trigger re-measure
    if (node.yoga) {
      YGNodeMarkDirty(node.yoga);
    }
    [manager zynth_markNeedsFlush];
    return YES;
  }

  if ([name isEqualToString:@"animating"]) {
    BOOL animating = value && value != (id)[NSNull null] ? [value boolValue] : YES;
    [indicator zynth_setAnimating:animating];
    return YES;
  }

  if ([name isEqualToString:@"pointerEvents"]) {
    NSString *mode = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    indicator.pointerMode = ZynthPointerEventsFromString(mode);
    return YES;
  }

  return NO;
}

@implementation SNUIManager (ProgressIndicatorComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    ZynthComponentDescriptor *descriptor = [[ZynthComponentDescriptor alloc] initWithType:@"progress-indicator"];
    descriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      ZynthProgressIndicatorView *indicator = [ZynthProgressIndicatorView new];
      return indicator;
    };
    descriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[ZynthProgressIndicatorView class]]) return;
      ZynthProgressIndicatorView *indicator = (ZynthProgressIndicatorView *)node.view;
      indicator.nodeId = node ? node.nid : -1;
      
      // Set up Yoga measure function for proper layout sizing
      if (node.yoga) {
        YGNodeSetContext(node.yoga, (__bridge void *)indicator);
        YGNodeSetMeasureFunc(node.yoga, ZynthProgressIndicatorMeasureFunc);
      }
    };
    descriptor.handleSetProp = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name, id value, NSString *rawJSON) {
      return ZynthProgressIndicatorHandleSetProp(manager, node, name, value, rawJSON);
    };
    ZynthRegisterComponentDescriptor(descriptor);
  });
}

@end
