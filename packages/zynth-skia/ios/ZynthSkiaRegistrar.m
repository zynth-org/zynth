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
- (void)markSurfaceReady;
- (void)resetSurface;
- (void)invalidateSurface;
- (void)setFrameLoopEnabled:(BOOL)enabled;
- (void)setAllowFallback:(BOOL)enabled;
- (void)setClearColor:(NSString *_Nullable)raw;
- (void)submitCommands:(NSArray<NSDictionary *> *)rawCommands;
@end

@interface ZynthSkiaViewRegistry : NSObject
+ (instancetype)sharedInstance;
- (void)unregisterWithNodeId:(int)nodeId;
@end

@interface ZynthSkiaRegistrar : NSObject
@end

static NSString *ZynthSkiaNormalizeJSONString(NSString *value) {
  if ([value rangeOfString:@"\\\""].location == NSNotFound) {
    return value;
  }
  NSMutableString *normalized = [value mutableCopy];
  [normalized replaceOccurrencesOfString:@"\\\"" withString:@"\"" options:0 range:NSMakeRange(0, normalized.length)];
  return normalized;
}

static id ZynthSkiaParseJSON(NSString *rawJSON) {
  if (rawJSON.length == 0) return nil;
  NSString *value = [rawJSON stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (value.length == 0 || [value isEqualToString:@"null"]) return nil;

  NSString *normalized = ZynthSkiaNormalizeJSONString(value);
  if ([normalized hasPrefix:@"\""] && [normalized hasSuffix:@"\""] && normalized.length >= 2) {
    normalized = [normalized substringWithRange:NSMakeRange(1, normalized.length - 2)];
    normalized = ZynthSkiaNormalizeJSONString(normalized);
  }

  NSData *data = [normalized dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) return nil;

  NSError *error = nil;
  return [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingAllowFragments error:&error];
}

@implementation ZynthSkiaRegistrar

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

    descriptor.handleSetHandler = ^BOOL(ZynthUIManager * _Nonnull manager,
                                        ZynthNode * _Nonnull node,
                                        NSString * _Nonnull name) {
      if (![node.view isKindOfClass:[ZynthSkiaView class]]) {
        return NO;
      }
      ZynthSkiaView *view = (ZynthSkiaView *)node.view;
      if ([name isEqualToString:@"onNativeReady"]) {
        [view markSurfaceReady];
        return YES;
      }
      return NO;
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
          [view setClearColor:(NSString *)value];
        } else if ([rawJSON isKindOfClass:[NSString class]]) {
          [view setClearColor:rawJSON];
        }
        return YES;
      }

      if ([name isEqualToString:@"frameLoop"]) {
        BOOL enabled = NO;
        if ([value isKindOfClass:[NSNumber class]]) {
          enabled = [(NSNumber *)value boolValue];
        } else if ([value isKindOfClass:[NSString class]]) {
          NSString *text = [((NSString *)value) lowercaseString];
          enabled = [text isEqualToString:@"true"] || [text isEqualToString:@"1"];
        }
        [view setFrameLoopEnabled:enabled];
        return YES;
      }

      if ([name isEqualToString:@"allowFallback"]) {
        BOOL enabled = YES;
        if ([value isKindOfClass:[NSNumber class]]) {
          enabled = [(NSNumber *)value boolValue];
        } else if ([value isKindOfClass:[NSString class]]) {
          NSString *text = [((NSString *)value) lowercaseString];
          enabled = [text isEqualToString:@"true"] || [text isEqualToString:@"1"];
        }
        [view setAllowFallback:enabled];
        return YES;
      }

      if ([name isEqualToString:@"commands"]) {
        id parsed = nil;
        if ([value isKindOfClass:[NSArray class]]) {
          parsed = value;
        } else if ([value isKindOfClass:[NSString class]]) {
          parsed = ZynthSkiaParseJSON((NSString *)value);
        } else {
          parsed = ZynthSkiaParseJSON(rawJSON);
        }
        if ([parsed isKindOfClass:[NSArray class]]) {
          [view submitCommands:(NSArray<NSDictionary *> *)parsed];
        } else {
          [view submitCommands:@[]];
        }
        return YES;
      }

      if ([name isEqualToString:@"onNativeReady"]) {
        return YES;
      }

      return NO;
    };

    descriptor.cleanup = ^(ZynthUIManager * _Nonnull manager, ZynthNode * _Nonnull node) {
      if ([node.view isKindOfClass:[ZynthSkiaView class]]) {
        ZynthSkiaView *view = (ZynthSkiaView *)node.view;
        [view resetSurface];
      }
      [[ZynthSkiaViewRegistry sharedInstance] unregisterWithNodeId:node.nid];
    };

    ZynthRegisterComponentDescriptor(descriptor);
  });
}

@end
