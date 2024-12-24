#import "RuneUIManager+SecureTextInput.h"
#import "RuneUIManager+Layout.h"
#import <Yoga/Yoga.h>
#import <objc/runtime.h>

static YGSize SNMeasureSecureTextInput(YGNodeConstRef node,
                                     float width,
                                     YGMeasureMode widthMode,
                                     float height,
                                     YGMeasureMode heightMode) {
  RuneSecureTextInputView *view = (__bridge RuneSecureTextInputView *)YGNodeGetContext(node);
  if (![view isKindOfClass:[RuneSecureTextInputView class]]) {
    return (YGSize){.width = 0, .height = 0};
  }
  CGSize measured = [view measureForWidth:width height:height widthMode:widthMode heightMode:heightMode];
  return (YGSize){.width = measured.width, .height = measured.height};
}

@implementation SNUIManager (RuneSecureTextInput)

- (UIView *)sn_secureTextInputCreateView {
  RuneSecureTextInputView *view = [[RuneSecureTextInputView alloc] initWithFrame:CGRectZero];
  return view;
}

- (void)sn_secureTextInputAttachNode:(SNNode *)node view:(RuneSecureTextInputView *)view {
  if (!node || !view) return;
  view.manager = self;
  view.node = node;
  if (node.yoga) {
    YGNodeSetContext(node.yoga, (__bridge void *)view);
    YGNodeSetMeasureFunc(node.yoga, SNMeasureSecureTextInput);
  }
}

- (BOOL)sn_secureTextInputHandlesSetPropForNode:(SNNode *)node
                                         name:(NSString *)name
                                        value:(id)value
                                      rawJSON:(NSString *)json {
  if (!node || ![node.view isKindOfClass:[RuneSecureTextInputView class]]) {
    return NO;
  }
  RuneSecureTextInputView *view = (RuneSecureTextInputView *)node.view;

  if ([name isEqualToString:@"value"]) {
    NSString *text = [value isKindOfClass:[NSString class]] ? value : (value ? [value description] : @"");
    view.text = text;
    return YES;
  }

  if ([name isEqualToString:@"defaultValue"]) {
      if (view.text.length == 0) {
          NSString *text = [value isKindOfClass:[NSString class]] ? value : nil;
          view.text = text;
      }
      return YES;
  }

  if ([name isEqualToString:@"placeholder"]) {
    view.placeholder = [value isKindOfClass:[NSString class]] ? value : nil;
    return YES;
  }

  if ([name isEqualToString:@"maxLength"]) {
    // UITextField doesn't have a built-in maxLength, would need to be handled in delegate
    return YES;
  }

  if ([name isEqualToString:@"editable"]) {
    view.enabled = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : YES;
    return YES;
  }

  if ([name isEqualToString:@"secureTextEntry"]) {
    view.secureTextEntry = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
    return YES;
  }

  if ([name isEqualToString:@"inputMode"]) {
      // Simplified version for UITextField
      return YES;
  }

  if ([name isEqualToString:@"autoCapitalize"]) {
      return YES;
  }

  if ([name isEqualToString:@"autoCorrect"]) {
      view.autocorrectionType = [value boolValue] ? UITextAutocorrectionTypeYes : UITextAutocorrectionTypeNo;
      return YES;
  }

  if ([name isEqualToString:@"returnKeyType"]) {
      return YES;
  }

  if ([name isEqualToString:@"blurOnSubmit"]) {
    view.blurOnSubmit = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
    return YES;
  }

  if ([name isEqualToString:@"selectionColor"]) {
    // Handled by caretColor on UITextField
    return YES;
  }

  if ([name isEqualToString:@"caretColor"]) {
    NSString *hex = [value isKindOfClass:[NSString class]] ? value : nil;
    [view applyCaretColor:hex];
    return YES;
  }

  if ([name isEqualToString:@"eventThrottleMs"]) {
    double ms = [value respondsToSelector:@selector(doubleValue)] ? [value doubleValue] : 0.0;
    view.eventThrottle = ms / 1000.0;
    return YES;
  }

  return NO;
}

- (BOOL)sn_secureTextInputHandlesSetHandlerForNode:(SNNode *)node name:(NSString *)name {
  if (!node || ![node.view isKindOfClass:[RuneSecureTextInputView class]]) return NO;
  RuneSecureTextInputView *view = (RuneSecureTextInputView *)node.view;

  if ([name isEqualToString:@"onChange"]) { view.hasOnChange = YES; return YES; }
  if ([name isEqualToString:@"onChangeText"]) { view.hasOnChangeText = YES; return YES; }
  if ([name isEqualToString:@"onSelectionChange"]) { view.hasOnSelectionChange = YES; return YES; }
  if ([name isEqualToString:@"onFocus"]) { view.hasOnFocus = YES; return YES; }
  if ([name isEqualToString:@"onBlur"]) { view.hasOnBlur = YES; return YES; }
  if ([name isEqualToString:@"onSubmitEditing"]) { view.hasOnSubmitEditing = YES; return YES; }
  if ([name isEqualToString:@"onKeyPress"]) { view.hasOnKeyPress = YES; return YES; }

  return NO;
}

- (void)sn_secureTextInputCleanupNode:(SNNode *)node {
  if (!node || ![node.view isKindOfClass:[RuneSecureTextInputView class]]) return;
  RuneSecureTextInputView *view = (RuneSecureTextInputView *)node.view;
  view.manager = nil;
  view.node = nil;
  if (node.yoga) {
    YGNodeSetMeasureFunc(node.yoga, NULL);
    YGNodeSetContext(node.yoga, NULL);
  }
}

@end
