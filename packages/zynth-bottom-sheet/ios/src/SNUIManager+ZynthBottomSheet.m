#import "SNUIManager+ZynthBottomSheet.h"

#if __has_include(<ZynthBottomSheet/ZynthBottomSheet-Swift.h>)
#import <ZynthBottomSheet/ZynthBottomSheet-Swift.h>
#else
#import "ZynthBottomSheet-Swift.h"
#endif

#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthKit.h"
#endif

#import "ZynthComponentRegistry.h"
#import "SNNode.h"

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
    NSLog(@"[ZynthBottomSheet] Failed to parse JSON '%@' error=%@", rawJSON, error);
    return nil;
  }
  return parsed;
}

static NSInteger ZynthBottomSheetParseInteger(NSString *rawJSON, NSInteger fallback) {
  id parsed = ZynthBottomSheetParseJSON(rawJSON);
  if ([parsed isKindOfClass:[NSNumber class]]) {
    return ((NSNumber *)parsed).integerValue;
  }
  if ([parsed isKindOfClass:[NSString class]]) {
    return [(NSString *)parsed integerValue];
  }
  return fallback;
}

static CGFloat ZynthBottomSheetParseCGFloat(NSString *rawJSON, CGFloat fallback) {
  id parsed = ZynthBottomSheetParseJSON(rawJSON);
  if ([parsed isKindOfClass:[NSNumber class]]) {
    return ((NSNumber *)parsed).doubleValue;
  }
  if ([parsed isKindOfClass:[NSString class]]) {
    return [(NSString *)parsed doubleValue];
  }
  return fallback;
}

static BOOL ZynthBottomSheetParseBoolean(NSString *rawJSON, BOOL fallback) {
  id parsed = ZynthBottomSheetParseJSON(rawJSON);
  if ([parsed isKindOfClass:[NSNumber class]]) {
    return ((NSNumber *)parsed).boolValue;
  }
  if ([parsed isKindOfClass:[NSString class]]) {
    NSString *lower = [(NSString *)parsed lowercaseString];
    if ([lower isEqualToString:@"true"]) return YES;
    if ([lower isEqualToString:@"false"]) return NO;
    return fallback;
  }
  return fallback;
}

@implementation SNUIManager (ZynthBottomSheet)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    ZynthComponentDescriptor *descriptor = [[ZynthComponentDescriptor alloc] initWithType:@"zynth-bottom-sheet"];
    descriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      if (@available(iOS 16.0, *)) {
        ZynthBottomSheetView *view = [[ZynthBottomSheetView alloc] init];
        return view;
      }
      
      return [UIView new];
    };
    descriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (@available(iOS 16.0, *)) {
        if (![node.view isKindOfClass:[ZynthBottomSheetView class]]) return;
        ZynthBottomSheetView *view = (ZynthBottomSheetView *)node.view;
        [view bindWithManager:manager node:node];
      }
    };
    descriptor.cleanup = ^(SNUIManager *manager, SNNode *node) {
      if (@available(iOS 16.0, *)) {
        if (![node.view isKindOfClass:[ZynthBottomSheetView class]]) return;
        ZynthBottomSheetView *view = (ZynthBottomSheetView *)node.view;
        [view reset];
      }
    };
    descriptor.handleSetProp = ^BOOL(SNUIManager *manager,
                                     SNNode *node,
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
          } else {
            [view updateSnapPoints:nil];
          }
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

        if ([name isEqualToString:@"showOverlay"]) {
          
          BOOL showOverlay = ZynthBottomSheetParseBoolean(rawJSON, YES);
          [view setShowOverlay:@(showOverlay)];
          return YES;
        }

        if ([name isEqualToString:@"dismissOnOverlayPress"]) {
          
          BOOL dismiss = ZynthBottomSheetParseBoolean(rawJSON, YES);
          [view setDismissOnOverlayPress:@(dismiss)];
          return YES;
        }

        if ([name isEqualToString:@"allowDismissOnInteraction"]) {
          
          BOOL allow = ZynthBottomSheetParseBoolean(rawJSON, YES);
          [view setAllowDismissOnInteraction:@(allow)];
          return YES;
        }

        if ([name isEqualToString:@"allowBackgroundInteraction"]) {
          
          BOOL allowBackground = ZynthBottomSheetParseBoolean(rawJSON, NO);
          [view setAllowBackgroundInteraction:@(allowBackground)];
          return YES;
        }

        if ([name isEqualToString:@"initialSnapIndex"]) {
          
          NSInteger index = ZynthBottomSheetParseInteger(rawJSON, 0);
          [view setInitialSnapIndex:@(index)];
          return YES;
        }

        if ([name isEqualToString:@"open"]) {
          
          BOOL isOpen = ZynthBottomSheetParseBoolean(rawJSON, NO);
          [view setOpenState:@(isOpen)];
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

    descriptor.handleSetHandler = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name) {
      if (@available(iOS 16.0, *)) {
        return [name isEqualToString:@"onSnapChange"] ||
               [name isEqualToString:@"onDismiss"] ||
               [name isEqualToString:@"onOpenChange"];
      }
      return NO;
    };

    ZynthRegisterComponentDescriptor(descriptor);
  });
}

@end
