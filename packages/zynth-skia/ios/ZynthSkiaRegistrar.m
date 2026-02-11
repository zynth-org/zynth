#import <Foundation/Foundation.h>

#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthComponentRegistry.h"
#import "ZynthUIManager.h"
#import "ZynthNode.h"
#endif

@class ZynthSkiaView;

@interface ZynthSkiaView : UIView
- (void)bindWithManager:(ZynthUIManager *)manager node:(ZynthNode *)node;
- (void)setClearColorValue:(NSString * _Nullable)value;
- (void)setFrameLoopEnabledValue:(BOOL)enabled;
- (void)setAllowFallbackValue:(BOOL)allow;
- (void)setSurfaceAvailable:(BOOL)available;
- (void)emitNativeReady;
- (void)cleanup;
@end

@interface ZynthSkiaRegistrar : NSObject
@end

@implementation ZynthSkiaRegistrar : NSObject

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    ZynthComponentDescriptor *descriptor = [[ZynthComponentDescriptor alloc] initWithType:@"zynth-skia-view"];

    descriptor.createView = ^UIView * _Nullable(ZynthUIManager * _Nonnull manager, NSString * _Nonnull type) {
      return [[ZynthSkiaView alloc] init];
    };

    descriptor.attach = ^(ZynthUIManager * _Nonnull manager, ZynthNode * _Nonnull node) {
      if ([node.view isKindOfClass:[ZynthSkiaView class]]) {
        [(ZynthSkiaView *)node.view bindWithManager:manager node:node];
      }
    };

    descriptor.handleSetProp = ^BOOL(ZynthUIManager * _Nonnull manager,
                                     ZynthNode * _Nonnull node,
                                     NSString * _Nonnull name,
                                     id _Nullable value,
                                     NSString * _Nonnull rawJSON) {
      if (![node.view isKindOfClass:[ZynthSkiaView class]]) {
        return NO;
      }

      ZynthSkiaView *view = (ZynthSkiaView *)node.view;

      if ([name isEqualToString:@"clearColor"]) {
        if ([value isKindOfClass:[NSString class]]) {
          [view setClearColorValue:(NSString *)value];
        } else {
          [view setClearColorValue:nil];
        }
        return YES;
      }

      if ([name isEqualToString:@"frameLoop"]) {
        BOOL enabled = NO;
        if ([value isKindOfClass:[NSNumber class]]) {
          enabled = [(NSNumber *)value boolValue];
        }
        [view setFrameLoopEnabledValue:enabled];
        return YES;
      }

      if ([name isEqualToString:@"allowFallback"]) {
        BOOL allow = YES;
        if ([value isKindOfClass:[NSNumber class]]) {
          allow = [(NSNumber *)value boolValue];
        }
        [view setAllowFallbackValue:allow];
        return YES;
      }

      if ([name isEqualToString:@"commands"]) {
        return YES;
      }

      return NO;
    };

    descriptor.handleSetHandler = ^BOOL(ZynthUIManager * _Nonnull manager,
                                        ZynthNode * _Nonnull node,
                                        NSString * _Nonnull name) {
      if (![node.view isKindOfClass:[ZynthSkiaView class]]) {
        return NO;
      }

      if ([name isEqualToString:@"onNativeReady"]) {
        [(ZynthSkiaView *)node.view emitNativeReady];
        return YES;
      }

      return NO;
    };

    descriptor.cleanup = ^(ZynthUIManager * _Nonnull manager, ZynthNode * _Nonnull node) {
      if ([node.view isKindOfClass:[ZynthSkiaView class]]) {
        [(ZynthSkiaView *)node.view cleanup];
      }
    };

    ZynthRegisterComponentDescriptor(descriptor);
  });
}

@end
