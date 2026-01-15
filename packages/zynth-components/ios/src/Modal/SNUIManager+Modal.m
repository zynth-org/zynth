#if __has_include(<ZynthComponents/ZynthComponents-Swift.h>)
#import <ZynthComponents/ZynthComponents-Swift.h>
#else
#import "ZynthComponents-Swift.h"
#endif

#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#import <ZynthKit/SNHexColor.h>
#else
#import "ZynthKit.h"
#import "ZynthComponentAPI.h"
#import "SNUIManager.h"
#import "SNNode.h"
#import "SNHexColor.h"
#endif

static NSString *ZynthModalNormalizeJSONString(NSString *value) {
  if ([value rangeOfString:@"\\\""].location == NSNotFound) {
    return value;
  }
  NSMutableString *normalized = [value mutableCopy];
  [normalized replaceOccurrencesOfString:@"\\\"" withString:@"\"" options:0 range:NSMakeRange(0, normalized.length)];
  return normalized;
}

static id ZynthModalParseJSON(NSString *rawJSON) {
  if (rawJSON.length == 0) return nil;
  NSString *value = [rawJSON stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (value.length == 0 || [value isEqualToString:@"null"]) return nil;
  NSString *normalized = ZynthModalNormalizeJSONString(value);
  if ([normalized hasPrefix:@"\""] && [normalized hasSuffix:@"\""] && normalized.length >= 2) {
    normalized = [normalized substringWithRange:NSMakeRange(1, normalized.length - 2)];
    normalized = ZynthModalNormalizeJSONString(normalized);
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

static CGFloat ZynthModalParseCGFloat(NSString *rawJSON, CGFloat fallback) {
  id parsed = ZynthModalParseJSON(rawJSON);
  if ([parsed isKindOfClass:[NSNumber class]]) {
    return ((NSNumber *)parsed).doubleValue;
  }
  if ([parsed isKindOfClass:[NSString class]]) {
    return [(NSString *)parsed doubleValue];
  }
  return fallback;
}

static BOOL ZynthModalParseBoolean(NSString *rawJSON, BOOL fallback) {
  id parsed = ZynthModalParseJSON(rawJSON);
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

@implementation SNUIManager (ModalComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    ZynthComponentDescriptor *descriptor = [[ZynthComponentDescriptor alloc] initWithType:@"zynth-modal"];
    descriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      return [[ZynthModalView alloc] init];
    };
    descriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[ZynthModalView class]]) return;
      ZynthModalView *view = (ZynthModalView *)node.view;
      [view bindWithManager:manager node:node];
    };
    descriptor.cleanup = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[ZynthModalView class]]) return;
      ZynthModalView *view = (ZynthModalView *)node.view;
      [view reset];
    };
    descriptor.handleSetProp = ^BOOL(SNUIManager *manager,
                                     SNNode *node,
                                     NSString *name,
                                     id value,
                                     NSString *rawJSON) {
      if (![node.view isKindOfClass:[ZynthModalView class]]) return NO;
      ZynthModalView *view = (ZynthModalView *)node.view;

      if ([name isEqualToString:@"open"]) {
        BOOL isOpen = ZynthModalParseBoolean(rawJSON, NO);
        [view setOpenState:@(isOpen)];
        return YES;
      }

      if ([name isEqualToString:@"animation"]) {
        NSString *style = [value isKindOfClass:[NSString class]] ? value : nil;
        if (!style) {
          id parsed = ZynthModalParseJSON(rawJSON);
          if ([parsed isKindOfClass:[NSString class]]) {
            style = parsed;
          }
        }
        [view setAnimationStyle:style];
        return YES;
      }

      if ([name isEqualToString:@"transparent"]) {
        BOOL transparent = ZynthModalParseBoolean(rawJSON, NO);
        [view setTransparent:@(transparent)];
        return YES;
      }

      if ([name isEqualToString:@"overlayColor"]) {
        NSString *colorString = [value isKindOfClass:[NSString class]] ? value : nil;
        if (!colorString) {
          id parsed = ZynthModalParseJSON(rawJSON);
          if ([parsed isKindOfClass:[NSString class]]) {
            colorString = parsed;
          }
        }
        if (colorString) {
          UIColor *color = SNColorFromHex(colorString);
          [view setOverlayColor:color];
        }
        return YES;
      }

      if ([name isEqualToString:@"overlayOpacity"]) {
        CGFloat opacity = ZynthModalParseCGFloat(rawJSON, NAN);
        if (!isnan(opacity)) {
          [view setOverlayOpacity:@(opacity)];
        }
        return YES;
      }

      if ([name isEqualToString:@"dismissOnOverlayPress"]) {
        BOOL dismiss = ZynthModalParseBoolean(rawJSON, YES);
        [view setDismissOnOverlayPress:@(dismiss)];
        return YES;
      }

      if ([name isEqualToString:@"__command"]) {
        id parsed = ZynthModalParseJSON(rawJSON);
        if ([parsed isKindOfClass:[NSDictionary class]]) {
          [view handleCommand:(NSDictionary *)parsed];
        }
        return YES;
      }

      return NO;
    };
    descriptor.handleSetHandler = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name) {
      return [name isEqualToString:@"onOpenChange"] ||
             [name isEqualToString:@"onRequestClose"] ||
             [name isEqualToString:@"onDismiss"];
    };
    ZynthRegisterComponentDescriptor(descriptor);
  });
}

@end
