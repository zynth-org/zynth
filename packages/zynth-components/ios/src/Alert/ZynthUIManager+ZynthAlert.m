#import "ZynthUIManager+ZynthAlert.h"

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

static NSString *ZynthAlertNormalizeJSONString(NSString *value) {
  if ([value rangeOfString:@"\\\""].location == NSNotFound) {
    return value;
  }
  NSMutableString *normalized = [value mutableCopy];
  [normalized replaceOccurrencesOfString:@"\\\"" withString:@"\"" options:0 range:NSMakeRange(0, normalized.length)];
  return normalized;
}

static id ZynthAlertParseJSON(NSString *rawJSON) {
  if (rawJSON.length == 0) return nil;
  NSString *value = [rawJSON stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (value.length == 0 || [value isEqualToString:@"null"]) return nil;
  NSString *normalized = ZynthAlertNormalizeJSONString(value);
  if ([normalized hasPrefix:@"\""] && [normalized hasSuffix:@"\""] && normalized.length >= 2) {
    normalized = [normalized substringWithRange:NSMakeRange(1, normalized.length - 2)];
    normalized = ZynthAlertNormalizeJSONString(normalized);
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

@implementation ZynthUIManager (ZynthAlert)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    ZynthComponentDescriptor *descriptor = [[ZynthComponentDescriptor alloc] initWithType:@"zynth-alert"];
    
    descriptor.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      ZynthAlertView *view = [[ZynthAlertView alloc] init];
      return view;
    };
    
    descriptor.attach = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[ZynthAlertView class]]) return;
      ZynthAlertView *view = (ZynthAlertView *)node.view;
      [view bindWithManager:manager node:node];
    };
    
    descriptor.cleanup = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[ZynthAlertView class]]) return;
      ZynthAlertView *view = (ZynthAlertView *)node.view;
      [view reset];
    };
    
    descriptor.handleSetProp = ^BOOL(ZynthUIManager *manager,
                                     ZynthNode *node,
                                     NSString *name,
                                     id value,
                                     NSString *rawJSON) {
      if (![node.view isKindOfClass:[ZynthAlertView class]]) return NO;
      ZynthAlertView *view = (ZynthAlertView *)node.view;
      
      if ([name isEqualToString:@"title"]) {
        NSString *strValue = [value isKindOfClass:[NSString class]] ? value : nil;
        if (strValue) {
          [view setAlertTitle:strValue];
        }
        return YES;
      }
      
      if ([name isEqualToString:@"message"]) {
        NSString *strValue = [value isKindOfClass:[NSString class]] ? value : nil;
        if (strValue) {
          [view setAlertMessage:strValue];
        }
        return YES;
      }
      
      if ([name isEqualToString:@"buttons"]) {
        // buttons comes as JSON string from setProperty
        id parsed = ZynthAlertParseJSON(rawJSON);
        if ([parsed isKindOfClass:[NSArray class]]) {
          [view setButtons:(NSArray *)parsed];
        }
        return YES;
      }
      
      if ([name isEqualToString:@"__command"]) {
        id parsed = ZynthAlertParseJSON(rawJSON);
        if ([parsed isKindOfClass:[NSDictionary class]]) {
          NSDictionary *command = (NSDictionary *)parsed;
          NSString *type = command[@"type"];
          if ([type isEqualToString:@"show"]) {
            [view show];
          } else if ([type isEqualToString:@"dismiss"]) {
            [view dismiss];
          }
        }
        return YES;
      }
      
      return NO;
    };
    
    descriptor.handleSetHandler = ^BOOL(ZynthUIManager *manager, ZynthNode *node, NSString *name) {
      return [name isEqualToString:@"onButtonPress"] || [name isEqualToString:@"onDismiss"];
    };
    
    ZynthRegisterComponentDescriptor(descriptor);
  });
}

@end
