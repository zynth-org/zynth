#if __has_include(<ZynthComponents/ZynthComponents-Swift.h>)
#import <ZynthComponents/ZynthComponents-Swift.h>
#else
#import "ZynthComponents-Swift.h"
#endif

#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthKit.h"
#import "ZynthComponentAPI.h"
#import "ZynthUIManager.h"
#import "ZynthNode.h"
#endif

#import <yoga/Yoga.h>

static NSString *ZynthDatePickerNormalizeJSONString(NSString *value) {
  if ([value rangeOfString:@"\\\""].location == NSNotFound) {
    return value;
  }
  NSMutableString *normalized = [value mutableCopy];
  [normalized replaceOccurrencesOfString:@"\\\"" withString:@"\"" options:0 range:NSMakeRange(0, normalized.length)];
  return normalized;
}

static id ZynthDatePickerParseJSON(NSString *rawJSON) {
  if (rawJSON.length == 0) return nil;
  NSString *value = [rawJSON stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (value.length == 0 || [value isEqualToString:@"null"]) return nil;
  NSString *normalized = ZynthDatePickerNormalizeJSONString(value);
  if ([normalized hasPrefix:@"\""] && [normalized hasSuffix:@"\""] && normalized.length >= 2) {
    normalized = [normalized substringWithRange:NSMakeRange(1, normalized.length - 2)];
    normalized = ZynthDatePickerNormalizeJSONString(normalized);
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

static NSNumber *ZynthDatePickerNumberFromValue(id value) {
  if ([value isKindOfClass:[NSNumber class]]) return value;
  if ([value isKindOfClass:[NSString class]]) {
    return @([(NSString *)value doubleValue]);
  }
  return nil;
}

static void ZynthDatePickerApplyValue(ZynthDatePickerView *view, id value, NSString *rawJSON) {
  if (!view) return;
  NSNumber *number = ZynthDatePickerNumberFromValue(value);
  if (number) {
    [view setSelection:number];
    return;
  }

  id parsed = ZynthDatePickerParseJSON(rawJSON);
  if ([parsed isKindOfClass:[NSDictionary class]]) {
    NSDictionary *dict = (NSDictionary *)parsed;
    NSNumber *start = ZynthDatePickerNumberFromValue(dict[@"start"]);
    NSNumber *end = ZynthDatePickerNumberFromValue(dict[@"end"]);
    [view setRangeSelectionWithStart:start end:end];
    return;
  }
  if ([parsed isKindOfClass:[NSArray class]]) {
    NSArray *array = (NSArray *)parsed;
    NSNumber *start = array.count > 0 ? ZynthDatePickerNumberFromValue(array[0]) : nil;
    NSNumber *end = array.count > 1 ? ZynthDatePickerNumberFromValue(array[1]) : nil;
    [view setRangeSelectionWithStart:start end:end];
  }
}

@implementation ZynthUIManager (DatePickerComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    // date-picker-view
    ZynthComponentDescriptor *pickerDesc = [[ZynthComponentDescriptor alloc] initWithType:@"date-picker-view"];
    pickerDesc.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      return [ZynthDatePickerView new];
    };
    pickerDesc.attach = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[ZynthDatePickerView class]]) return;
      ZynthDatePickerView *view = (ZynthDatePickerView *)node.view;
      [view bindWithManager:manager node:node];
    };
    pickerDesc.cleanup = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[ZynthDatePickerView class]]) return;
      ZynthDatePickerView *view = (ZynthDatePickerView *)node.view;
      [view reset];
    };
    pickerDesc.handleSetProp = ^BOOL(ZynthUIManager *manager,
                                     ZynthNode *node,
                                     NSString *name,
                                     id value,
                                     NSString *rawJSON) {
      if (![node.view isKindOfClass:[ZynthDatePickerView class]]) return NO;
      ZynthDatePickerView *view = (ZynthDatePickerView *)node.view;

      if ([name isEqualToString:@"mode"]) {
        NSString *mode = [value isKindOfClass:[NSString class]] ? value : nil;
        [view setMode:mode];
        return YES;
      }

      if ([name isEqualToString:@"title"]) {
        NSString *strValue = [value isKindOfClass:[NSString class]] ? value : nil;
        [view setTitleText:strValue];
        return YES;
      }

      if ([name isEqualToString:@"confirmText"]) {
        NSString *strValue = [value isKindOfClass:[NSString class]] ? value : nil;
        [view setConfirmText:strValue];
        return YES;
      }

      if ([name isEqualToString:@"cancelText"]) {
        NSString *strValue = [value isKindOfClass:[NSString class]] ? value : nil;
        [view setCancelText:strValue];
        return YES;
      }

      if ([name isEqualToString:@"value"]) {
        ZynthDatePickerApplyValue(view, value, rawJSON);
        return YES;
      }

      if ([name isEqualToString:@"__command"]) {
        id parsed = ZynthDatePickerParseJSON(rawJSON);
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
    pickerDesc.handleSetHandler = ^BOOL(ZynthUIManager *manager, ZynthNode *node, NSString *name) {
      return [name isEqualToString:@"onChange"] ||
        [name isEqualToString:@"onRangeChange"] ||
        [name isEqualToString:@"onCancel"] ||
        [name isEqualToString:@"onDismiss"];
    };
    ZynthRegisterComponentDescriptor(pickerDesc);

    // date-picker-trigger-view
    ZynthComponentDescriptor *triggerDesc = [[ZynthComponentDescriptor alloc] initWithType:@"date-picker-trigger-view"];
    triggerDesc.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      return [UIView new];
    };
    ZynthRegisterComponentDescriptor(triggerDesc);
  });
}

@end
