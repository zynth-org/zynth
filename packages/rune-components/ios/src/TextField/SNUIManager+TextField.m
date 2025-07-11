#if __has_include(<RuneKit/RuneKit.h>)
#import <RuneKit/RuneKit.h>
#import <RuneKit/SNHexColor.h>
#else
#import "RuneKit.h"
#import "RuneComponentAPI.h"
#import "SNUIManager.h"
#import "SNNode.h"
#import "SNHexColor.h"
#import "RuneViewHost.h"
#endif

#import "RuneTextFieldView.h"
#import <yoga/Yoga.h>

#pragma mark - Yoga Measure Function

static YGSize RuneTextFieldMeasureFunc(YGNodeConstRef node,
                                       float width,
                                       YGMeasureMode widthMode,
                                       float height,
                                       YGMeasureMode heightMode) {
  RuneTextFieldView *textFieldView = (__bridge RuneTextFieldView *)YGNodeGetContext(node);
  if (![textFieldView isKindOfClass:[RuneTextFieldView class]]) {
    // Fallback to default text field size
    return (YGSize){.width = 200, .height = 44};
  }
  
  CGSize intrinsicSize = [textFieldView intrinsicContentSize];
  
  // Default minimum width for text fields
  float minWidth = 100;
  float defaultHeight = 44;
  
  float outW;
  switch (widthMode) {
    case YGMeasureModeExactly: outW = width; break;
    case YGMeasureModeAtMost: outW = MIN(MAX((float)intrinsicSize.width, minWidth), width); break;
    default: outW = MAX((float)intrinsicSize.width, minWidth); break;
  }
  
  float outH;
  switch (heightMode) {
    case YGMeasureModeExactly: outH = height; break;
    case YGMeasureModeAtMost: outH = MIN(MAX((float)intrinsicSize.height, defaultHeight), height); break;
    default: outH = MAX((float)intrinsicSize.height, defaultHeight); break;
  }
  
  return (YGSize){.width = outW, .height = outH};
}

#pragma mark - Property Handling

static BOOL RuneTextFieldHandleSetProp(SNUIManager *manager,
                                       SNNode *node,
                                       NSString *name,
                                       id value,
                                       NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[RuneTextFieldView class]]) {
    return NO;
  }
  RuneTextFieldView *textFieldView = (RuneTextFieldView *)node.view;

  if ([name isEqualToString:@"value"]) {
    NSString *strValue = [value isKindOfClass:[NSString class]] ? value : @"";
    [textFieldView rune_setValue:strValue];
    return YES;
  }

  if ([name isEqualToString:@"defaultValue"]) {
    NSString *strValue = [value isKindOfClass:[NSString class]] ? value : @"";
    // Only set if text is empty (initial load)
    if (textFieldView.textField.text.length == 0) {
      [textFieldView rune_setValue:strValue];
    }
    return YES;
  }

  if ([name isEqualToString:@"placeholder"]) {
    NSString *strValue = [value isKindOfClass:[NSString class]] ? value : @"";
    [textFieldView rune_setPlaceholder:strValue];
    return YES;
  }

  if ([name isEqualToString:@"disabled"]) {
    BOOL disabled = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
    [textFieldView rune_setDisabled:disabled];
    return YES;
  }

  if ([name isEqualToString:@"editable"]) {
    BOOL editable = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : YES;
    [textFieldView rune_setEditable:editable];
    return YES;
  }

  if ([name isEqualToString:@"secureTextEntry"]) {
    BOOL secure = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
    [textFieldView rune_setSecureTextEntry:secure];
    return YES;
  }

  if ([name isEqualToString:@"keyboardType"]) {
    NSString *strValue = [value isKindOfClass:[NSString class]] ? value : @"default";
    [textFieldView rune_setKeyboardType:strValue];
    return YES;
  }

  if ([name isEqualToString:@"returnKeyType"]) {
    NSString *strValue = [value isKindOfClass:[NSString class]] ? value : @"done";
    [textFieldView rune_setReturnKeyType:strValue];
    return YES;
  }

  if ([name isEqualToString:@"autoCapitalize"]) {
    NSString *strValue = [value isKindOfClass:[NSString class]] ? value : @"sentences";
    [textFieldView rune_setAutoCapitalize:strValue];
    return YES;
  }

  if ([name isEqualToString:@"autoCorrect"]) {
    BOOL autoCorrect = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : YES;
    [textFieldView rune_setAutoCorrect:autoCorrect];
    return YES;
  }

  if ([name isEqualToString:@"maxLength"]) {
    NSInteger maxLength = [value respondsToSelector:@selector(integerValue)] ? [value integerValue] : NSIntegerMax;
    [textFieldView rune_setMaxLength:maxLength];
    return YES;
  }

  if ([name isEqualToString:@"variant"]) {
    NSString *strValue = [value isKindOfClass:[NSString class]] ? value : @"filled";
    [textFieldView rune_setVariant:strValue];
    return YES;
  }

  if ([name isEqualToString:@"requestFocus"]) {
    BOOL shouldFocus = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
    if (shouldFocus) {
      [textFieldView rune_requestFocus];
    }
    return YES;
  }

  if ([name isEqualToString:@"requestBlur"]) {
    BOOL shouldBlur = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
    if (shouldBlur) {
      [textFieldView rune_requestBlur];
    }
    return YES;
  }

  if ([name isEqualToString:@"backgroundColor"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      NSString *colorStr = (NSString *)value;
      if ([colorStr isEqualToString:@"transparent"]) {
        color = [UIColor clearColor];
      } else {
        color = SNColorFromHex(colorStr);
      }
    }
    [textFieldView rune_setBackgroundColor:color];
    return YES;
  }

  if ([name isEqualToString:@"borderRadius"]) {
    CGFloat radius = [value respondsToSelector:@selector(floatValue)] ? [value floatValue] : 0;
    [textFieldView rune_setBorderRadius:radius];
    return YES;
  }

  if ([name isEqualToString:@"borderWidth"]) {
    CGFloat width = [value respondsToSelector:@selector(floatValue)] ? [value floatValue] : 0;
    [textFieldView rune_setBorderWidth:width];
    return YES;
  }

  if ([name isEqualToString:@"borderColor"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = SNColorFromHex((NSString *)value);
    }
    [textFieldView rune_setBorderColor:color];
    return YES;
  }

  if ([name isEqualToString:@"textColor"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = SNColorFromHex((NSString *)value);
    }
    [textFieldView rune_setTextColor:color];
    return YES;
  }

  if ([name isEqualToString:@"placeholderColor"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = SNColorFromHex((NSString *)value);
    }
    [textFieldView rune_setPlaceholderColor:color];
    return YES;
  }

  if ([name isEqualToString:@"pointerEvents"]) {
    NSString *mode = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    textFieldView.pointerMode = RunePointerEventsFromString(mode);
    return YES;
  }

  return NO;
}

static BOOL RuneTextFieldHandleSetHandler(SNUIManager *manager,
                                          SNNode *node,
                                          NSString *name) {
  if (!node || ![node.view isKindOfClass:[RuneTextFieldView class]]) return NO;
  RuneTextFieldView *textFieldView = (RuneTextFieldView *)node.view;

  if ([name isEqualToString:@"onChange"]) {
    __weak SNUIManager *weakManager = manager;
    __weak SNNode *weakNode = node;
    
    textFieldView.onChange = ^(NSString *value) {
      SNUIManager *strongManager = weakManager;
      SNNode *strongNode = weakNode;
      if (!strongManager || !strongNode) return;
      
      NSDictionary *payload = @{@"value": value ?: @""};
      [strongManager rune_dispatchEvent:@"onChange" payload:payload toNode:strongNode];
    };
    return YES;
  }

  if ([name isEqualToString:@"onFocus"]) {
    __weak SNUIManager *weakManager = manager;
    __weak SNNode *weakNode = node;
    
    textFieldView.onFocus = ^{
      SNUIManager *strongManager = weakManager;
      SNNode *strongNode = weakNode;
      if (!strongManager || !strongNode) return;
      
      [strongManager rune_dispatchEvent:@"onFocus" payload:@{} toNode:strongNode];
    };
    return YES;
  }

  if ([name isEqualToString:@"onBlur"]) {
    __weak SNUIManager *weakManager = manager;
    __weak SNNode *weakNode = node;
    
    textFieldView.onBlur = ^{
      SNUIManager *strongManager = weakManager;
      SNNode *strongNode = weakNode;
      if (!strongManager || !strongNode) return;
      
      [strongManager rune_dispatchEvent:@"onBlur" payload:@{} toNode:strongNode];
    };
    return YES;
  }

  if ([name isEqualToString:@"onSubmit"]) {
    __weak SNUIManager *weakManager = manager;
    __weak SNNode *weakNode = node;
    
    textFieldView.onSubmit = ^(NSString *value) {
      SNUIManager *strongManager = weakManager;
      SNNode *strongNode = weakNode;
      if (!strongManager || !strongNode) return;
      
      NSDictionary *payload = @{@"value": value ?: @""};
      [strongManager rune_dispatchEvent:@"onSubmit" payload:payload toNode:strongNode];
    };
    return YES;
  }

  return NO;
}

@implementation SNUIManager (TextFieldComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    RuneComponentDescriptor *descriptor = [[RuneComponentDescriptor alloc] initWithType:@"text-field"];
    descriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      RuneTextFieldView *textFieldView = [RuneTextFieldView new];
      return textFieldView;
    };
    descriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[RuneTextFieldView class]]) return;
      RuneTextFieldView *textFieldView = (RuneTextFieldView *)node.view;
      textFieldView.nodeId = node ? node.nid : -1;
      
      // Set up Yoga measure function for proper layout sizing
      if (node.yoga) {
        YGNodeSetContext(node.yoga, (__bridge void *)textFieldView);
        YGNodeSetMeasureFunc(node.yoga, RuneTextFieldMeasureFunc);
      }
    };
    descriptor.handleSetProp = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name, id value, NSString *rawJSON) {
      return RuneTextFieldHandleSetProp(manager, node, name, value, rawJSON);
    };
    descriptor.handleSetHandler = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name) {
      return RuneTextFieldHandleSetHandler(manager, node, name);
    };
    RuneRegisterComponentDescriptor(descriptor);
  });
}

@end
