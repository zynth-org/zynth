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

#import "RuneProgressIndicatorView.h"
#import <yoga/Yoga.h>

#pragma mark - Yoga Measure Function

static YGSize RuneProgressIndicatorMeasureFunc(YGNodeConstRef node,
                                                float width,
                                                YGMeasureMode widthMode,
                                                float height,
                                                YGMeasureMode heightMode) {
  RuneProgressIndicatorView *indicator = (__bridge RuneProgressIndicatorView *)YGNodeGetContext(node);
  if (![indicator isKindOfClass:[RuneProgressIndicatorView class]]) {
    return (YGSize){.width = 20, .height = 20};
  }
  
  CGFloat indicatorSize = [indicator rune_indicatorSize];
  
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

static BOOL RuneProgressIndicatorHandleSetProp(SNUIManager *manager,
                                               SNNode *node,
                                               NSString *name,
                                               id value,
                                               NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[RuneProgressIndicatorView class]]) {
    return NO;
  }
  RuneProgressIndicatorView *indicator = (RuneProgressIndicatorView *)node.view;

  if ([name isEqualToString:@"color"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = SNColorFromHex((NSString *)value);
    }
    [indicator rune_setColor:color];
    return YES;
  }

  if ([name isEqualToString:@"size"]) {
    NSString *size = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    [indicator rune_setSize:size];
    // Mark yoga node dirty to trigger re-measure
    if (node.yoga) {
      YGNodeMarkDirty(node.yoga);
    }
    [manager rune_markNeedsFlush];
    return YES;
  }

  if ([name isEqualToString:@"animating"]) {
    BOOL animating = value && value != (id)[NSNull null] ? [value boolValue] : YES;
    [indicator rune_setAnimating:animating];
    return YES;
  }

  if ([name isEqualToString:@"pointerEvents"]) {
    NSString *mode = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    indicator.pointerMode = RunePointerEventsFromString(mode);
    return YES;
  }

  return NO;
}

@implementation SNUIManager (ProgressIndicatorComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    RuneComponentDescriptor *descriptor = [[RuneComponentDescriptor alloc] initWithType:@"progress-indicator"];
    descriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      RuneProgressIndicatorView *indicator = [RuneProgressIndicatorView new];
      return indicator;
    };
    descriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[RuneProgressIndicatorView class]]) return;
      RuneProgressIndicatorView *indicator = (RuneProgressIndicatorView *)node.view;
      indicator.nodeId = node ? node.nid : -1;
      
      // Set up Yoga measure function for proper layout sizing
      if (node.yoga) {
        YGNodeSetContext(node.yoga, (__bridge void *)indicator);
        YGNodeSetMeasureFunc(node.yoga, RuneProgressIndicatorMeasureFunc);
      }
    };
    descriptor.handleSetProp = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name, id value, NSString *rawJSON) {
      return RuneProgressIndicatorHandleSetProp(manager, node, name, value, rawJSON);
    };
    RuneRegisterComponentDescriptor(descriptor);
  });
}

@end
