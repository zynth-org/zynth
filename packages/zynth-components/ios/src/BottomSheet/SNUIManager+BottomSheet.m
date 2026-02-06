#import <Foundation/Foundation.h>
#import <math.h>

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

static BOOL ZynthBottomSheetParseBoolean(NSString *rawJSON, id value, BOOL fallback) {
  if ([value isKindOfClass:[NSNumber class]]) {
    return [((NSNumber *)value) boolValue];
  }

  id parsed = ZynthBottomSheetParseJSON(rawJSON);
  if ([parsed isKindOfClass:[NSNumber class]]) {
    BOOL result = ((NSNumber *)parsed).boolValue;
    NSLog(@"[ZynthBottomSheet] Parsed boolean from NSNumber: %d (rawJSON: %@)", result, rawJSON);
    return result;
  }
  if ([parsed isKindOfClass:[NSString class]]) {
    NSString *lower = [(NSString *)parsed lowercaseString];
    if ([lower isEqualToString:@"true"]) {
      NSLog(@"[ZynthBottomSheet] Parsed boolean 'true' from string (rawJSON: %@)", rawJSON);
      return YES;
    }
    if ([lower isEqualToString:@"false"]) {
      NSLog(@"[ZynthBottomSheet] Parsed boolean 'false' from string (rawJSON: %@)", rawJSON);
      return NO;
    }
    NSLog(@"[ZynthBottomSheet] Failed to parse boolean from string '%@', using fallback: %d", (NSString *)parsed, fallback);
    return fallback;
  }
  
  if (value != nil && value != [NSNull null]) {
     NSLog(@"[ZynthBottomSheet] Fallback to value.boolValue for value: %@", value);
     return [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : fallback;
  }

  NSLog(@"[ZynthBottomSheet] Failed to parse boolean (rawJSON is %@, value is %@), using fallback: %d", rawJSON, value, fallback);
  return fallback;
}

static CGFloat ZynthBottomSheetParseCGFloat(NSString *rawJSON, CGFloat fallback) {
  id parsed = ZynthBottomSheetParseJSON(rawJSON);
  if ([parsed isKindOfClass:[NSNumber class]]) {
    return [(NSNumber *)parsed doubleValue];
  }
  if ([parsed isKindOfClass:[NSString class]]) {
    return [(NSString *)parsed doubleValue];
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

        if ([name isEqualToString:@"overlayColor"]) {
          id parsed = ZynthBottomSheetParseJSON(rawJSON);
          if ([parsed isKindOfClass:[NSString class]]) {
            [view setOverlayColorString:(NSString *)parsed];
          }
          return YES;
        }

        if ([name isEqualToString:@"overlayOpacity"]) {
          CGFloat opacity = ZynthBottomSheetParseCGFloat(rawJSON, NAN);
          if (!isnan(opacity)) {
            [view setOverlayOpacityValue:@(opacity)];
          }
          return YES;
        }

        if ([name isEqualToString:@"allowBackgroundInteraction"]) {
          BOOL allow = ZynthBottomSheetParseBoolean(rawJSON, value, NO);
          [view setAllowBackgroundInteraction:@(allow)];
          return YES;
        }

        if ([name isEqualToString:@"allowDismissOnInteraction"]) {
          BOOL allow = ZynthBottomSheetParseBoolean(rawJSON, value, YES);
          [view setAllowDismissOnInteraction:@(allow)];
          return YES;
        }

        if ([name isEqualToString:@"dismissOnOverlayPress"]) {
          BOOL allow = ZynthBottomSheetParseBoolean(rawJSON, value, YES);
          [view setDismissOnOverlayPress:@(allow)];
          return YES;
        }

        if ([name isEqualToString:@"open"]) {
          BOOL open = ZynthBottomSheetParseBoolean(rawJSON, value, NO);
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
