#import "SNUIManager+RuneAlert.h"

#if __has_include(<RuneComponents/RuneComponents-Swift.h>)
#import <RuneComponents/RuneComponents-Swift.h>
#else
#import "RuneComponents-Swift.h"
#endif

#if __has_include(<RuneKit/RuneKit.h>)
#import <RuneKit/RuneKit.h>
#else
#import "RuneKit.h"
#endif

#import "RuneComponentRegistry.h"
#import "SNNode.h"

static NSString *RuneAlertNormalizeJSONString(NSString *value) {
  if ([value rangeOfString:@"\\\""].location == NSNotFound) {
    return value;
  }
  NSMutableString *normalized = [value mutableCopy];
  [normalized replaceOccurrencesOfString:@"\\\"" withString:@"\"" options:0 range:NSMakeRange(0, normalized.length)];
  return normalized;
}

static id RuneAlertParseJSON(NSString *rawJSON) {
  if (rawJSON.length == 0) return nil;
  NSString *value = [rawJSON stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (value.length == 0 || [value isEqualToString:@"null"]) return nil;
  NSString *normalized = RuneAlertNormalizeJSONString(value);
  if ([normalized hasPrefix:@"\""] && [normalized hasSuffix:@"\""] && normalized.length >= 2) {
    normalized = [normalized substringWithRange:NSMakeRange(1, normalized.length - 2)];
    normalized = RuneAlertNormalizeJSONString(normalized);
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

@implementation SNUIManager (RuneAlert)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    RuneComponentDescriptor *descriptor = [[RuneComponentDescriptor alloc] initWithType:@"rune-alert"];
    
    descriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      RuneAlertView *view = [[RuneAlertView alloc] init];
      return view;
    };
    
    descriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[RuneAlertView class]]) return;
      RuneAlertView *view = (RuneAlertView *)node.view;
      [view bindWithManager:manager node:node];
    };
    
    descriptor.cleanup = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[RuneAlertView class]]) return;
      RuneAlertView *view = (RuneAlertView *)node.view;
      [view reset];
    };
    
    descriptor.handleSetProp = ^BOOL(SNUIManager *manager,
                                     SNNode *node,
                                     NSString *name,
                                     id value,
                                     NSString *rawJSON) {
      if (![node.view isKindOfClass:[RuneAlertView class]]) return NO;
      RuneAlertView *view = (RuneAlertView *)node.view;
      
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
        id parsed = RuneAlertParseJSON(rawJSON);
        if ([parsed isKindOfClass:[NSArray class]]) {
          [view setButtons:(NSArray *)parsed];
        }
        return YES;
      }
      
      if ([name isEqualToString:@"__command"]) {
        id parsed = RuneAlertParseJSON(rawJSON);
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
    
    descriptor.handleSetHandler = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name) {
      return [name isEqualToString:@"onButtonPress"] || [name isEqualToString:@"onDismiss"];
    };
    
    RuneRegisterComponentDescriptor(descriptor);
  });
}

@end
