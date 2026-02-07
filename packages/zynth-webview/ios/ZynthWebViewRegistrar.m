#import <Foundation/Foundation.h>

#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthComponentRegistry.h"
#import "ZynthUIManager.h"
#import "ZynthNode.h"
#endif

@class ZynthWebViewView;

@interface ZynthWebViewView : UIView
- (void)bindWithManager:(ZynthUIManager *)manager node:(ZynthNode *)node;
- (void)setSourceDictionary:(NSDictionary *)source;
- (void)setJavaScriptEnabledValue:(BOOL)enabled;
- (void)setUserAgentValue:(NSString * _Nullable)userAgent;
- (void)handleCommand:(NSDictionary *)command;
- (void)cleanup;
@end

@interface ZynthWebViewRegistrar : NSObject
@end

static NSString *ZynthWebViewNormalizeJSONString(NSString *value) {
  if ([value rangeOfString:@"\\\""].location == NSNotFound) {
    return value;
  }
  NSMutableString *normalized = [value mutableCopy];
  [normalized replaceOccurrencesOfString:@"\\\"" withString:@"\"" options:0 range:NSMakeRange(0, normalized.length)];
  return normalized;
}

static NSDictionary *ZynthWebViewParseObject(NSString *rawJSON) {
  if (rawJSON.length == 0) return nil;
  NSString *value = [rawJSON stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (value.length == 0 || [value isEqualToString:@"null"]) return nil;

  NSString *normalized = ZynthWebViewNormalizeJSONString(value);
  if ([normalized hasPrefix:@"\""] && [normalized hasSuffix:@"\""] && normalized.length >= 2) {
    normalized = [normalized substringWithRange:NSMakeRange(1, normalized.length - 2)];
    normalized = ZynthWebViewNormalizeJSONString(normalized);
  }

  NSData *data = [normalized dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) return nil;

  NSError *error = nil;
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingAllowFragments error:&error];
  if (error) {
    NSLog(@"[ZynthWebView] parseObject error=%@ raw=%@", error.localizedDescription, rawJSON);
    return nil;
  }
  if ([parsed isKindOfClass:[NSDictionary class]]) {
    return (NSDictionary *)parsed;
  }
  NSLog(@"[ZynthWebView] parseObject produced non-dictionary: %@", NSStringFromClass([parsed class]));
  return nil;
}

static NSDictionary *ZynthWebViewParseObjectValue(id value, NSString *rawJSON) {
  if ([value isKindOfClass:[NSDictionary class]]) {
    NSLog(@"[ZynthWebView] parseObjectValue using NSDictionary value");
    return (NSDictionary *)value;
  }
  if ([value isKindOfClass:[NSString class]]) {
    NSLog(@"[ZynthWebView] parseObjectValue using NSString value length=%lu", (unsigned long)[((NSString *)value) length]);
    NSDictionary *fromValue = ZynthWebViewParseObject((NSString *)value);
    if (fromValue) return fromValue;
  }
  if (rawJSON.length > 0) {
    NSLog(@"[ZynthWebView] parseObjectValue falling back to rawJSON length=%lu", (unsigned long)rawJSON.length);
  }
  return ZynthWebViewParseObject(rawJSON);
}

@implementation ZynthWebViewRegistrar : NSObject

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    ZynthComponentDescriptor *descriptor = [[ZynthComponentDescriptor alloc] initWithType:@"zynth-webview"];

    descriptor.createView = ^UIView * _Nullable(ZynthUIManager * _Nonnull manager, NSString * _Nonnull type) {
      return [[ZynthWebViewView alloc] init];
    };

    descriptor.attach = ^(ZynthUIManager * _Nonnull manager, ZynthNode * _Nonnull node) {
      if ([node.view isKindOfClass:[ZynthWebViewView class]]) {
        [(ZynthWebViewView *)node.view bindWithManager:manager node:node];
      }
    };

    descriptor.handleSetHandler = ^BOOL(ZynthUIManager * _Nonnull manager,
                                        ZynthNode * _Nonnull node,
                                        NSString * _Nonnull name) {
      if ([name isEqualToString:@"onNativeReady"]) {
        [manager zynth_dispatchEvent:@"onNativeReady"
                             payload:@{ @"available": @YES }
                              toNode:node];
        return YES;
      }
      return NO;
    };

    descriptor.handleSetProp = ^BOOL(ZynthUIManager * _Nonnull manager,
                                     ZynthNode * _Nonnull node,
                                     NSString * _Nonnull name,
                                     id _Nullable value,
                                     NSString * _Nonnull rawJSON) {
      if (![node.view isKindOfClass:[ZynthWebViewView class]]) {
        return NO;
      }

      ZynthWebViewView *view = (ZynthWebViewView *)node.view;

      if ([name isEqualToString:@"source"]) {
        NSLog(@"[ZynthWebView] handleSetProp source valueClass=%@ rawJSONLength=%lu",
              value ? NSStringFromClass([value class]) : @"(null)",
              (unsigned long)rawJSON.length);
        NSDictionary *source = ZynthWebViewParseObjectValue(value, rawJSON);
        if ([source isKindOfClass:[NSDictionary class]]) {
          NSLog(@"[ZynthWebView] source parsed keys=%@", [[source allKeys] componentsJoinedByString:@","]);
          [view setSourceDictionary:source];
        } else {
          NSLog(@"[ZynthWebView] source parse failed");
        }
        return YES;
      }

      if ([name isEqualToString:@"javaScriptEnabled"]) {
        BOOL enabled = YES;
        if ([value isKindOfClass:[NSNumber class]]) {
          enabled = [(NSNumber *)value boolValue];
        }
        [view setJavaScriptEnabledValue:enabled];
        return YES;
      }

      if ([name isEqualToString:@"userAgent"]) {
        if ([value isKindOfClass:[NSString class]]) {
          [view setUserAgentValue:(NSString *)value];
        } else {
          [view setUserAgentValue:nil];
        }
        return YES;
      }

      if ([name isEqualToString:@"command"]) {
        NSLog(@"[ZynthWebView] handleSetProp command valueClass=%@ rawJSONLength=%lu",
              value ? NSStringFromClass([value class]) : @"(null)",
              (unsigned long)rawJSON.length);
        NSDictionary *command = ZynthWebViewParseObjectValue(value, rawJSON);
        if ([command isKindOfClass:[NSDictionary class]]) {
          NSLog(@"[ZynthWebView] command parsed=%@", command);
          [view handleCommand:command];
        } else {
          NSLog(@"[ZynthWebView] command parse failed");
        }
        return YES;
      }

      if ([name isEqualToString:@"onLoadStart"] ||
          [name isEqualToString:@"onLoad"] ||
          [name isEqualToString:@"onLoadEnd"] ||
          [name isEqualToString:@"onError"] ||
          [name isEqualToString:@"onMessage"] ||
          [name isEqualToString:@"onNavigationStateChange"] ||
          [name isEqualToString:@"onNativeReady"]) {
        return YES;
      }

      return NO;
    };

    descriptor.cleanup = ^(ZynthUIManager * _Nonnull manager, ZynthNode * _Nonnull node) {
      if ([node.view isKindOfClass:[ZynthWebViewView class]]) {
        [(ZynthWebViewView *)node.view cleanup];
      }
    };

    ZynthRegisterComponentDescriptor(descriptor);
  });
}

@end
