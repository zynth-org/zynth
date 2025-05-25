#import "SNUIManager+RuneBottomSheet.h"

#if __has_include(<RuneBottomSheet/RuneBottomSheet-Swift.h>)
#import <RuneBottomSheet/RuneBottomSheet-Swift.h>
#else
#import "RuneBottomSheet-Swift.h"
#endif

#if __has_include(<RuneKit/RuneKit.h>)
#import <RuneKit/RuneKit.h>
#else
#import "RuneKit.h"
#endif

#import "RuneComponentRegistry.h"
#import "SNNode.h"

static NSString *RuneBottomSheetNormalizeJSONString(NSString *value) {
  if ([value rangeOfString:@"\\\""].location == NSNotFound) {
    return value;
  }
  NSMutableString *normalized = [value mutableCopy];
  [normalized replaceOccurrencesOfString:@"\\\"" withString:@"\"" options:0 range:NSMakeRange(0, normalized.length)];
  return normalized;
}

static id RuneBottomSheetParseJSON(NSString *rawJSON) {
  if (rawJSON.length == 0) return nil;
  NSString *value = [rawJSON stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (value.length == 0 || [value isEqualToString:@"null"]) return nil;
  NSString *normalized = RuneBottomSheetNormalizeJSONString(value);
  if ([normalized hasPrefix:@"\""] && [normalized hasSuffix:@"\""] && normalized.length >= 2) {
    normalized = [normalized substringWithRange:NSMakeRange(1, normalized.length - 2)];
    normalized = RuneBottomSheetNormalizeJSONString(normalized);
  }
  NSData *data = [normalized dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) return nil;
  NSError *error = nil;
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingAllowFragments error:&error];
  if (error) {
    NSLog(@"[RuneBottomSheet] Failed to parse JSON '%@' error=%@", rawJSON, error);
    return nil;
  }
  return parsed;
}

static NSInteger RuneBottomSheetParseInteger(NSString *rawJSON, NSInteger fallback) {
  id parsed = RuneBottomSheetParseJSON(rawJSON);
  if ([parsed isKindOfClass:[NSNumber class]]) {
    return ((NSNumber *)parsed).integerValue;
  }
  if ([parsed isKindOfClass:[NSString class]]) {
    return [(NSString *)parsed integerValue];
  }
  return fallback;
}

static CGFloat RuneBottomSheetParseCGFloat(NSString *rawJSON, CGFloat fallback) {
  id parsed = RuneBottomSheetParseJSON(rawJSON);
  if ([parsed isKindOfClass:[NSNumber class]]) {
    return ((NSNumber *)parsed).doubleValue;
  }
  if ([parsed isKindOfClass:[NSString class]]) {
    return [(NSString *)parsed doubleValue];
  }
  return fallback;
}

static BOOL RuneBottomSheetParseBoolean(NSString *rawJSON, BOOL fallback) {
  id parsed = RuneBottomSheetParseJSON(rawJSON);
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

@implementation SNUIManager (RuneBottomSheet)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    RuneComponentDescriptor *descriptor = [[RuneComponentDescriptor alloc] initWithType:@"rune-bottom-sheet"];
    descriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      if (@available(iOS 16.0, *)) {
        RuneBottomSheetView *view = [[RuneBottomSheetView alloc] init];
        return view;
      }
      
      return [UIView new];
    };
    descriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (@available(iOS 16.0, *)) {
        if (![node.view isKindOfClass:[RuneBottomSheetView class]]) return;
        RuneBottomSheetView *view = (RuneBottomSheetView *)node.view;
        [view bindWithManager:manager node:node];
      }
    };
    descriptor.cleanup = ^(SNUIManager *manager, SNNode *node) {
      if (@available(iOS 16.0, *)) {
        if (![node.view isKindOfClass:[RuneBottomSheetView class]]) return;
        RuneBottomSheetView *view = (RuneBottomSheetView *)node.view;
        [view reset];
      }
    };
    descriptor.handleSetProp = ^BOOL(SNUIManager *manager,
                                     SNNode *node,
                                     NSString *name,
                                     id value,
                                     NSString *rawJSON) {
      if (@available(iOS 16.0, *)) {
        if (![node.view isKindOfClass:[RuneBottomSheetView class]]) return NO;
        RuneBottomSheetView *view = (RuneBottomSheetView *)node.view;

        if ([name isEqualToString:@"snapPoints"]) {
          
          id parsed = RuneBottomSheetParseJSON(rawJSON);
          if ([parsed isKindOfClass:[NSArray class]]) {
            [view updateSnapPoints:(NSArray *)parsed];
          } else {
            [view updateSnapPoints:nil];
          }
          return YES;
        }

        if ([name isEqualToString:@"overlayColor"]) {
          
          id parsed = RuneBottomSheetParseJSON(rawJSON);
          if ([parsed isKindOfClass:[NSString class]]) {
            [view setOverlayColorString:(NSString *)parsed];
          }
          return YES;
        }

        if ([name isEqualToString:@"overlayOpacity"]) {
          
          CGFloat opacity = RuneBottomSheetParseCGFloat(rawJSON, NAN);
          if (!isnan(opacity)) {
            [view setOverlayOpacityValue:@(opacity)];
          }
          return YES;
        }

        if ([name isEqualToString:@"dismissOnOverlayPress"]) {
          
          BOOL dismiss = RuneBottomSheetParseBoolean(rawJSON, YES);
          [view setDismissOnOverlayPress:@(dismiss)];
          return YES;
        }

        if ([name isEqualToString:@"allowDismissOnInteraction"]) {
          
          BOOL allow = RuneBottomSheetParseBoolean(rawJSON, YES);
          [view setAllowDismissOnInteraction:@(allow)];
          return YES;
        }

        if ([name isEqualToString:@"initialSnapIndex"]) {
          
          NSInteger index = RuneBottomSheetParseInteger(rawJSON, 0);
          [view setInitialSnapIndex:@(index)];
          return YES;
        }

        if ([name isEqualToString:@"open"]) {
          
          BOOL isOpen = RuneBottomSheetParseBoolean(rawJSON, NO);
          [view setOpenState:@(isOpen)];
          return YES;
        }

        if ([name isEqualToString:@"__command"]) {
          
          id parsed = RuneBottomSheetParseJSON(rawJSON);
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

    RuneRegisterComponentDescriptor(descriptor);
  });
}

@end
