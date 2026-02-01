#import "ZynthUIManager+ZynthKeyboardViews.h"
#import "ZynthKeyboardAwareScrollView.h"

#if __has_include(<ZynthKeyboard/ZynthKeyboard-Swift.h>)
#import <ZynthKeyboard/ZynthKeyboard-Swift.h>
#else
#import "ZynthKeyboard-Swift.h"
#endif

#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthKit.h"
#endif

#import "ZynthComponentRegistry.h"
#import "ZynthNode.h"

static id ZynthKeyboardParseJSON(NSString *rawJSON) {
  if (rawJSON.length == 0) return nil;
  NSString *value = [rawJSON stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (value.length == 0 || [value isEqualToString:@"null"]) return nil;
  NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) return nil;
  NSError *error = nil;
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingAllowFragments error:&error];
  if (error) return nil;
  return parsed;
}

static BOOL ZynthKeyboardParseBoolean(NSString *rawJSON, BOOL fallback) {
  id parsed = ZynthKeyboardParseJSON(rawJSON);
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

static CGFloat ZynthKeyboardParseCGFloat(NSString *rawJSON, CGFloat fallback) {
  id parsed = ZynthKeyboardParseJSON(rawJSON);
  if ([parsed isKindOfClass:[NSNumber class]]) {
    return ((NSNumber *)parsed).doubleValue;
  }
  if ([parsed isKindOfClass:[NSString class]]) {
    return [(NSString *)parsed doubleValue];
  }
  return fallback;
}

static NSString *ZynthKeyboardParseString(NSString *rawJSON) {
  id parsed = ZynthKeyboardParseJSON(rawJSON);
  if ([parsed isKindOfClass:[NSString class]]) {
    return (NSString *)parsed;
  }
  if (rawJSON.length > 0 && ![rawJSON isEqualToString:@"null"]) {
    return rawJSON;
  }
  return nil;
}

@implementation ZynthUIManager (ZynthKeyboardAvoidingView)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    // Register KeyboardAvoidingView
    ZynthComponentDescriptor *avoidingDescriptor = [[ZynthComponentDescriptor alloc] initWithType:@"zynth-keyboard-avoiding-view"];
    avoidingDescriptor.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      return [[ZynthKeyboardAvoidingView alloc] init];
    };
    avoidingDescriptor.attach = ^(ZynthUIManager *manager, ZynthNode *node) {
      if ([node.view isKindOfClass:[ZynthKeyboardAvoidingView class]]) {
        [(ZynthKeyboardAvoidingView *)node.view attachToManager:manager node:node];
      }
    };
    avoidingDescriptor.cleanup = ^(ZynthUIManager *manager, ZynthNode *node) {
      if ([node.view isKindOfClass:[ZynthKeyboardAvoidingView class]]) {
        [(ZynthKeyboardAvoidingView *)node.view cleanup];
      }
    };
    avoidingDescriptor.handleSetProp = ^BOOL(ZynthUIManager *manager,
                                              ZynthNode *node,
                                              NSString *name,
                                              id value,
                                              NSString *rawJSON) {
      if (![node.view isKindOfClass:[ZynthKeyboardAvoidingView class]]) return NO;
      ZynthKeyboardAvoidingView *view = (ZynthKeyboardAvoidingView *)node.view;
      
      if ([name isEqualToString:@"behavior"]) {
        NSString *behavior = ZynthKeyboardParseString(rawJSON);
        if (behavior) {
          [view setBehavior:behavior];
        }
        return YES;
      }
      
      if ([name isEqualToString:@"keyboardVerticalOffset"]) {
        CGFloat offset = ZynthKeyboardParseCGFloat(rawJSON, 0);
        [view setKeyboardVerticalOffset:offset];
        return YES;
      }
      
      if ([name isEqualToString:@"enabled"]) {
        BOOL enabled = ZynthKeyboardParseBoolean(rawJSON, YES);
        [view setEnabled:enabled];
        return YES;
      }
      
      return NO;
    };
    ZynthRegisterComponentDescriptor(avoidingDescriptor);
    
    // Register KeyboardStickyView
    ZynthComponentDescriptor *stickyDescriptor = [[ZynthComponentDescriptor alloc] initWithType:@"zynth-keyboard-sticky-view"];
    stickyDescriptor.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      return [[ZynthKeyboardStickyView alloc] init];
    };
    stickyDescriptor.attach = ^(ZynthUIManager *manager, ZynthNode *node) {
      // No special attachment needed
    };
    stickyDescriptor.cleanup = ^(ZynthUIManager *manager, ZynthNode *node) {
      if ([node.view isKindOfClass:[ZynthKeyboardStickyView class]]) {
        [(ZynthKeyboardStickyView *)node.view cleanup];
      }
    };
    stickyDescriptor.handleSetProp = ^BOOL(ZynthUIManager *manager,
                                            ZynthNode *node,
                                            NSString *name,
                                            id value,
                                            NSString *rawJSON) {
      if (![node.view isKindOfClass:[ZynthKeyboardStickyView class]]) return NO;
      ZynthKeyboardStickyView *view = (ZynthKeyboardStickyView *)node.view;
      
      if ([name isEqualToString:@"offset"]) {
        CGFloat offset = ZynthKeyboardParseCGFloat(rawJSON, 0);
        [view setOffset:offset];
        return YES;
      }
      
      return NO;
    };
    ZynthRegisterComponentDescriptor(stickyDescriptor);
    
    // Register KeyboardAwareScrollView
    ZynthComponentDescriptor *scrollDescriptor = [[ZynthComponentDescriptor alloc] initWithType:@"zynth-keyboard-aware-scroll-view"];
    scrollDescriptor.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      return [[ZynthKeyboardAwareScrollView alloc] init];
    };
    scrollDescriptor.attach = ^(ZynthUIManager *manager, ZynthNode *node) {
      if ([node.view isKindOfClass:[ZynthKeyboardAwareScrollView class]]) {
        [(ZynthKeyboardAwareScrollView *)node.view attachToManager:manager node:node];
      }
    };
    scrollDescriptor.cleanup = ^(ZynthUIManager *manager, ZynthNode *node) {
      if ([node.view isKindOfClass:[ZynthKeyboardAwareScrollView class]]) {
        [(ZynthKeyboardAwareScrollView *)node.view cleanup];
      }
    };
    // NOTE: We don't set handleInsertChild/handleRemoveChild because the default
    // behavior in ZynthUIManager already detects insertContentSubview:atIndex: and
    // handles both view and Yoga node insertion correctly.
    scrollDescriptor.handleSetProp = ^BOOL(ZynthUIManager *manager,
                                            ZynthNode *node,
                                            NSString *name,
                                            id value,
                                            NSString *rawJSON) {
      if (![node.view isKindOfClass:[ZynthKeyboardAwareScrollView class]]) return NO;
      ZynthKeyboardAwareScrollView *view = (ZynthKeyboardAwareScrollView *)node.view;
      
      if ([name isEqualToString:@"scrollEnabled"]) {
        BOOL enabled = ZynthKeyboardParseBoolean(rawJSON, YES);
        [view zynth_setScrollEnabled:enabled];
        return YES;
      }
      
      if ([name isEqualToString:@"showsVerticalScrollIndicator"]) {
        BOOL show = ZynthKeyboardParseBoolean(rawJSON, YES);
        [view zynth_setShowsVerticalScrollIndicator:show];
        return YES;
      }
      
      if ([name isEqualToString:@"showsHorizontalScrollIndicator"]) {
        BOOL show = ZynthKeyboardParseBoolean(rawJSON, NO);
        [view zynth_setShowsHorizontalScrollIndicator:show];
        return YES;
      }
      
      if ([name isEqualToString:@"bounces"]) {
        BOOL enabled = ZynthKeyboardParseBoolean(rawJSON, YES);
        [view zynth_setBounces:enabled];
        return YES;
      }
      
      if ([name isEqualToString:@"contentInset"]) {
        id parsed = ZynthKeyboardParseJSON(rawJSON);
        if ([parsed isKindOfClass:[NSDictionary class]]) {
          [view zynth_setContentInset:(NSDictionary *)parsed];
        }
        return YES;
      }
      
      if ([name isEqualToString:@"extraScrollHeight"]) {
        CGFloat height = ZynthKeyboardParseCGFloat(rawJSON, 75.0);
        [view zynth_setExtraScrollHeight:height];
        return YES;
      }
      
      if ([name isEqualToString:@"keyboardVerticalOffset"]) {
        CGFloat offset = ZynthKeyboardParseCGFloat(rawJSON, 0);
        [view zynth_setKeyboardVerticalOffset:offset];
        return YES;
      }
      
      if ([name isEqualToString:@"enabled"]) {
        BOOL enabled = ZynthKeyboardParseBoolean(rawJSON, YES);
        [view zynth_setKeyboardEnabled:enabled];
        return YES;
      }
      
      if ([name isEqualToString:@"scrollToInputOnFocus"]) {
        BOOL enabled = ZynthKeyboardParseBoolean(rawJSON, YES);
        [view zynth_setScrollToInputOnFocus:enabled];
        return YES;
      }
      
      return NO;
    };
    ZynthRegisterComponentDescriptor(scrollDescriptor);
  });
}

@end
