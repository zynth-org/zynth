#import "RuneUIManager+TextInput.h"
#import "RuneUIManager+Events.h"
#import "RuneUIManager+Layout.h"
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

@implementation SNUIManager (RuneTextInput)

static const void *kSNTextInputStatesKey = &kSNTextInputStatesKey;

static NSMutableDictionary<NSNumber *, SNTextInputState *> *SNTextInputStateMap(SNUIManager *manager) {
  NSMutableDictionary *states = objc_getAssociatedObject(manager, kSNTextInputStatesKey);
  if (!states) {
    states = [NSMutableDictionary new];
    objc_setAssociatedObject(manager, kSNTextInputStatesKey, states, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  return states;
}

- (SNTextInputState *)sn_textInputStateForNode:(SNNode *)node create:(BOOL)create {
  if (!node) return nil;
  NSMutableDictionary *states = SNTextInputStateMap(self);
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

- (UIView *_Nullable)sn_textInputCreateView {
  RuneTextInputView *view = [[RuneTextInputView alloc] initWithFrame:CGRectZero];
  view.backgroundColor = [UIColor clearColor];
  return view;
}

- (void)sn_textInputAttachNode:(SNNode *)node view:(RuneTextInputView *)view {
  if (!node || !view) return;
  SNTextInputState *state = [self sn_textInputStateForNode:node create:YES];
  state.view = view;
  state.currentText = @"";
  view.manager = self;
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
}

- (BOOL)sn_textInputHandlesSetPropForNode:(SNNode *)node
                                     name:(NSString *)name
                                    value:(id)value
                                   rawJSON:(NSString *)json {
  if (!node || ![node.view isKindOfClass:[RuneTextInputView class]]) {
    return NO;
  }
  RuneTextInputView *view = (RuneTextInputView *)node.view;
  SNTextInputState *state = [self sn_textInputStateForNode:node create:YES];

  NSLog(@"[RuneTextInput] setProp name=%@ value=%@ valueClass=%@ rawJSON=%@ node=%ld",
        name,
        value,
        NSStringFromClass([value class]),
        json,
        (long)node.nid);

  if ([name isEqualToString:@"value"]) {
    NSString *text = [value isKindOfClass:[NSString class]] ? value : (value ? [value description] : @"");
    if (!text) text = @"";
    state.awaitingInitialValue = NO;
    state.hasAppliedInitialText = YES;
    state.currentText = text;
    [view performProgrammaticUpdate:^{
      view.text = text;
    }];
    if (node.yoga) {
      YGNodeMarkDirty(node.yoga);
      [self rune_markNeedsFlush];
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
      if (node.yoga) {
        YGNodeMarkDirty(node.yoga);
        [self rune_markNeedsFlush];
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
    NSLog(@"[RuneTextInput] applying maxLength=%ld node=%ld", (long)maxLen, (long)node.nid);
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
    } else if ([json isKindOfClass:[NSString class]] && json.length > 0) {
      NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
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

  if ([name isEqualToString:@"eventThrottleMs"]) {
    double ms = [value respondsToSelector:@selector(doubleValue)] ? [value doubleValue] : 0.0;
    view.eventThrottle = ms / 1000.0;
    return YES;
  }

  if ([name isEqualToString:@"style"]) {
    // already handled in main setProp
    return NO;
  }

  return NO;
}

- (BOOL)sn_textInputHandlesSetPropCallbackForNode:(SNNode *)node
                                             name:(NSString *)name
                                         callback:(JSValue *_Nullable)callback {
  (void)callback;
  if (!node || ![node.view isKindOfClass:[RuneTextInputView class]]) return NO;
  // currently all callback props are routed through setHandler
  return NO;
}

- (BOOL)sn_textInputHandlesSetHandlerForNode:(SNNode *)node name:(NSString *)name {
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

- (void)sn_textInputCleanupNode:(SNNode *)node {
  if (!node) return;
  NSMutableDictionary *states = SNTextInputStateMap(self);
  SNTextInputState *state = states[@(node.nid)];
  if (state) {
    state.view.manager = nil;
    state.view.node = nil;
    state.currentText = nil;
    [states removeObjectForKey:@(node.nid)];
  }
  if (node.yoga) {
    YGNodeSetMeasureFunc(node.yoga, NULL);
    YGNodeSetContext(node.yoga, NULL);
  }
}

- (void)sn_textInputResetStates {
  NSMutableDictionary *states = SNTextInputStateMap(self);
  [states enumerateKeysAndObjectsUsingBlock:^(NSNumber *key, SNTextInputState *obj, BOOL *stop) {
    obj.view.manager = nil;
    obj.view.node = nil;
  }];
  [states removeAllObjects];
}

- (void)sn_textInputUpdateTextForNode:(SNNode *)node text:(NSString *)text {
  if (!node) return;
  NSMutableDictionary *states = SNTextInputStateMap(self);
  SNTextInputState *state = states[@(node.nid)];
  if (!state) return;
  state.currentText = text ?: @"";
  state.hasAppliedInitialText = YES;
  state.awaitingInitialValue = NO;
}

- (void)sn_textInputSelectionDidChangeForNode:(SNNode *)node {
  if (!node) return;
  // placeholder for future selection state tracking
  (void)node;
}

@end
