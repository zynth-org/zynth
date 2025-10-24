#import "SNUIManager+RuneKeyboardViews.h"
#import "RuneKeyboardAwareScrollView.h"

#if __has_include(<RuneKeyboard/RuneKeyboard-Swift.h>)
#import <RuneKeyboard/RuneKeyboard-Swift.h>
#else
#import "RuneKeyboard-Swift.h"
#endif

#if __has_include(<RuneKit/RuneKit.h>)
#import <RuneKit/RuneKit.h>
#else
#import "RuneKit.h"
#endif

#import "RuneComponentRegistry.h"
#import "SNNode.h"

static id RuneKeyboardParseJSON(NSString *rawJSON) {
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

static BOOL RuneKeyboardParseBoolean(NSString *rawJSON, BOOL fallback) {
  id parsed = RuneKeyboardParseJSON(rawJSON);
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

static CGFloat RuneKeyboardParseCGFloat(NSString *rawJSON, CGFloat fallback) {
  id parsed = RuneKeyboardParseJSON(rawJSON);
  if ([parsed isKindOfClass:[NSNumber class]]) {
    return ((NSNumber *)parsed).doubleValue;
  }
  if ([parsed isKindOfClass:[NSString class]]) {
    return [(NSString *)parsed doubleValue];
  }
  return fallback;
}

static NSString *RuneKeyboardParseString(NSString *rawJSON) {
  id parsed = RuneKeyboardParseJSON(rawJSON);
  if ([parsed isKindOfClass:[NSString class]]) {
    return (NSString *)parsed;
  }
  return nil;
}

@implementation SNUIManager (RuneKeyboardAvoidingView)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    // Register KeyboardAvoidingView
    RuneComponentDescriptor *avoidingDescriptor = [[RuneComponentDescriptor alloc] initWithType:@"rune-keyboard-avoiding-view"];
    avoidingDescriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      return [[RuneKeyboardAvoidingView alloc] init];
    };
    avoidingDescriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if ([node.view isKindOfClass:[RuneKeyboardAvoidingView class]]) {
        [(RuneKeyboardAvoidingView *)node.view attachToManager:manager node:node];
      }
    };
    avoidingDescriptor.cleanup = ^(SNUIManager *manager, SNNode *node) {
      if ([node.view isKindOfClass:[RuneKeyboardAvoidingView class]]) {
        [(RuneKeyboardAvoidingView *)node.view cleanup];
      }
    };
    avoidingDescriptor.handleSetProp = ^BOOL(SNUIManager *manager,
                                              SNNode *node,
                                              NSString *name,
                                              id value,
                                              NSString *rawJSON) {
      if (![node.view isKindOfClass:[RuneKeyboardAvoidingView class]]) return NO;
      RuneKeyboardAvoidingView *view = (RuneKeyboardAvoidingView *)node.view;
      
      if ([name isEqualToString:@"behavior"]) {
        NSString *behavior = RuneKeyboardParseString(rawJSON);
        if (behavior) {
          [view setBehavior:behavior];
        }
        return YES;
      }
      
      if ([name isEqualToString:@"keyboardVerticalOffset"]) {
        CGFloat offset = RuneKeyboardParseCGFloat(rawJSON, 0);
        [view setKeyboardVerticalOffset:offset];
        return YES;
      }
      
      if ([name isEqualToString:@"enabled"]) {
        BOOL enabled = RuneKeyboardParseBoolean(rawJSON, YES);
        [view setEnabled:enabled];
        return YES;
      }
      
      return NO;
    };
    RuneRegisterComponentDescriptor(avoidingDescriptor);
    
    // Register KeyboardStickyView
    RuneComponentDescriptor *stickyDescriptor = [[RuneComponentDescriptor alloc] initWithType:@"rune-keyboard-sticky-view"];
    stickyDescriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      return [[RuneKeyboardStickyView alloc] init];
    };
    stickyDescriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      // No special attachment needed
    };
    stickyDescriptor.cleanup = ^(SNUIManager *manager, SNNode *node) {
      if ([node.view isKindOfClass:[RuneKeyboardStickyView class]]) {
        [(RuneKeyboardStickyView *)node.view cleanup];
      }
    };
    stickyDescriptor.handleSetProp = ^BOOL(SNUIManager *manager,
                                            SNNode *node,
                                            NSString *name,
                                            id value,
                                            NSString *rawJSON) {
      if (![node.view isKindOfClass:[RuneKeyboardStickyView class]]) return NO;
      RuneKeyboardStickyView *view = (RuneKeyboardStickyView *)node.view;
      
      if ([name isEqualToString:@"offset"]) {
        CGFloat offset = RuneKeyboardParseCGFloat(rawJSON, 0);
        [view setOffset:offset];
        return YES;
      }
      
      return NO;
    };
    RuneRegisterComponentDescriptor(stickyDescriptor);
    
    // Register KeyboardAwareScrollView
    RuneComponentDescriptor *scrollDescriptor = [[RuneComponentDescriptor alloc] initWithType:@"rune-keyboard-aware-scroll-view"];
    scrollDescriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      return [[RuneKeyboardAwareScrollView alloc] init];
    };
    scrollDescriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if ([node.view isKindOfClass:[RuneKeyboardAwareScrollView class]]) {
        [(RuneKeyboardAwareScrollView *)node.view attachToManager:manager node:node];
      }
    };
    scrollDescriptor.cleanup = ^(SNUIManager *manager, SNNode *node) {
      if ([node.view isKindOfClass:[RuneKeyboardAwareScrollView class]]) {
        [(RuneKeyboardAwareScrollView *)node.view cleanup];
      }
    };
    // NOTE: We don't set handleInsertChild/handleRemoveChild because the default
    // behavior in SNUIManager already detects insertContentSubview:atIndex: and
    // handles both view and Yoga node insertion correctly.
    scrollDescriptor.handleSetProp = ^BOOL(SNUIManager *manager,
                                            SNNode *node,
                                            NSString *name,
                                            id value,
                                            NSString *rawJSON) {
      if (![node.view isKindOfClass:[RuneKeyboardAwareScrollView class]]) return NO;
      RuneKeyboardAwareScrollView *view = (RuneKeyboardAwareScrollView *)node.view;
      
      if ([name isEqualToString:@"scrollEnabled"]) {
        BOOL enabled = RuneKeyboardParseBoolean(rawJSON, YES);
        [view rune_setScrollEnabled:enabled];
        return YES;
      }
      
      if ([name isEqualToString:@"showsVerticalScrollIndicator"]) {
        BOOL show = RuneKeyboardParseBoolean(rawJSON, YES);
        [view rune_setShowsVerticalScrollIndicator:show];
        return YES;
      }
      
      if ([name isEqualToString:@"showsHorizontalScrollIndicator"]) {
        BOOL show = RuneKeyboardParseBoolean(rawJSON, NO);
        [view rune_setShowsHorizontalScrollIndicator:show];
        return YES;
      }
      
      if ([name isEqualToString:@"bounces"]) {
        BOOL enabled = RuneKeyboardParseBoolean(rawJSON, YES);
        [view rune_setBounces:enabled];
        return YES;
      }
      
      if ([name isEqualToString:@"contentInset"]) {
        id parsed = RuneKeyboardParseJSON(rawJSON);
        if ([parsed isKindOfClass:[NSDictionary class]]) {
          [view rune_setContentInset:(NSDictionary *)parsed];
        }
        return YES;
      }
      
      if ([name isEqualToString:@"extraScrollHeight"]) {
        CGFloat height = RuneKeyboardParseCGFloat(rawJSON, 75.0);
        [view rune_setExtraScrollHeight:height];
        return YES;
      }
      
      if ([name isEqualToString:@"keyboardVerticalOffset"]) {
        CGFloat offset = RuneKeyboardParseCGFloat(rawJSON, 0);
        [view rune_setKeyboardVerticalOffset:offset];
        return YES;
      }
      
      if ([name isEqualToString:@"enabled"]) {
        BOOL enabled = RuneKeyboardParseBoolean(rawJSON, YES);
        [view rune_setKeyboardEnabled:enabled];
        return YES;
      }
      
      if ([name isEqualToString:@"scrollToInputOnFocus"]) {
        BOOL enabled = RuneKeyboardParseBoolean(rawJSON, YES);
        [view rune_setScrollToInputOnFocus:enabled];
        return YES;
      }
      
      return NO;
    };
    RuneRegisterComponentDescriptor(scrollDescriptor);
  });
}

@end
