#import <Foundation/Foundation.h>

#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthComponentRegistry.h"
#import "ZynthUIManager.h"
#import "ZynthNode.h"
#import "ZynthComponentAPI.h"
#endif

@class ZynthGestureDetectorView;

@interface ZynthGestureDetectorView : UIView
- (void)bindWithManager:(ZynthUIManager *)manager node:(ZynthNode *)node;
- (void)setLongPressMinDurationMsValue:(double)value;
- (void)setFlingMinVelocityValue:(double)value;
- (void)setPanSharedSignalXValue:(NSInteger)value;
- (void)setPanSharedSignalYValue:(NSInteger)value;
- (void)enableEventWithName:(NSString *)name;
- (void)cleanup;
@end

@interface ZynthGestureHandlerRegistrar : NSObject
@end

@implementation ZynthGestureHandlerRegistrar

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    ZynthComponentDescriptor *descriptor =
        [[ZynthComponentDescriptor alloc] initWithType:@"zynth-gesture-detector"];

    descriptor.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      return [[ZynthGestureDetectorView alloc] init];
    };

    descriptor.attach = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[ZynthGestureDetectorView class]]) return;
      [(ZynthGestureDetectorView *)node.view bindWithManager:manager node:node];
    };

    descriptor.handleSetHandler = ^BOOL(ZynthUIManager *manager,
                                        ZynthNode *node,
                                        NSString *name) {
      if (![node.view isKindOfClass:[ZynthGestureDetectorView class]]) return NO;
      if ([name isEqualToString:@"onTapGesture"] ||
          [name isEqualToString:@"onLongPressGesture"] ||
          [name isEqualToString:@"onRotationGesture"] ||
          [name isEqualToString:@"onPinchGesture"] ||
          [name isEqualToString:@"onFlingGesture"] ||
          [name isEqualToString:@"onPanGesture"]) {
        [(ZynthGestureDetectorView *)node.view enableEventWithName:name];
        return YES;
      }
      return NO;
    };

    descriptor.handleSetProp = ^BOOL(ZynthUIManager *manager,
                                     ZynthNode *node,
                                     NSString *name,
                                     id value,
                                     NSString *rawJSON) {
      (void)manager;
      (void)rawJSON;
      if (![node.view isKindOfClass:[ZynthGestureDetectorView class]]) return NO;
      ZynthGestureDetectorView *view = (ZynthGestureDetectorView *)node.view;

      if ([name isEqualToString:@"longPressMinDurationMs"]) {
        double duration = 500.0;
        if ([value isKindOfClass:[NSNumber class]]) {
          duration = [(NSNumber *)value doubleValue];
        } else if ([value isKindOfClass:[NSString class]]) {
          duration = [(NSString *)value doubleValue];
        }
        [view setLongPressMinDurationMsValue:duration];
        return YES;
      }

      if ([name isEqualToString:@"flingMinVelocity"]) {
        double velocity = 800.0;
        if ([value isKindOfClass:[NSNumber class]]) {
          velocity = [(NSNumber *)value doubleValue];
        } else if ([value isKindOfClass:[NSString class]]) {
          velocity = [(NSString *)value doubleValue];
        }
        [view setFlingMinVelocityValue:velocity];
        return YES;
      }

      if ([name isEqualToString:@"panSharedSignalX"] ||
          [name isEqualToString:@"panSharedSignalY"]) {
        NSInteger signalId = 0;
        if ([value isKindOfClass:[NSNumber class]]) {
          signalId = [(NSNumber *)value integerValue];
        } else if ([value isKindOfClass:[NSString class]]) {
          signalId = [(NSString *)value integerValue];
        }
        if ([name isEqualToString:@"panSharedSignalX"]) {
          [view setPanSharedSignalXValue:signalId];
        } else {
          [view setPanSharedSignalYValue:signalId];
        }
        return YES;
      }

      if ([name isEqualToString:@"onTapGesture"] ||
          [name isEqualToString:@"onLongPressGesture"] ||
          [name isEqualToString:@"onRotationGesture"] ||
          [name isEqualToString:@"onPinchGesture"] ||
          [name isEqualToString:@"onFlingGesture"] ||
          [name isEqualToString:@"onPanGesture"]) {
        return YES;
      }

      return NO;
    };

    descriptor.cleanup = ^(ZynthUIManager *manager, ZynthNode *node) {
      (void)manager;
      if (![node.view isKindOfClass:[ZynthGestureDetectorView class]]) return;
      [(ZynthGestureDetectorView *)node.view cleanup];
    };

    ZynthRegisterComponentDescriptor(descriptor);
  });
}

@end
