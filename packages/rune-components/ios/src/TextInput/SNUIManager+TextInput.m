#if __has_include(<RuneKit/RuneKit.h>)
#import <RuneKit/RuneKit.h>
#else
#import "RuneKit.h"
#import "RuneComponentRegistry.h"
#import "RuneComponentAPI.h"
#import "SNUIManager.h"
#import "SNNode.h"
#endif

#import "RuneTextInputView.h"
#import "RuneSecureTextInputView.h"
#import <Yoga/Yoga.h>
#import <objc/runtime.h>

static YGSize SNMeasureTextInput(YGNodeConstRef node,
                                 float width,
                                 YGMeasureMode widthMode,
                                 float height,
                                 YGMeasureMode heightMode) {
  RuneTextInputView *view = (__bridge RuneTextInputView *)YGNodeGetContext(node);
  if (![view isKindOfClass:[RuneTextInputView class]]) {
    return (YGSize){.width = 0, .height = 0};
  }
  CGSize measured = [view measureForWidth:width height:height widthMode:widthMode heightMode:heightMode];
  return (YGSize){.width = measured.width, .height = measured.height};
}

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

@interface SNTextInputState : NSObject
@property(nonatomic, weak) RuneTextInputView *view;
@property(nonatomic, copy, nullable) NSString *defaultValue;
@property(nonatomic, copy, nullable) NSString *currentText;
@property(nonatomic, assign) BOOL mounting;
@property(nonatomic, assign) BOOL awaitingInitialValue;
@property(nonatomic, assign) BOOL hasAppliedInitialText;
@property(nonatomic, strong, nullable) NSDictionary *pendingSelection;
@end

@implementation SNTextInputState
@end

static const void *kSNTextInputStatesKey = &kSNTextInputStatesKey;

static NSMutableDictionary<NSNumber *, SNTextInputState *> *SNTextInputStateMap(SNUIManager *manager) {
  NSMutableDictionary *states = objc_getAssociatedObject(manager, kSNTextInputStatesKey);
  if (!states) {
    states = [NSMutableDictionary new];
    objc_setAssociatedObject(manager, kSNTextInputStatesKey, states, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  return states;
}

static SNTextInputState *SNTextInputStateForNode(SNUIManager *manager, SNNode *node, BOOL create) {
  if (!node) return nil;
  NSMutableDictionary *states = SNTextInputStateMap(manager);
  SNTextInputState *state = states[@(node.nid)];
  if (!state && create) {
    state = [SNTextInputState new];
    state.mounting = YES;
    state.awaitingInitialValue = YES;
    state.hasAppliedInitialText = NO;
    states[@(node.nid)] = state;
  }
  return state;
}

static BOOL RuneTextInputHandleSetProp(SNUIManager *manager,
                                       SNNode *node,
                                       NSString *name,
                                       id value,
                                       NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[RuneTextInputView class]]) {
    return NO;
  }
  RuneTextInputView *view = (RuneTextInputView *)node.view;
  SNTextInputState *state = SNTextInputStateForNode(manager, node, YES);

  if ([name isEqualToString:@"value"]) {
    NSString *text = [value isKindOfClass:[NSString class]] ? value : (value ? [value description] : @"");
    if (!text) text = @"";
    state.awaitingInitialValue = NO;
    state.hasAppliedInitialText = YES;
    state.currentText = text;
    [view performProgrammaticUpdate:^{
      view.text = text;
    }];
    if (node.yoga && YGNodeGetOwner(node.yoga)) {
      YGNodeMarkDirty(node.yoga);
    }
    return YES;
  }

  if ([name isEqualToString:@"defaultValue"]) {
    NSString *text = [value isKindOfClass:[NSString class]] ? value : nil;
    NSString *previousDefault = state.defaultValue ?: @"";
    state.defaultValue = text ?: @"";

    BOOL shouldApply = state.awaitingInitialValue || !state.hasAppliedInitialText;
    if (!shouldApply) {
      NSString *current = state.currentText ?: (view.text ?: @"");
      if (current.length == 0) {
        shouldApply = YES;
      } else if ([current isEqualToString:previousDefault]) {
        shouldApply = YES;
      }
    }

    if (shouldApply) {
      NSString *initial = state.defaultValue ?: @"";
      state.currentText = initial;
      state.awaitingInitialValue = NO;
      state.hasAppliedInitialText = YES;
      [view performProgrammaticUpdate:^{
        view.text = initial;
      }];
      if (node.yoga && YGNodeGetOwner(node.yoga)) {
        YGNodeMarkDirty(node.yoga);
      }
    }
    return YES;
  }

  if ([name isEqualToString:@"placeholder"]) {
    view.placeholder = [value isKindOfClass:[NSString class]] ? value : nil;
    return YES;
  }

  if ([name isEqualToString:@"multiline"]) {
    view.multiline = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
    return YES;
  }

  if ([name isEqualToString:@"numberOfLines"]) {
    view.numberOfLinesHint = [value respondsToSelector:@selector(integerValue)] ? [value integerValue] : 0;
    return YES;
  }

  if ([name isEqualToString:@"maxLength"]) {
    NSInteger maxLen = [value respondsToSelector:@selector(integerValue)] ? [value integerValue] : -1;
    view.maxLength = maxLen;
    return YES;
  }

  if ([name isEqualToString:@"editable"]) {
    BOOL editable = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : YES;
    [view applyEditable:editable];
    return YES;
  }

  if ([name isEqualToString:@"secureTextEntry"]) {
    BOOL secure = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
    [view applySecureEntry:secure];
    return YES;
  }

  if ([name isEqualToString:@"inputMode"]) {
    NSString *mode = [value isKindOfClass:[NSString class]] ? value : nil;
    [view applyInputMode:mode];
    return YES;
  }

  if ([name isEqualToString:@"autoCapitalize"]) {
    NSString *mode = [value isKindOfClass:[NSString class]] ? value : nil;
    [view applyAutoCapitalize:mode];
    return YES;
  }

  if ([name isEqualToString:@"autoCorrect"]) {
    [view applyAutoCorrect:[value respondsToSelector:@selector(boolValue)] ? value : nil];
    return YES;
  }

  if ([name isEqualToString:@"spellCheck"]) {
    [view applySpellCheck:[value respondsToSelector:@selector(boolValue)] ? value : nil];
    return YES;
  }

  if ([name isEqualToString:@"returnKeyType"]) {
    NSString *type = [value isKindOfClass:[NSString class]] ? value : nil;
    [view applyReturnKeyType:type];
    return YES;
  }

  if ([name isEqualToString:@"blurOnSubmit"]) {
    view.blurOnSubmit = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
    return YES;
  }

  if ([name isEqualToString:@"submitBehavior"]) {
    NSString *behavior = [value isKindOfClass:[NSString class]] ? value : nil;
    if (behavior.length == 0) {
      behavior = @"submit";
    }
    view.submitBehavior = behavior ?: @"submit";
    return YES;
  }

  if ([name isEqualToString:@"selection"]) {
    NSDictionary *sel = nil;
    if ([value isKindOfClass:[NSDictionary class]]) {
      sel = value;
    } else if ([rawJSON isKindOfClass:[NSString class]] && rawJSON.length > 0) {
      NSData *data = [rawJSON dataUsingEncoding:NSUTF8StringEncoding];
      NSDictionary *parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
      if ([parsed isKindOfClass:[NSDictionary class]]) {
        sel = parsed;
      }
    }
    if (sel) {
      state.pendingSelection = sel;
      dispatch_async(dispatch_get_main_queue(), ^{
        [view applySelectionFromDictionary:sel];
      });
    }
    return YES;
  }

  if ([name isEqualToString:@"selectionColor"]) {
    NSString *hex = [value isKindOfClass:[NSString class]] ? value : nil;
    [view applySelectionColor:hex];
    return YES;
  }

  if ([name isEqualToString:@"caretColor"]) {
    NSString *hex = [value isKindOfClass:[NSString class]] ? value : nil;
    [view applyCaretColor:hex];
    return YES;
  }

  if ([name isEqualToString:@"placeholderTextColor"]) {
    NSString *hex = [value isKindOfClass:[NSString class]] ? value : nil;
    [view applyPlaceholderTextColor:hex];
    return YES;
  }

  if ([name isEqualToString:@"eventThrottleMs"]) {
    double ms = [value respondsToSelector:@selector(doubleValue)] ? [value doubleValue] : 0.0;
    view.eventThrottle = ms / 1000.0;
    return YES;
  }

  if ([name isEqualToString:@"style"]) {
    return NO;
  }

  return NO;
}

static BOOL RuneTextInputHandleSetHandler(SNUIManager *manager,
                                          SNNode *node,
                                          NSString *name) {
  if (!node || ![node.view isKindOfClass:[RuneTextInputView class]]) return NO;
  RuneTextInputView *view = (RuneTextInputView *)node.view;

  if ([name isEqualToString:@"onChange"]) {
    view.hasOnChange = YES;
    return YES;
  }

  if ([name isEqualToString:@"onChangeText"]) {
    view.hasOnChangeText = YES;
    return YES;
  }

  if ([name isEqualToString:@"onSelectionChange"]) {
    view.hasOnSelectionChange = YES;
    return YES;
  }

  if ([name isEqualToString:@"onFocus"]) {
    view.hasOnFocus = YES;
    return YES;
  }

  if ([name isEqualToString:@"onBlur"]) {
    view.hasOnBlur = YES;
    return YES;
  }

  if ([name isEqualToString:@"onSubmitEditing"]) {
    view.hasOnSubmitEditing = YES;
    return YES;
  }

  if ([name isEqualToString:@"onKeyPress"]) {
    view.hasOnKeyPress = YES;
    return YES;
  }

  if ([name isEqualToString:@"onCompositionStart"]) {
    view.hasOnCompositionStart = YES;
    return YES;
  }

  if ([name isEqualToString:@"onCompositionEnd"]) {
    view.hasOnCompositionEnd = YES;
    return YES;
  }

  return NO;
}

static BOOL RuneSecureTextInputHandleSetProp(SNUIManager *manager,
                                             SNNode *node,
                                             NSString *name,
                                             id value,
                                             NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[RuneSecureTextInputView class]]) {
    return NO;
  }
  RuneSecureTextInputView *view = (RuneSecureTextInputView *)node.view;

  if ([name isEqualToString:@"value"]) {
    NSString *text = [value isKindOfClass:[NSString class]] ? value : (value ? [value description] : @"");
    view.text = text ?: @"";
    return YES;
  }

  if ([name isEqualToString:@"defaultValue"]) {
    NSString *text = [value isKindOfClass:[NSString class]] ? value : nil;
    if (text && view.text.length == 0) {
      view.text = text;
    }
    return YES;
  }

  if ([name isEqualToString:@"placeholder"]) {
    view.placeholder = [value isKindOfClass:[NSString class]] ? value : nil;
    return YES;
  }

  if ([name isEqualToString:@"editable"]) {
    BOOL editable = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : YES;
    view.enabled = editable;
    return YES;
  }

  if ([name isEqualToString:@"secureTextEntry"]) {
    BOOL secure = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
    view.secureTextEntry = secure;
    return YES;
  }

  if ([name isEqualToString:@"blurOnSubmit"]) {
    view.blurOnSubmit = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
    return YES;
  }

  if ([name isEqualToString:@"submitBehavior"]) {
    NSString *behavior = [value isKindOfClass:[NSString class]] ? value : nil;
    view.submitBehavior = behavior ?: @"submit";
    return YES;
  }

  if ([name isEqualToString:@"caretColor"]) {
    NSString *hex = [value isKindOfClass:[NSString class]] ? value : nil;
    [view applyCaretColor:hex];
    return YES;
  }

  if ([name isEqualToString:@"placeholderTextColor"]) {
    NSString *hex = [value isKindOfClass:[NSString class]] ? value : nil;
    [view applyPlaceholderTextColor:hex];
    return YES;
  }

  if ([name isEqualToString:@"selectionColor"]) {
    NSString *hex = [value isKindOfClass:[NSString class]] ? value : nil;
    [view applySelectionColor:hex];
    return YES;
  }

  if ([name isEqualToString:@"eventThrottleMs"]) {
    double ms = [value respondsToSelector:@selector(doubleValue)] ? [value doubleValue] : 0.0;
    view.eventThrottle = ms / 1000.0;
    return YES;
  }

  return NO;
}

static BOOL RuneSecureTextInputHandleSetHandler(SNUIManager *manager,
                                                SNNode *node,
                                                NSString *name) {
  if (!node || ![node.view isKindOfClass:[RuneSecureTextInputView class]]) return NO;
  RuneSecureTextInputView *view = (RuneSecureTextInputView *)node.view;

  if ([name isEqualToString:@"onChangeText"]) {
    view.hasOnChangeText = YES;
    return YES;
  }

  if ([name isEqualToString:@"onFocus"]) {
    view.hasOnFocus = YES;
    return YES;
  }

  if ([name isEqualToString:@"onBlur"]) {
    view.hasOnBlur = YES;
    return YES;
  }

  if ([name isEqualToString:@"onSubmitEditing"]) {
    view.hasOnSubmitEditing = YES;
    return YES;
  }

  return NO;
}

@interface SNUIManager (TextInputComponent)
@end

@implementation SNUIManager (TextInputComponent)

+ (void)load {
  static dispatch_once_t textInputToken;
  dispatch_once(&textInputToken, ^{
    RuneComponentDescriptor *descriptor = [[RuneComponentDescriptor alloc] initWithType:@"text-input"];
    descriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      RuneTextInputView *view = [[RuneTextInputView alloc] initWithFrame:CGRectZero];
      view.backgroundColor = [UIColor clearColor];
      return view;
    };
    descriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[RuneTextInputView class]]) return;
      RuneTextInputView *view = (RuneTextInputView *)node.view;
      SNTextInputState *state = SNTextInputStateForNode(manager, node, YES);
      state.view = view;
      state.currentText = @"";
      view.manager = manager;
      view.node = node;
      view.multiline = NO;
      view.autocorrectionType = UITextAutocorrectionTypeDefault;
      view.spellCheckingType = UITextSpellCheckingTypeDefault;
      view.autocapitalizationType = UITextAutocapitalizationTypeSentences;
      view.eventThrottle = 0.0;
      view.maxLength = -1;
      view.blurOnSubmit = NO;
      if (node.yoga) {
        YGNodeSetContext(node.yoga, (__bridge void *)view);
        YGNodeSetMeasureFunc(node.yoga, SNMeasureTextInput);
        YGNodeStyleSetWidthPercent(node.yoga, 100.0f);
      }
      state.mounting = NO;
    };
    descriptor.handleSetProp = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name, id value, NSString *rawJSON) {
      return RuneTextInputHandleSetProp(manager, node, name, value, rawJSON);
    };
    descriptor.handleSetHandler = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name) {
      return RuneTextInputHandleSetHandler(manager, node, name);
    };
    RuneRegisterComponentDescriptor(descriptor);
  });

  static dispatch_once_t secureTextInputToken;
  dispatch_once(&secureTextInputToken, ^{
    RuneComponentDescriptor *descriptor = [[RuneComponentDescriptor alloc] initWithType:@"secure-text-input"];
    descriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      RuneSecureTextInputView *view = [[RuneSecureTextInputView alloc] initWithFrame:CGRectZero];
      view.backgroundColor = [UIColor clearColor];
      return view;
    };
    descriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[RuneSecureTextInputView class]]) return;
      RuneSecureTextInputView *view = (RuneSecureTextInputView *)node.view;
      view.manager = manager;
      view.node = node;
      view.blurOnSubmit = NO;
      if (node.yoga) {
        YGNodeSetContext(node.yoga, (__bridge void *)view);
        YGNodeSetMeasureFunc(node.yoga, SNMeasureSecureTextInput);
        YGNodeStyleSetWidthPercent(node.yoga, 100.0f);
      }
    };
    descriptor.handleSetProp = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name, id value, NSString *rawJSON) {
      return RuneSecureTextInputHandleSetProp(manager, node, name, value, rawJSON);
    };
    descriptor.handleSetHandler = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name) {
      return RuneSecureTextInputHandleSetHandler(manager, node, name);
    };
    RuneRegisterComponentDescriptor(descriptor);
  });
}

@end
