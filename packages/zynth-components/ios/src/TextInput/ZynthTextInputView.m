#import "ZynthTextInputView.h"
#if __has_include(<ZynthKit/ZynthHexColor.h>)
#import <ZynthKit/ZynthHexColor.h>
#else
#import "ZynthHexColor.h"
#endif
#if __has_include(<ZynthKit/ZynthUIManager+Internal.h>)
#import <ZynthKit/ZynthUIManager+Internal.h>
#else
#import "ZynthUIManager+Internal.h"
#endif
#if __has_include(<ZynthKit/ZynthUIManager+Components.h>)
#import <ZynthKit/ZynthUIManager+Components.h>
#else
#import "ZynthUIManager+Components.h"
#endif
#import <Yoga/Yoga.h>
#import "ZynthNode.h"

static UIColor *ZynthColorFromHexOrNil(NSString *hex) {
  if (![hex isKindOfClass:[NSString class]] || hex.length == 0) {
    return nil;
  }
  return ZynthColorFromHex(hex);
}

@interface ZynthTextInputView ()
@property(nonatomic, strong) UILabel *placeholderLabel;
@property(nonatomic, strong) NSDate *lastChangeDispatch;
@property(nonatomic, assign) BOOL pendingChange;
@property(nonatomic, assign) NSRange pendingRange;
@property(nonatomic, copy) NSString *pendingInserted;
@property(nonatomic, copy) NSString *pendingRemoved;
@property(nonatomic, assign) BOOL suppressNativeEvent;
@property(nonatomic, assign) BOOL didEmitFocus;
@property(nonatomic, assign) BOOL didEmitCompositionStart;
- (void)reloadInputViewsIfNeeded;
@end

@implementation ZynthTextInputView

- (instancetype)initWithFrame:(CGRect)frame textContainer:(NSTextContainer *)textContainer {
  if (self = [super initWithFrame:frame textContainer:textContainer]) {
    [self configureDefaults];
  }
  return self;
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    [self configureDefaults];
  }
  return self;
}

- (instancetype)init {
  if (self = [super init]) {
    [self configureDefaults];
  }
  return self;
}

- (void)configureDefaults {
  self.delegate = self;
  self.backgroundColor = [UIColor clearColor];
  if (@available(iOS 13.0, *)) {
    self.textColor = [UIColor labelColor];
  } else {
    self.textColor = [UIColor blackColor];
  }
  self.font = [UIFont systemFontOfSize:16 weight:UIFontWeightRegular];
  self.textContainer.lineFragmentPadding = 0;
  self.textContainer.lineBreakMode = NSLineBreakByWordWrapping;
  self.scrollEnabled = NO;
  [self applyMultiline:NO numberOfLines:0];
  self.isEditableProp = YES;
  self.maxLength = -1;
  self.eventThrottle = 0.0;
  self.pendingInserted = @"";
  self.pendingRemoved = @"";
  self.lastChangeDispatch = [NSDate dateWithTimeIntervalSince1970:0];
  self.submitBehavior = @"submit";

  UILabel *placeholder = [UILabel new];
  placeholder.textColor = [[UIColor lightGrayColor] colorWithAlphaComponent:0.7];
  placeholder.font = self.font ?: [UIFont systemFontOfSize:17];
  placeholder.numberOfLines = 0;
  placeholder.translatesAutoresizingMaskIntoConstraints = NO;
  [self addSubview:placeholder];
  self.placeholderLeadingConstraint = [placeholder.leadingAnchor constraintEqualToAnchor:self.leadingAnchor constant:2];
  self.placeholderTopConstraint = [placeholder.topAnchor constraintEqualToAnchor:self.topAnchor constant:2];
  [NSLayoutConstraint activateConstraints:@[
    self.placeholderLeadingConstraint,
    [placeholder.trailingAnchor constraintEqualToAnchor:self.trailingAnchor constant:-2],
    self.placeholderTopConstraint
  ]];
  self.placeholderLabel = placeholder;
  [self updatePlaceholderVisibility];
}

- (void)layoutSubviews {
  [super layoutSubviews];
  [self updatePlaceholderVisibility];
  [self syncPaddingFromYoga];
}

- (void)syncPaddingFromYoga {
  if (!self.node || !self.node.yoga) return;
  YGNodeRef yoga = self.node.yoga;
  
  float top = YGNodeLayoutGetPadding(yoga, YGEdgeTop);
  float left = YGNodeLayoutGetPadding(yoga, YGEdgeLeft);
  float bottom = YGNodeLayoutGetPadding(yoga, YGEdgeBottom);
  float right = YGNodeLayoutGetPadding(yoga, YGEdgeRight);
  
  UIEdgeInsets newInsets = UIEdgeInsetsMake(top, left, bottom, right);
  if (!UIEdgeInsetsEqualToEdgeInsets(self.textContainerInset, newInsets)) {
    self.textContainerInset = newInsets;
    // Update placeholder constraints to match padding
    self.placeholderLeadingConstraint.constant = left + 2; // +2 for slight offset or strict matching? Original was constant:2
    self.placeholderTopConstraint.constant = top + 2;
  }
}

- (void)setText:(NSString *)text {
  NSLog(@"[ZynthTextInputView] setText=%@", text);
  [super setText:text];
  [self updatePlaceholderVisibility];
}

- (void)setAttributedText:(NSAttributedString *)attributedText {
  [super setAttributedText:attributedText];
  [self updatePlaceholderVisibility];
}

- (void)performProgrammaticUpdate:(dispatch_block_t)block {
  if (!block) return;
  BOOL previous = self.suppressNativeEvent;
  self.suppressNativeEvent = YES;
  NSLog(@"[ZynthTextInputView] performProgrammaticUpdate begin text=%@", self.text);
  block();
  NSLog(@"[ZynthTextInputView] performProgrammaticUpdate end text=%@", self.text);
  self.suppressNativeEvent = previous;
  [self updatePlaceholderVisibility];
}

- (void)setPlaceholder:(NSString *)placeholder {
  _placeholder = [placeholder copy];
  self.placeholderLabel.text = placeholder;
  [self applyPlaceholderToneFromTextColor];
  [self updatePlaceholderVisibility];
}

- (void)setEditable:(BOOL)editable {
  [super setEditable:editable];
  self.isEditableProp = editable;
}

- (void)setMultiline:(BOOL)multiline {
  [self applyMultiline:multiline numberOfLines:self.numberOfLinesHint];
}

- (void)setNumberOfLinesHint:(NSInteger)numberOfLinesHint {
  _numberOfLinesHint = numberOfLinesHint;
  [self applyMultiline:self.multiline numberOfLines:numberOfLinesHint];
}

- (void)applyCaretColor:(NSString *)hexString {
  UIColor *color = ZynthColorFromHexOrNil(hexString);
  if (color) {
    self.tintColor = color;
  }
}

- (void)applyPlaceholderTextColor:(NSString *)hexString {
  NSLog(@"[ZynthTextInputView] applyPlaceholderTextColor hex=%@", hexString);
  self.placeholderTextColor = ZynthColorFromHexOrNil(hexString);
  [self applyPlaceholderToneFromTextColor];
}

- (void)applyPlaceholderToneFromTextColor {
  if (self.placeholderTextColor) {
    self.placeholderLabel.textColor = self.placeholderTextColor;
    return;
  }
  UIColor *base = self.textColor ?: [UIColor lightGrayColor];
  self.placeholderLabel.textColor = [base colorWithAlphaComponent:0.45];
}

- (void)applySelectionColor:(NSString *)hexString {
  UIColor *color = ZynthColorFromHexOrNil(hexString);
  if (color) {
    self.typingAttributes = ({
      NSMutableDictionary *attrs = [self.typingAttributes mutableCopy] ?: [NSMutableDictionary new];
      attrs[NSForegroundColorAttributeName] = self.textColor ?: [UIColor labelColor];
      attrs;
    });
    self.tintColor = color;
  }
}

- (void)applySecureEntry:(BOOL)secure {
  BOOL wasFirstResponder = self.isFirstResponder;
  BOOL changed = self.secureTextEntry != secure;
  if (!changed) return;
  NSLog(@"[ZynthTextInputView] applySecureEntry secure=%@ text=%@", secure ? @"YES" : @"NO", self.text);

  NSString *currentText = [self.text copy] ?: @"";
  UITextRange *selectedRange = self.selectedTextRange;
  NSInteger cursorOffset = 0;
  if (selectedRange) {
    cursorOffset = [self offsetFromPosition:self.beginningOfDocument toPosition:selectedRange.start];
  }

  if (wasFirstResponder) {
    [self resignFirstResponder];
  }

  [self performProgrammaticUpdate:^{
    self.secureTextEntry = secure;
    self.text = currentText;

    // The magic font reset trick for UITextView's secureTextEntry
    UIFont *originalFont = self.font;
    self.font = nil;
    self.font = originalFont;

    NSInteger clampedOffset = MAX(0, MIN((NSInteger)currentText.length, cursorOffset));
    UITextPosition *startPos = [self positionFromPosition:self.beginningOfDocument offset:clampedOffset];
    UITextPosition *endPos = startPos;
    if (startPos) {
      [self setSelectedTextRange:[self textRangeFromPosition:startPos toPosition:endPos]];
    }
  }];

  if (wasFirstResponder) {
    [self becomeFirstResponder];
  }
}

- (void)applyEditable:(BOOL)editable {
  [super setEditable:editable];
  self.isEditableProp = editable;
}

- (void)applyMultiline:(BOOL)multiline numberOfLines:(NSInteger)hint {
  _multiline = multiline;
  if (multiline) {
    self.textContainer.maximumNumberOfLines = 0;
    self.scrollEnabled = YES;
    self.textContainer.lineBreakMode = NSLineBreakByWordWrapping;
  } else {
    self.textContainer.maximumNumberOfLines = 1;
    self.scrollEnabled = NO;
    self.textContainer.lineBreakMode = NSLineBreakByClipping;
  }

  if (hint > 0) {
    self.textContainer.maximumNumberOfLines = (NSUInteger)hint;
  }
}

- (void)reloadInputViewsIfNeeded {
  if (self.isFirstResponder) {
    [self reloadInputViews];
  }
}

- (void)applyInputMode:(NSString *_Nullable)mode {
  if (!mode) return;
  NSLog(@"[ZynthTextInputView] applyInputMode=%@", mode);
  NSDictionary<NSString *, NSNumber *> *map = @{
    @"text": @(UIKeyboardTypeDefault),
    @"numeric": @(UIKeyboardTypeNumberPad),
    @"decimal": @(UIKeyboardTypeDecimalPad),
    @"tel": @(UIKeyboardTypePhonePad),
    @"email": @(UIKeyboardTypeEmailAddress),
    @"url": @(UIKeyboardTypeURL),
    @"search": @(UIKeyboardTypeWebSearch),
  };
  NSNumber *type = map[mode];
  if (type) {
    self.keyboardType = (UIKeyboardType)type.integerValue;
    [self reloadInputViewsIfNeeded];
  }
}

- (void)applyAutoCapitalize:(NSString *_Nullable)mode {
  if (!mode) return;
  NSLog(@"[ZynthTextInputView] applyAutoCapitalize=%@", mode);
  NSDictionary<NSString *, NSNumber *> *map = @{
    @"none": @(UITextAutocapitalizationTypeNone),
    @"sentences": @(UITextAutocapitalizationTypeSentences),
    @"words": @(UITextAutocapitalizationTypeWords),
    @"characters": @(UITextAutocapitalizationTypeAllCharacters),
  };
  NSNumber *val = map[mode];
  if (val) {
    self.autocapitalizationType = (UITextAutocapitalizationType)val.integerValue;
    [self reloadInputViewsIfNeeded];
  }
}

- (void)applyAutoCorrect:(NSNumber *_Nullable)flag {
  if (!flag) return;
  NSLog(@"[ZynthTextInputView] applyAutoCorrect=%@", flag);
  self.autocorrectionType = flag.boolValue ? UITextAutocorrectionTypeYes : UITextAutocorrectionTypeNo;
  [self reloadInputViewsIfNeeded];
}

- (void)applySpellCheck:(NSNumber *_Nullable)flag {
  if (!flag) return;
  NSLog(@"[ZynthTextInputView] applySpellCheck=%@", flag);
  self.spellCheckingType = flag.boolValue ? UITextSpellCheckingTypeYes : UITextSpellCheckingTypeNo;
  [self reloadInputViewsIfNeeded];
}

- (void)applyReturnKeyType:(NSString *_Nullable)type {
  if (!type) return;
  NSLog(@"[ZynthTextInputView] applyReturnKeyType=%@", type);
  NSDictionary<NSString *, NSNumber *> *map = @{
    @"default": @(UIReturnKeyDefault),
    @"go": @(UIReturnKeyGo),
    @"next": @(UIReturnKeyNext),
    @"search": @(UIReturnKeySearch),
    @"send": @(UIReturnKeySend),
    @"done": @(UIReturnKeyDone),
  };
  NSNumber *val = map[type];
  if (val) {
    self.returnKeyType = (UIReturnKeyType)val.integerValue;
    [self reloadInputViewsIfNeeded];
  }
}

- (void)updatePlaceholderVisibility {
  BOOL hasContent = self.hasText;
  self.placeholderLabel.hidden = hasContent || self.placeholder.length == 0;
}

- (void)applySelectionFromDictionary:(NSDictionary *_Nullable)dict {
  if (![dict isKindOfClass:[NSDictionary class]]) return;
  NSLog(@"[ZynthTextInputView] applySelection=%@", dict);
  NSNumber *start = dict[@"start"];
  NSNumber *end = dict[@"end"];
  if (!start || !end) return;
  NSInteger s = MAX(0, start.integerValue);
  NSInteger e = MAX(0, end.integerValue);
  NSInteger length = self.text.length;
  s = MIN(s, length);
  e = MIN(e, length);
  if (e < s) e = s;
  NSRange range = NSMakeRange((NSUInteger)s, (NSUInteger)(e - s));
  UITextPosition *begin = [self positionFromPosition:self.beginningOfDocument offset:range.location];
  UITextPosition *finish = [self positionFromPosition:self.beginningOfDocument offset:(range.location + range.length)];
  if (!begin || !finish) return;
  UITextRange *textRange = [self textRangeFromPosition:begin toPosition:finish];
  if (textRange) {
    [self setSelectedTextRange:textRange];
  }
}

- (NSDictionary *)currentSelectionPayload {
  UITextRange *selected = self.selectedTextRange;
  if (!selected) {
    return @{@"start": @(0), @"end": @(0)};
  }
  NSInteger start = [self offsetFromPosition:self.beginningOfDocument toPosition:selected.start];
  NSInteger end = [self offsetFromPosition:self.beginningOfDocument toPosition:selected.end];
  return @{@"start": @(MAX(0, start)), @"end": @(MAX(0, end))};
}

- (BOOL)canBecomeFirstResponder {
  return self.isEditableProp && [super canBecomeFirstResponder];
}

#pragma mark - Event helpers

- (BOOL)shouldThrottleEvent {
  if (self.eventThrottle <= 0) return NO;
  NSTimeInterval elapsed = [[NSDate date] timeIntervalSinceDate:self.lastChangeDispatch];
  return elapsed < self.eventThrottle;
}

- (void)recordEventDispatch {
  self.lastChangeDispatch = [NSDate date];
}

- (void)emitFocusIfNeeded {
  if (!self.hasOnFocus || self.didEmitFocus) return;
  self.didEmitFocus = YES;
  if (!self.manager || !self.node) return;
  [self.manager zynth_dispatchEvent:@"onFocus" payload:@{} toNode:self.node];
  if (self.manager.jsInvoker) {
    [self.manager.jsInvoker invokeHandlerForNode:self.node.nid name:@"onFocus"];
  }
}

- (void)emitBlurIfNeeded {
  if (!self.hasOnBlur || !self.didEmitFocus) return;
  self.didEmitFocus = NO;
  if (!self.manager || !self.node) return;
  [self.manager zynth_dispatchEvent:@"onBlur" payload:@{} toNode:self.node];
  if (self.manager.jsInvoker) {
    [self.manager.jsInvoker invokeHandlerForNode:self.node.nid name:@"onBlur"];
  }
}

- (void)emitSelectionChanged {
  if (!self.manager || !self.node) return;
  NSDictionary *payload = @{@"selection": [self currentSelectionPayload]};
  if (self.hasOnSelectionChange) {
    [self.manager zynth_dispatchEvent:@"onSelectionChange" payload:payload toNode:self.node];
    if (self.manager.jsInvoker) {
      [self.manager.jsInvoker invokeHandlerForNode:self.node.nid name:@"onSelectionChange"];
    }
  }
}

- (void)emitKeyEventForReplacement:(NSString *)replacement {
  if (!self.hasOnKeyPress || !self.manager || !self.node) return;
  NSString *key = replacement.length == 0 ? @"Backspace" : replacement;
  NSDictionary *payload = @{@"key": key ?: @"", @"repeat": @(NO)};
  [self.manager zynth_dispatchEvent:@"onKeyPress" payload:payload toNode:self.node];
  if (self.manager.jsInvoker) {
    [self.manager.jsInvoker invokeHandlerForNode:self.node.nid name:@"onKeyPress"];
  }
}

- (void)emitChangeWithRange:(NSRange)range inserted:(NSString *)inserted removed:(NSString *)removed {
  if (!self.manager || !self.node) return;
  NSMutableDictionary *payload = [NSMutableDictionary dictionary];
  payload[@"range"] = @{@"start": @(range.location), @"end": @(range.location + range.length)};
  payload[@"inserted"] = inserted ?: @"";
  payload[@"removed"] = removed ?: @"";
  payload[@"textAfter"] = self.text ?: @"";
  payload[@"composing"] = @(self.isComposing);

  if (self.hasOnChange) {
    [self.manager zynth_dispatchEvent:@"onChange" payload:payload toNode:self.node];
    if (self.manager.jsInvoker) {
      [self.manager.jsInvoker invokeHandlerForNode:self.node.nid name:@"onChange"];
    }
  }

  if (self.hasOnChangeText) {
    NSDictionary *textPayload = @{@"text": self.text ?: @""};
    [self.manager zynth_dispatchEvent:@"onChangeText" payload:textPayload toNode:self.node];
    if (self.manager.jsInvoker) {
      [self.manager.jsInvoker invokeHandlerForNode:self.node.nid name:@"onChangeText"];
    }
  }
}

- (CGSize)measureForWidth:(CGFloat)width height:(CGFloat)height widthMode:(YGMeasureMode)widthMode heightMode:(YGMeasureMode)heightMode {
  CGSize constraint = CGSizeMake(CGFLOAT_MAX, CGFLOAT_MAX);
  if (widthMode == YGMeasureModeExactly) {
    constraint.width = width;
  } else if (widthMode == YGMeasureModeAtMost) {
    constraint.width = width;
  }

  if (heightMode == YGMeasureModeExactly) {
    constraint.height = height;
  } else if (heightMode == YGMeasureModeAtMost) {
    constraint.height = height;
  }

  // Yoga expects the measure function to return the *content* size.
  // Yoga itself adds the padding to the result to determine the node size.
  // However, UITextView's sizeThatFits includes textContainerInset (padding) in its result.
  // To avoid double-counting padding (once by UITextView, once by Yoga),
  // we temporarily zero out the insets during measurement.
  UIEdgeInsets originalInsets = self.textContainerInset;
  self.textContainerInset = UIEdgeInsetsZero;
  
  CGSize fitted = [self sizeThatFits:constraint];
  
  self.textContainerInset = originalInsets;

  CGFloat finalWidth = fitted.width;
  if (widthMode == YGMeasureModeExactly) finalWidth = width;
  else if (widthMode == YGMeasureModeAtMost) finalWidth = MIN(width, fitted.width);

  CGFloat finalHeight = fitted.height;
  if (heightMode == YGMeasureModeExactly) finalHeight = height;
  else if (heightMode == YGMeasureModeAtMost) finalHeight = MIN(height, fitted.height);

  return CGSizeMake(finalWidth, finalHeight);
}

#pragma mark - UITextViewDelegate

- (BOOL)textView:(UITextView *)textView shouldChangeTextInRange:(NSRange)range replacementText:(NSString *)text {
  NSLog(@"[ZynthTextInputView] shouldChange range=%@ replacement=%@ current=%@", NSStringFromRange(range), text, textView.text);
  if (!self.isEditableProp) {
    return NO;
  }

  NSString *current = textView.text ?: @"";
  NSString *removed = range.location + range.length <= current.length ? [current substringWithRange:range] : @"";
  NSString *inserted = text ?: @"";

  BOOL isReturn = [inserted isEqualToString:@"\n"];
  if (isReturn) {
    BOOL shouldSubmit = (!self.multiline && ![self.submitBehavior isEqualToString:@"newline"]) ||
                        [self.submitBehavior isEqualToString:@"submit"];
    BOOL allowNewline = self.multiline && [self.submitBehavior isEqualToString:@"newline"];

    if (shouldSubmit && self.hasOnSubmitEditing) {
      NSDictionary *payload = @{@"text": current ?: @""};
      [self.manager zynth_dispatchEvent:@"onSubmitEditing" payload:payload toNode:self.node];
      if (self.manager.jsInvoker) {
        [self.manager.jsInvoker invokeHandlerForNode:self.node.nid name:@"onSubmitEditing"];
      }
    }
    if (shouldSubmit && self.blurOnSubmit) {
      dispatch_async(dispatch_get_main_queue(), ^{
        [self resignFirstResponder];
      });
    }
    if (shouldSubmit && !allowNewline) {
      return NO;
    }
  }

  if (self.maxLength >= 0) {
    NSString *proposed = [current stringByReplacingCharactersInRange:range withString:inserted];
    NSLog(@"[ZynthTextInputView] maxLength check proposed=%@ length=%lu limit=%ld", proposed, (unsigned long)proposed.length, (long)self.maxLength);
    if (proposed.length > (NSUInteger)self.maxLength) {
      return NO;
    }
  }

  self.pendingChange = YES;
  self.pendingRange = range;
  self.pendingInserted = [inserted copy];
  self.pendingRemoved = [removed copy];

  if (inserted.length == 0) {
    [self emitKeyEventForReplacement:@""];
  }

  return YES;
}

- (void)textViewDidChange:(UITextView *)textView {
  NSLog(@"[ZynthTextInputView] textViewDidChange text=%@ suppress=%@ pending=%@", textView.text, self.suppressNativeEvent ? @"YES" : @"NO", self.pendingChange ? @"YES" : @"NO");
  if (self.suppressNativeEvent) {
    [self updatePlaceholderVisibility];
    self.pendingChange = NO;
    if (self.node && self.node.yoga && YGNodeGetOwner(self.node.yoga)) {
      YGNodeMarkDirty(self.node.yoga);
    }
    [self.manager zynth_markNeedsFlush];
    return;
  }
  [self updatePlaceholderVisibility];
  if (!self.pendingChange) {
    self.pendingRange = NSMakeRange(0, 0);
    self.pendingInserted = @"";
    self.pendingRemoved = @"";
  }
  if ([self shouldThrottleEvent]) {
    self.pendingChange = NO;
    return;
  }
  [self emitChangeWithRange:self.pendingRange inserted:self.pendingInserted removed:self.pendingRemoved];
  [self recordEventDispatch];
  self.pendingChange = NO;

  if (self.node && self.node.yoga && YGNodeGetOwner(self.node.yoga)) {
    YGNodeMarkDirty(self.node.yoga);
  }
  [self.manager zynth_markNeedsFlush];
  NSLog(@"[ZynthTextInputView] textViewDidChange finished text=%@", textView.text);

  BOOL nowComposing = self.markedTextRange != nil;
  if (nowComposing != self.isComposing) {
    self.composing = nowComposing;
    [self emitCompositionEventStarting:nowComposing];
  } else if (!nowComposing && self.didEmitCompositionStart) {
    [self emitCompositionEventStarting:NO];
  }
}

- (void)textViewDidBeginEditing:(UITextView *)textView {
  NSLog(@"[ZynthTextInputView] textViewDidBeginEditing");
  self.composing = NO;
  self.didEmitCompositionStart = NO;
  [self emitFocusIfNeeded];
}

- (void)textViewDidEndEditing:(UITextView *)textView {
  NSLog(@"[ZynthTextInputView] textViewDidEndEditing");
  self.composing = NO;
  if (self.didEmitCompositionStart) {
    [self emitCompositionEventStarting:NO];
  }
  [self emitBlurIfNeeded];
}

- (void)textViewDidChangeSelection:(UITextView *)textView {
  NSLog(@"[ZynthTextInputView] textViewDidChangeSelection=%@", NSStringFromRange([textView selectedRange]));
  [self emitSelectionChanged];
}

#pragma mark - Composition

- (void)emitCompositionEventStarting:(BOOL)starting {
  if (!self.manager || !self.node) return;
  if (starting) {
    if (!self.hasOnCompositionStart || self.didEmitCompositionStart) return;
    self.didEmitCompositionStart = YES;
    [self.manager zynth_dispatchEvent:@"onCompositionStart" payload:@{} toNode:self.node];
    if (self.manager.jsInvoker) {
      [self.manager.jsInvoker invokeHandlerForNode:self.node.nid name:@"onCompositionStart"];
    }
  } else {
    if (!self.hasOnCompositionEnd || !self.didEmitCompositionStart) return;
    self.didEmitCompositionStart = NO;
    [self.manager zynth_dispatchEvent:@"onCompositionEnd" payload:@{} toNode:self.node];
    if (self.manager.jsInvoker) {
      [self.manager.jsInvoker invokeHandlerForNode:self.node.nid name:@"onCompositionEnd"];
    }
  }
}

- (void)textView:(UITextView *)textView shouldInteractWithTextAttachment:(NSTextAttachment *)textAttachment inRange:(NSRange)characterRange interaction:(UITextItemInteraction)interaction {
  // no-op placeholder to keep warnings at bay
}

- (void)textView:(UITextView *)textView willChangeSelectionFromCharacterRange:(NSRange)oldRange toCharacterRange:(NSRange)newRange {
  (void)oldRange;
  (void)newRange;
}

- (void)textDidBeginEditing:(NSNotification *)notification {
  if (notification.object == self) {
    [self emitFocusIfNeeded];
  }
}

- (void)textDidEndEditing:(NSNotification *)notification {
  if (notification.object == self) {
    [self emitBlurIfNeeded];
  }
}

- (void)textDidChange:(NSNotification *)notification {
  if (notification.object == self) {
    [self textViewDidChange:self];
  }
}

#pragma mark - UIResponder Overrides

- (void)insertText:(NSString *)text {
  [super insertText:text];
  [self emitKeyEventForReplacement:text];
}

- (BOOL)becomeFirstResponder {
  BOOL result = [super becomeFirstResponder];
  if (result) {
    [self emitFocusIfNeeded];
  }
  return result;
}

- (BOOL)resignFirstResponder {
  BOOL result = [super resignFirstResponder];
  if (result) {
    [self emitBlurIfNeeded];
  }
  return result;
}

@end
