#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthKit.h"
#import "ZynthComponentRegistry.h"
#import "ZynthComponentAPI.h"
#import "ZynthUIManager.h"
#import "ZynthNode.h"
#endif

#import "ZynthTextInputView.h"
#import "ZynthSecureTextInputView.h"
#import <Yoga/Yoga.h>
#import <objc/runtime.h>

static YGSize SNMeasureTextInput(YGNodeConstRef node,
                                 float width,
                                 YGMeasureMode widthMode,
                                 float height,
                                 YGMeasureMode heightMode) {
  ZynthTextInputView *view = (__bridge ZynthTextInputView *)YGNodeGetContext(node);
  if (![view isKindOfClass:[ZynthTextInputView class]]) {
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
  ZynthSecureTextInputView *view = (__bridge ZynthSecureTextInputView *)YGNodeGetContext(node);
  if (![view isKindOfClass:[ZynthSecureTextInputView class]]) {
    return (YGSize){.width = 0, .height = 0};
  }
  CGSize measured = [view measureForWidth:width height:height widthMode:widthMode heightMode:heightMode];
  return (YGSize){.width = measured.width, .height = measured.height};
}

@interface SNTextInputState : NSObject
@property(nonatomic, weak) ZynthTextInputView *view;
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

static NSMutableDictionary<NSNumber *, SNTextInputState *> *SNTextInputStateMap(ZynthUIManager *manager) {
  NSMutableDictionary *states = objc_getAssociatedObject(manager, kSNTextInputStatesKey);
  if (!states) {
    states = [NSMutableDictionary new];
    objc_setAssociatedObject(manager, kSNTextInputStatesKey, states, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  return states;
}

static SNTextInputState *SNTextInputStateForNode(ZynthUIManager *manager, ZynthNode *node, BOOL create) {
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

static BOOL ZynthTextInputHandleSetProp(ZynthUIManager *manager,
                                       ZynthNode *node,
                                       NSString *name,
                                       id value,
                                       NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[ZynthTextInputView class]]) {
    return NO;
  }
  ZynthTextInputView *view = (ZynthTextInputView *)node.view;
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

static BOOL ZynthTextInputHandleSetHandler(ZynthUIManager *manager,
                                          ZynthNode *node,
                                          NSString *name) {
  if (!node || ![node.view isKindOfClass:[ZynthTextInputView class]]) return NO;
  ZynthTextInputView *view = (ZynthTextInputView *)node.view;

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

static CGFloat ZynthTextNum(id x) {
  return x && ![x isKindOfClass:[NSNull class]] ? [x doubleValue] : NAN;
}

static UIFont *ZynthResolveFontFamily(NSString *fontFamily,
                                      CGFloat size,
                                      UIFontDescriptorSymbolicTraits traits) {
  if (![fontFamily isKindOfClass:[NSString class]] || fontFamily.length == 0) {
    return nil;
  }

  UIFont *font = [UIFont fontWithName:fontFamily size:size];
  if (!font) {
    NSString *regularName = [fontFamily stringByAppendingString:@"Regular"];
    font = [UIFont fontWithName:regularName size:size];
  }
  if (!font) {
    NSArray<NSString *> *familyMembers = [UIFont fontNamesForFamilyName:fontFamily];
    if (familyMembers.count > 0) {
      font = [UIFont fontWithName:familyMembers.firstObject size:size];
    }
  }
  if (font && traits != 0) {
    UIFontDescriptor *descriptor = [font.fontDescriptor fontDescriptorWithSymbolicTraits:traits];
    if (descriptor) {
      UIFont *traitFont = [UIFont fontWithDescriptor:descriptor size:size];
      if (traitFont) {
        font = traitFont;
      }
    }
  }
  return font;
}

static void ZynthTextInputHandleStyle(ZynthUIManager *manager, ZynthNode *node, NSDictionary *style) {
  if (!node || !style) return;
  
  // Both ZynthTextInputView (UITextView) and ZynthSecureTextInputView (UITextField) 
  // share the properties we care about: font, textColor, textAlignment.
  // We use `id` casting or specific checks to apply them.
  
  UIView *view = node.view;
  BOOL isTextView = [view isKindOfClass:[ZynthTextInputView class]];
  BOOL isTextField = [view isKindOfClass:[ZynthSecureTextInputView class]];
  
  if (!isTextView && !isTextField) return;

  // Font Size
  CGFloat defaultSize = 16.0; // Default system size
  NSNumber *fontSize = style[@"fontSize"];
  CGFloat resolvedSize = fontSize ? (CGFloat)ZynthTextNum(fontSize) : defaultSize;

  // Font Family & Weight
  NSString *fontFamily = style[@"fontFamily"];
  NSString *fontStyle = style[@"fontStyle"];
  id fontWeightValue = style[@"fontWeight"];
  NSString *fontWeight = nil;
  if ([fontWeightValue isKindOfClass:[NSNumber class]]) {
    fontWeight = [(NSNumber *)fontWeightValue stringValue];
  } else if ([fontWeightValue isKindOfClass:[NSString class]]) {
    fontWeight = (NSString *)fontWeightValue;
  }

  NSDictionary *weights = @{
    @"normal": @(UIFontWeightRegular),
    @"bold": @(UIFontWeightBold),
    @"100": @(UIFontWeightUltraLight),
    @"200": @(UIFontWeightThin),
    @"300": @(UIFontWeightLight),
    @"400": @(UIFontWeightRegular),
    @"500": @(UIFontWeightMedium),
    @"600": @(UIFontWeightSemibold),
    @"700": @(UIFontWeightBold),
    @"800": @(UIFontWeightHeavy),
    @"900": @(UIFontWeightBlack)
  };
  NSNumber *weightNum = weights[fontWeight ?: @""] ?: @(UIFontWeightRegular);
  UIFontDescriptorSymbolicTraits traits = 0;
  if ([fontStyle isKindOfClass:[NSString class]] && [fontStyle isEqualToString:@"italic"]) {
    traits |= UIFontDescriptorTraitItalic;
  }
  
  BOOL isBold = NO;
  if (fontWeight) {
    if ([fontWeight isEqualToString:@"bold"] || 
        [fontWeight isEqualToString:@"700"] || 
        [fontWeight isEqualToString:@"800"] || 
        [fontWeight isEqualToString:@"900"]) {
      isBold = YES;
    } else if ([fontWeight integerValue] >= 600) {
      isBold = YES;
    }
  }
  if (isBold) {
    traits |= UIFontDescriptorTraitBold;
  }

  UIFont *font = nil;
  BOOL hasCustomFontProp = fontSize || (fontFamily && fontFamily.length > 0) || fontWeight || traits != 0;
  
  if (hasCustomFontProp) {
    if ([fontFamily isKindOfClass:[NSString class]] && fontFamily.length > 0) {
      font = ZynthResolveFontFamily(fontFamily, resolvedSize, traits);
    } else {
      UIFont *baseFont = [UIFont systemFontOfSize:resolvedSize weight:(CGFloat)[weightNum doubleValue]];
      if (traits != 0) {
        UIFontDescriptor *descriptor = [baseFont.fontDescriptor fontDescriptorWithSymbolicTraits:traits];
        if (descriptor) {
          UIFont *traitFont = [UIFont fontWithDescriptor:descriptor size:resolvedSize];
          if (traitFont) {
            baseFont = traitFont;
          }
        }
      }
      font = baseFont;
    }
  } else {
    font = [UIFont systemFontOfSize:resolvedSize];
  }
  
  if (font) {
    if (isTextView) ((ZynthTextInputView *)view).font = font;
    if (isTextField) ((ZynthSecureTextInputView *)view).font = font;
  }

  // Color
  NSString *color = style[@"color"];
  if (color) {
    UIColor *uicolor = ZynthColorFromHex(color);
    if (isTextView) ((ZynthTextInputView *)view).textColor = uicolor;
    if (isTextField) ((ZynthSecureTextInputView *)view).textColor = uicolor;
  }
  
  // Text Align
  NSString *textAlign = style[@"textAlign"];
  NSTextAlignment alignment = NSTextAlignmentLeft;
  BOOL hasAlign = NO;
  if ([textAlign isEqualToString:@"center"]) { alignment = NSTextAlignmentCenter; hasAlign = YES; }
  else if ([textAlign isEqualToString:@"right"]) { alignment = NSTextAlignmentRight; hasAlign = YES; }
  else if ([textAlign isEqualToString:@"justify"]) { alignment = NSTextAlignmentJustified; hasAlign = YES; }
  else if ([textAlign isEqualToString:@"left"]) { alignment = NSTextAlignmentLeft; hasAlign = YES; }
  
  if (hasAlign) {
    if (isTextView) ((ZynthTextInputView *)view).textAlignment = alignment;
    if (isTextField) ((ZynthSecureTextInputView *)view).textAlignment = alignment;
  }
}

static BOOL ZynthSecureTextInputHandleSetProp(ZynthUIManager *manager,
                                             ZynthNode *node,
                                             NSString *name,
                                             id value,
                                             NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[ZynthSecureTextInputView class]]) {
    return NO;
  }
  ZynthSecureTextInputView *view = (ZynthSecureTextInputView *)node.view;

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

static BOOL ZynthSecureTextInputHandleSetHandler(ZynthUIManager *manager,
                                                ZynthNode *node,
                                                NSString *name) {
  if (!node || ![node.view isKindOfClass:[ZynthSecureTextInputView class]]) return NO;
  ZynthSecureTextInputView *view = (ZynthSecureTextInputView *)node.view;

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

@interface ZynthUIManager (TextInputComponent)
@end

@implementation ZynthUIManager (TextInputComponent)

+ (void)load {
  static dispatch_once_t textInputToken;
  dispatch_once(&textInputToken, ^{
    ZynthComponentDescriptor *descriptor = [[ZynthComponentDescriptor alloc] initWithType:@"text-input"];
    descriptor.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      ZynthTextInputView *view = [[ZynthTextInputView alloc] initWithFrame:CGRectZero];
      view.backgroundColor = [UIColor clearColor];
      return view;
    };
    descriptor.attach = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[ZynthTextInputView class]]) return;
      ZynthTextInputView *view = (ZynthTextInputView *)node.view;
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
    descriptor.handleSetProp = ^BOOL(ZynthUIManager *manager, ZynthNode *node, NSString *name, id value, NSString *rawJSON) {
      return ZynthTextInputHandleSetProp(manager, node, name, value, rawJSON);
    };
    descriptor.handleSetHandler = ^BOOL(ZynthUIManager *manager, ZynthNode *node, NSString *name) {
      return ZynthTextInputHandleSetHandler(manager, node, name);
    };
    descriptor.applyStyle = ^(ZynthUIManager *manager, ZynthNode *node, NSDictionary *style) {
      ZynthTextInputHandleStyle(manager, node, style);
    };
    ZynthRegisterComponentDescriptor(descriptor);
  });

  static dispatch_once_t secureTextInputToken;
  dispatch_once(&secureTextInputToken, ^{
    ZynthComponentDescriptor *descriptor = [[ZynthComponentDescriptor alloc] initWithType:@"secure-text-input"];
    descriptor.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      ZynthSecureTextInputView *view = [[ZynthSecureTextInputView alloc] initWithFrame:CGRectZero];
      view.backgroundColor = [UIColor clearColor];
      return view;
    };
    descriptor.attach = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[ZynthSecureTextInputView class]]) return;
      ZynthSecureTextInputView *view = (ZynthSecureTextInputView *)node.view;
      view.manager = manager;
      view.node = node;
      view.blurOnSubmit = NO;
      if (node.yoga) {
        YGNodeSetContext(node.yoga, (__bridge void *)view);
        YGNodeSetMeasureFunc(node.yoga, SNMeasureSecureTextInput);
        YGNodeStyleSetWidthPercent(node.yoga, 100.0f);
      }
    };
    descriptor.handleSetProp = ^BOOL(ZynthUIManager *manager, ZynthNode *node, NSString *name, id value, NSString *rawJSON) {
      return ZynthSecureTextInputHandleSetProp(manager, node, name, value, rawJSON);
    };
    descriptor.handleSetHandler = ^BOOL(ZynthUIManager *manager, ZynthNode *node, NSString *name) {
      return ZynthSecureTextInputHandleSetHandler(manager, node, name);
    };
    descriptor.applyStyle = ^(ZynthUIManager *manager, ZynthNode *node, NSDictionary *style) {
      ZynthTextInputHandleStyle(manager, node, style);
    };
    ZynthRegisterComponentDescriptor(descriptor);
  });
}

@end
