#if __has_include(<ZynthComponents/ZynthComponents-Swift.h>)
#import <ZynthComponents/ZynthComponents-Swift.h>
#else
#import "ZynthComponents-Swift.h"
#endif

#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#import <ZynthKit/ZynthHexColor.h>
#else
#import "ZynthKit.h"
#import "ZynthComponentAPI.h"
#import "ZynthUIManager.h"
#import "ZynthNode.h"
#import "ZynthHexColor.h"
#endif

static NSString *ZynthPopoverNormalizeJSONString(NSString *value) {
  if ([value rangeOfString:@"\\\""].location == NSNotFound) {
    return value;
  }
  NSMutableString *normalized = [value mutableCopy];
  [normalized replaceOccurrencesOfString:@"\\\"" withString:@"\"" options:0 range:NSMakeRange(0, normalized.length)];
  return normalized;
}

static id ZynthPopoverParseJSON(NSString *rawJSON) {
  if (rawJSON.length == 0) return nil;
  NSString *value = [rawJSON stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (value.length == 0 || [value isEqualToString:@"null"]) return nil;
  NSString *normalized = ZynthPopoverNormalizeJSONString(value);
  if ([normalized hasPrefix:@"\""] && [normalized hasSuffix:@"\""] && normalized.length >= 2) {
    normalized = [normalized substringWithRange:NSMakeRange(1, normalized.length - 2)];
    normalized = ZynthPopoverNormalizeJSONString(normalized);
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

static CGFloat ZynthPopoverParseCGFloat(NSString *rawJSON, CGFloat fallback) {
  id parsed = ZynthPopoverParseJSON(rawJSON);
  if ([parsed isKindOfClass:[NSNumber class]]) {
    return ((NSNumber *)parsed).doubleValue;
  }
  if ([parsed isKindOfClass:[NSString class]]) {
    return [(NSString *)parsed doubleValue];
  }
  return fallback;
}

static BOOL ZynthPopoverParseBoolean(NSString *rawJSON, BOOL fallback) {
  id parsed = ZynthPopoverParseJSON(rawJSON);
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

@implementation ZynthUIManager (PopoverComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    // popover-view
    ZynthComponentDescriptor *popoverDesc = [[ZynthComponentDescriptor alloc] initWithType:@"popover-view"];
    popoverDesc.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      return [ZynthPopoverView new];
    };
    popoverDesc.attach = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[ZynthPopoverView class]]) return;
      ZynthPopoverView *view = (ZynthPopoverView *)node.view;
      [view bindWithManager:manager node:node];
    };
    popoverDesc.cleanup = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[ZynthPopoverView class]]) return;
      ZynthPopoverView *view = (ZynthPopoverView *)node.view;
      [view reset];
    };
    popoverDesc.handleSetProp = ^BOOL(ZynthUIManager *manager,
                                      ZynthNode *node,
                                      NSString *name,
                                      id value,
                                      NSString *rawJSON) {
      if (![node.view isKindOfClass:[ZynthPopoverView class]]) return NO;
      ZynthPopoverView *view = (ZynthPopoverView *)node.view;

      if ([name isEqualToString:@"surfaceColor"]) {
        NSString *colorString = [value isKindOfClass:[NSString class]] ? value : nil;
        if (!colorString) {
          id parsed = ZynthPopoverParseJSON(rawJSON);
          if ([parsed isKindOfClass:[NSString class]]) {
            colorString = parsed;
          }
        }
        [view setSurfaceColorValue:colorString ? ZynthColorFromHex(colorString) : nil];
        return YES;
      }

      if ([name isEqualToString:@"cornerRadius"]) {
        CGFloat radius = [value isKindOfClass:[NSNumber class]]
          ? ((NSNumber *)value).doubleValue
          : ZynthPopoverParseCGFloat(rawJSON, NAN);
        if (!isnan(radius)) {
          [view setCornerRadiusValue:@(radius)];
        }
        return YES;
      }

      if ([name isEqualToString:@"elevation"]) {
        CGFloat elevation = [value isKindOfClass:[NSNumber class]]
          ? ((NSNumber *)value).doubleValue
          : ZynthPopoverParseCGFloat(rawJSON, NAN);
        if (!isnan(elevation)) {
          [view setElevationValue:@(elevation)];
        }
        return YES;
      }

      if ([name isEqualToString:@"dismissOnOutsidePress"]) {
        BOOL dismissOnOutsidePress = [value isKindOfClass:[NSNumber class]]
          ? ((NSNumber *)value).boolValue
          : ZynthPopoverParseBoolean(rawJSON, YES);
        [view setDismissOnOutsidePress:@(dismissOnOutsidePress)];
        return YES;
      }

      if ([name isEqualToString:@"offsetX"]) {
        CGFloat offsetX = [value isKindOfClass:[NSNumber class]]
          ? ((NSNumber *)value).doubleValue
          : ZynthPopoverParseCGFloat(rawJSON, NAN);
        if (!isnan(offsetX)) {
          [view setOffsetXValue:@(offsetX)];
        }
        return YES;
      }

      if ([name isEqualToString:@"offsetY"]) {
        CGFloat offsetY = [value isKindOfClass:[NSNumber class]]
          ? ((NSNumber *)value).doubleValue
          : ZynthPopoverParseCGFloat(rawJSON, NAN);
        if (!isnan(offsetY)) {
          [view setOffsetYValue:@(offsetY)];
        }
        return YES;
      }

      if ([name isEqualToString:@"showArrow"]) {
        BOOL showArrow = [value isKindOfClass:[NSNumber class]]
          ? ((NSNumber *)value).boolValue
          : ZynthPopoverParseBoolean(rawJSON, YES);
        [view setShowArrowValue:@(showArrow)];
        return YES;
      }

      if ([name isEqualToString:@"__command"]) {
        NSDictionary *command = nil;
        if ([value isKindOfClass:[NSDictionary class]]) {
          command = (NSDictionary *)value;
        } else {
          id parsed = ZynthPopoverParseJSON(rawJSON);
          if ([parsed isKindOfClass:[NSDictionary class]]) {
            command = (NSDictionary *)parsed;
          }
        }
        if (command) {
          [view handleCommand:command];
        }
        return YES;
      }

      return NO;
    };
    popoverDesc.handleSetHandler = ^BOOL(ZynthUIManager *manager, ZynthNode *node, NSString *name) {
      if (![node.view isKindOfClass:[ZynthPopoverView class]]) return NO;
      ZynthPopoverView *view = (ZynthPopoverView *)node.view;
      if ([name isEqualToString:@"onOpen"]) {
        view.hasOnOpenHandler = YES;
        return YES;
      }
      if ([name isEqualToString:@"onClose"]) {
        view.hasOnCloseHandler = YES;
        return YES;
      }
      return NO;
    };
    ZynthRegisterComponentDescriptor(popoverDesc);

    // popover-trigger-view
    ZynthComponentDescriptor *triggerDesc = [[ZynthComponentDescriptor alloc] initWithType:@"popover-trigger-view"];
    triggerDesc.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      return [ZynthPopoverTriggerView new];
    };
    triggerDesc.cleanup = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[ZynthPopoverTriggerView class]]) return;
      ZynthPopoverTriggerView *view = (ZynthPopoverTriggerView *)node.view;
      [view reset];
    };
    ZynthRegisterComponentDescriptor(triggerDesc);

    // popover-content-view
    ZynthComponentDescriptor *contentDesc = [[ZynthComponentDescriptor alloc] initWithType:@"popover-content-view"];
    contentDesc.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      return [ZynthPopoverContentView new];
    };
    contentDesc.cleanup = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[ZynthPopoverContentView class]]) return;
      ZynthPopoverContentView *view = (ZynthPopoverContentView *)node.view;
      [view reset];
    };
    ZynthRegisterComponentDescriptor(contentDesc);
  });
}

@end
