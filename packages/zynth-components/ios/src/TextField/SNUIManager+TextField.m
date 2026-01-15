#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#import <ZynthKit/SNHexColor.h>
#else
#import "ZynthKit.h"
#import "ZynthComponentAPI.h"
#import "SNUIManager.h"
#import "SNNode.h"
#import "SNHexColor.h"
#import "ZynthViewHost.h"
#endif

#import "ZynthTextFieldView.h"
#import <yoga/Yoga.h>

#pragma mark - Yoga Measure Function

static YGSize ZynthTextFieldMeasureFunc(YGNodeConstRef node,
                                       float width,
                                       YGMeasureMode widthMode,
                                       float height,
                                       YGMeasureMode heightMode) {
  ZynthTextFieldView *textFieldView = (__bridge ZynthTextFieldView *)YGNodeGetContext(node);
  if (![textFieldView isKindOfClass:[ZynthTextFieldView class]]) {
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

static BOOL ZynthTextFieldHandleSetProp(SNUIManager *manager,
                                       SNNode *node,
                                       NSString *name,
                                       id value,
                                       NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[ZynthTextFieldView class]]) {
    return NO;
  }
  ZynthTextFieldView *textFieldView = (ZynthTextFieldView *)node.view;

  if ([name isEqualToString:@"value"]) {
    NSString *strValue = [value isKindOfClass:[NSString class]] ? value : @"";
    [textFieldView zynth_setValue:strValue];
    return YES;
  }

  if ([name isEqualToString:@"defaultValue"]) {
    NSString *strValue = [value isKindOfClass:[NSString class]] ? value : @"";
    // Only set if text is empty (initial load)
    if (textFieldView.textField.text.length == 0) {
      [textFieldView zynth_setValue:strValue];
    }
    return YES;
  }

  if ([name isEqualToString:@"placeholder"]) {
    NSString *strValue = [value isKindOfClass:[NSString class]] ? value : @"";
    [textFieldView zynth_setPlaceholder:strValue];
    return YES;
  }

  if ([name isEqualToString:@"disabled"]) {
    BOOL disabled = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
    [textFieldView zynth_setDisabled:disabled];
    return YES;
  }

  if ([name isEqualToString:@"editable"]) {
    BOOL editable = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : YES;
    [textFieldView zynth_setEditable:editable];
    return YES;
  }

  if ([name isEqualToString:@"secureTextEntry"]) {
    BOOL secure = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
    [textFieldView zynth_setSecureTextEntry:secure];
    return YES;
  }

  if ([name isEqualToString:@"keyboardType"]) {
    NSString *strValue = [value isKindOfClass:[NSString class]] ? value : @"default";
    [textFieldView zynth_setKeyboardType:strValue];
    return YES;
  }

  if ([name isEqualToString:@"returnKeyType"]) {
    NSString *strValue = [value isKindOfClass:[NSString class]] ? value : @"done";
    [textFieldView zynth_setReturnKeyType:strValue];
    return YES;
  }

  if ([name isEqualToString:@"autoCapitalize"]) {
    NSString *strValue = [value isKindOfClass:[NSString class]] ? value : @"sentences";
    [textFieldView zynth_setAutoCapitalize:strValue];
    return YES;
  }

  if ([name isEqualToString:@"autoCorrect"]) {
    BOOL autoCorrect = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : YES;
    [textFieldView zynth_setAutoCorrect:autoCorrect];
    return YES;
  }

  if ([name isEqualToString:@"maxLength"]) {
    NSInteger maxLength = [value respondsToSelector:@selector(integerValue)] ? [value integerValue] : NSIntegerMax;
    [textFieldView zynth_setMaxLength:maxLength];
    return YES;
  }

  if ([name isEqualToString:@"variant"]) {
    NSString *strValue = [value isKindOfClass:[NSString class]] ? value : @"filled";
    [textFieldView zynth_setVariant:strValue];
    return YES;
  }

  if ([name isEqualToString:@"requestFocus"]) {
    BOOL shouldFocus = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
    if (shouldFocus) {
      [textFieldView zynth_requestFocus];
    }
    return YES;
  }

  if ([name isEqualToString:@"requestBlur"]) {
    BOOL shouldBlur = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
    if (shouldBlur) {
      [textFieldView zynth_requestBlur];
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
    [textFieldView zynth_setBackgroundColor:color];
    return YES;
  }

  if ([name isEqualToString:@"borderRadius"]) {
    CGFloat radius = [value respondsToSelector:@selector(floatValue)] ? [value floatValue] : 0;
    [textFieldView zynth_setBorderRadius:radius];
    return YES;
  }

  if ([name isEqualToString:@"borderWidth"]) {
    CGFloat width = [value respondsToSelector:@selector(floatValue)] ? [value floatValue] : 0;
    [textFieldView zynth_setBorderWidth:width];
    return YES;
  }

  if ([name isEqualToString:@"borderColor"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = SNColorFromHex((NSString *)value);
    }
    [textFieldView zynth_setBorderColor:color];
    return YES;
  }

  if ([name isEqualToString:@"textColor"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = SNColorFromHex((NSString *)value);
    }
    [textFieldView zynth_setTextColor:color];
    return YES;
  }

  if ([name isEqualToString:@"placeholderColor"]) {
    UIColor *color = nil;
    if ([value isKindOfClass:[NSString class]]) {
      color = SNColorFromHex((NSString *)value);
    }
    [textFieldView zynth_setPlaceholderColor:color];
    return YES;
  }

  if ([name isEqualToString:@"pointerEvents"]) {
    NSString *mode = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
    textFieldView.pointerMode = ZynthPointerEventsFromString(mode);
    return YES;
  }

  return NO;
}

static BOOL ZynthTextFieldHandleSetHandler(SNUIManager *manager,
                                          SNNode *node,
                                          NSString *name) {
  if (!node || ![node.view isKindOfClass:[ZynthTextFieldView class]]) return NO;
  ZynthTextFieldView *textFieldView = (ZynthTextFieldView *)node.view;

  if ([name isEqualToString:@"onChange"]) {
    __weak SNUIManager *weakManager = manager;
    __weak SNNode *weakNode = node;
    
    textFieldView.onChange = ^(NSString *value) {
      SNUIManager *strongManager = weakManager;
      SNNode *strongNode = weakNode;
      if (!strongManager || !strongNode) return;
      
      NSDictionary *payload = @{@"value": value ?: @""};
      [strongManager zynth_dispatchEvent:@"onChange" payload:payload toNode:strongNode];
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
      
      [strongManager zynth_dispatchEvent:@"onFocus" payload:@{} toNode:strongNode];
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
      
      [strongManager zynth_dispatchEvent:@"onBlur" payload:@{} toNode:strongNode];
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
      [strongManager zynth_dispatchEvent:@"onSubmit" payload:payload toNode:strongNode];
    };
    return YES;
  }

  return NO;
}

@implementation SNUIManager (TextFieldComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    ZynthComponentDescriptor *descriptor = [[ZynthComponentDescriptor alloc] initWithType:@"text-field"];
    descriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      ZynthTextFieldView *textFieldView = [ZynthTextFieldView new];
      return textFieldView;
    };
    descriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[ZynthTextFieldView class]]) return;
      ZynthTextFieldView *textFieldView = (ZynthTextFieldView *)node.view;
      textFieldView.nodeId = node ? node.nid : -1;
      
      // Set up Yoga measure function for proper layout sizing
      if (node.yoga) {
        YGNodeSetContext(node.yoga, (__bridge void *)textFieldView);
        YGNodeSetMeasureFunc(node.yoga, ZynthTextFieldMeasureFunc);
      }
    };
    descriptor.handleSetProp = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name, id value, NSString *rawJSON) {
      return ZynthTextFieldHandleSetProp(manager, node, name, value, rawJSON);
    };
    descriptor.handleSetHandler = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name) {
      return ZynthTextFieldHandleSetHandler(manager, node, name);
    };
    ZynthRegisterComponentDescriptor(descriptor);
  });
}

@end
