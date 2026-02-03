#import <Foundation/Foundation.h>

#if __has_include(<ZynthComponents/ZynthComponents-Swift.h>)
#import <ZynthComponents/ZynthComponents-Swift.h>
#else
#import "ZynthComponents-Swift.h"
#endif

#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthKit.h"
#endif

#import "ZynthComponentRegistry.h"
#import "ZynthNode.h"

static NSString *ZynthBottomSheetNormalizeJSONString(NSString *value) {
  if ([value rangeOfString:@"\\\""].location == NSNotFound) {
    return value;
  }
  NSMutableString *normalized = [value mutableCopy];
  [normalized replaceOccurrencesOfString:@"\\\"" withString:@"\"" options:0 range:NSMakeRange(0, normalized.length)];
  return normalized;
}

static id ZynthBottomSheetParseJSON(NSString *rawJSON) {
  if (rawJSON.length == 0) return nil;
  NSString *value = [rawJSON stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (value.length == 0 || [value isEqualToString:@"null"]) return nil;
  NSString *normalized = ZynthBottomSheetNormalizeJSONString(value);
  if ([normalized hasPrefix:@"\""] && [normalized hasSuffix:@"\""] && normalized.length >= 2) {
    normalized = [normalized substringWithRange:NSMakeRange(1, normalized.length - 2)];
    normalized = ZynthBottomSheetNormalizeJSONString(normalized);
  }
  NSData *data = [normalized dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) return nil;
  NSError *error = nil;
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingAllowFragments error:&error];
  if (error) {
    return nil;
  }
  return parsed;
}

static NSInteger ZynthBottomSheetParseInteger(NSString *rawJSON, NSInteger fallback) {
  id parsed = ZynthBottomSheetParseJSON(rawJSON);
  if ([parsed isKindOfClass:[NSNumber class]]) {
    return [(NSNumber *)parsed integerValue];
  }
  if ([parsed isKindOfClass:[NSString class]]) {
    return [(NSString *)parsed integerValue];
  }
  return fallback;
}

static BOOL ZynthBottomSheetParseBoolean(NSString *rawJSON, BOOL fallback) {
  id parsed = ZynthBottomSheetParseJSON(rawJSON);
  if ([parsed isKindOfClass:[NSNumber class]]) {
    return [(NSNumber *)parsed boolValue];
  }
  if ([parsed isKindOfClass:[NSString class]]) {
    NSString *lower = [(NSString *)parsed lowercaseString];
    if ([lower isEqualToString:@"true"]) return YES;
    if ([lower isEqualToString:@"false"]) return NO;
  }
  return fallback;
}

@implementation ZynthUIManager (BottomSheet)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    ZynthComponentDescriptor *descriptor = [[ZynthComponentDescriptor alloc] initWithType:@"zynth-bottom-sheet"];

    descriptor.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      if (@available(iOS 16.0, *)) {
        return [[ZynthBottomSheetView alloc] init];
      }
      return [UIView new];
    };

    descriptor.attach = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (@available(iOS 16.0, *)) {
        if (![node.view isKindOfClass:[ZynthBottomSheetView class]]) return;
        ZynthBottomSheetView *view = (ZynthBottomSheetView *)node.view;
        [view bindWithManager:manager node:node];
      }
    };

    descriptor.cleanup = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (@available(iOS 16.0, *)) {
        if (![node.view isKindOfClass:[ZynthBottomSheetView class]]) return;
        ZynthBottomSheetView *view = (ZynthBottomSheetView *)node.view;
        [view reset];
      }
    };

    descriptor.handleSetProp = ^BOOL(ZynthUIManager *manager,
                                     ZynthNode *node,
                                     NSString *name,
                                     id value,
                                     NSString *rawJSON) {
      if (@available(iOS 16.0, *)) {
        if (![node.view isKindOfClass:[ZynthBottomSheetView class]]) return NO;
        ZynthBottomSheetView *view = (ZynthBottomSheetView *)node.view;

        if ([name isEqualToString:@"snapPoints"]) {
          id parsed = ZynthBottomSheetParseJSON(rawJSON);
          if ([parsed isKindOfClass:[NSArray class]]) {
            [view updateSnapPoints:(NSArray *)parsed];
          }
          return YES;
        }

        if ([name isEqualToString:@"initialSnapIndex"]) {
          NSInteger index = ZynthBottomSheetParseInteger(rawJSON, 0);
          [view setInitialSnapIndex:@(index)];
          return YES;
        }

        if ([name isEqualToString:@"allowBackgroundInteraction"]) {
          BOOL allow = ZynthBottomSheetParseBoolean(rawJSON, NO);
          [view setAllowBackgroundInteraction:@(allow)];
          return YES;
        }

        if ([name isEqualToString:@"allowDismissOnInteraction"]) {
          BOOL allow = ZynthBottomSheetParseBoolean(rawJSON, YES);
          [view setAllowDismissOnInteraction:@(allow)];
          return YES;
        }

        if ([name isEqualToString:@"open"]) {
          BOOL open = ZynthBottomSheetParseBoolean(rawJSON, NO);
          [view setOpenState:@(open)];
          return YES;
        }

        if ([name isEqualToString:@"__command"]) {
          id parsed = ZynthBottomSheetParseJSON(rawJSON);
          if ([parsed isKindOfClass:[NSDictionary class]]) {
            [view handleCommand:(NSDictionary *)parsed];
          }
          return YES;
        }
      }
      return NO;
    };

    descriptor.handleSetHandler = ^BOOL(ZynthUIManager *manager, ZynthNode *node, NSString *name) {
      return [name isEqualToString:@"onOpenChange"]
        || [name isEqualToString:@"onDismiss"]
        || [name isEqualToString:@"onSnapChange"];
    };

    ZynthRegisterComponentDescriptor(descriptor);
  });
}

@end
