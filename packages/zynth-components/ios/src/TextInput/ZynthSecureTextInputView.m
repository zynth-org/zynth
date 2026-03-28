#import "ZynthSecureTextInputView.h"
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
#import <Yoga/Yoga.h>
#import "ZynthNode.h"

static UIColor *ZynthColorFromHexOrNil(NSString *hex) {
  if (![hex isKindOfClass:[NSString class]] || hex.length == 0) {
    return nil;
  }
  return ZynthColorFromHex(hex);
}

@interface ZynthSecureTextInputView () <UITextFieldDelegate>

@property(nonatomic, strong) NSDate *lastChangeDispatch;
@property(nonatomic, assign) BOOL didEmitFocus;

@end

@implementation ZynthSecureTextInputView

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    [self configureDefaults];
  }
  return self;
}

- (void)configureDefaults {
  self.delegate = self;
  self.borderStyle = UITextBorderStyleNone;
  self.backgroundColor = [UIColor clearColor];
  if (@available(iOS 13.0, *)) {
    self.textColor = [UIColor labelColor];
  } else {
    self.textColor = [UIColor blackColor];
  }
  self.font = [UIFont systemFontOfSize:16 weight:UIFontWeightRegular];
  self.lastChangeDispatch = [NSDate dateWithTimeIntervalSince1970:0];
  self.submitBehavior = @"submit";
  self.blurOnSubmit = NO;
  self.secureTextEntry = YES; // Default to secure
  self.padding = UIEdgeInsetsZero;
  self.inputHandlerWorkletId = 0;

  [self addTarget:self action:@selector(textFieldDidChange:) forControlEvents:UIControlEventEditingChanged];
}

- (void)layoutSubviews {
  [super layoutSubviews];
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
  if (!UIEdgeInsetsEqualToEdgeInsets(self.padding, newInsets)) {
    self.padding = newInsets;
    [self setNeedsDisplay]; 
    [self setNeedsLayout];
  }
}

- (void)setPlaceholder:(NSString *)placeholder {
    [super setPlaceholder:placeholder];
    [self applyPlaceholderToneFromTextColor];
}

#pragma mark - Prop Applicators

- (void)applyCaretColor:(NSString *)hexString {
  UIColor *color = ZynthColorFromHexOrNil(hexString);
  if (color) {
    self.tintColor = color;
  }
}

- (void)applySelectionColor:(NSString *)hexString {
    // UITextField doesn't have a separate selection color like UITextView.
    // The tintColor affects both the caret and the selection highlight.
}

- (void)applyPlaceholderTextColor:(NSString *)hexString {
  self.placeholderTextColor = ZynthColorFromHexOrNil(hexString);
  [self applyPlaceholderToneFromTextColor];
}

- (void)applyPlaceholderToneFromTextColor {
    if (self.placeholder.length == 0) return;
    UIColor *placeholderColor = self.placeholderTextColor;
    if (!placeholderColor) {
        UIColor *base = self.textColor ?: [UIColor lightGrayColor];
        placeholderColor = [base colorWithAlphaComponent:0.45];
    }
    NSMutableDictionary<NSAttributedStringKey, id> *attributes = [NSMutableDictionary dictionaryWithObject:placeholderColor forKey:NSForegroundColorAttributeName];
    if (self.font) {
      attributes[NSFontAttributeName] = self.font;
    }
    self.attributedPlaceholder = [[NSAttributedString alloc] initWithString:self.placeholder attributes:attributes];
}

- (void)setTextColor:(UIColor *)textColor {
    [super setTextColor:textColor];
    [self applyPlaceholderToneFromTextColor];
}

- (void)setFont:(UIFont *)font {
  [super setFont:font];
  [self applyPlaceholderToneFromTextColor];
}

#pragma mark - Layout

- (CGRect)textRectForBounds:(CGRect)bounds {
    return UIEdgeInsetsInsetRect(bounds, self.padding);
}

- (CGRect)editingRectForBounds:(CGRect)bounds {
    return UIEdgeInsetsInsetRect(bounds, self.padding);
}

- (CGRect)placeholderRectForBounds:(CGRect)bounds {
    return UIEdgeInsetsInsetRect(bounds, self.padding);
}

- (CGSize)measureForWidth:(CGFloat)width height:(CGFloat)height widthMode:(YGMeasureMode)widthMode heightMode:(YGMeasureMode)heightMode {
  CGSize constraint = CGSizeMake(CGFLOAT_MAX, CGFLOAT_MAX);
  if (widthMode == YGMeasureModeExactly || widthMode == YGMeasureModeAtMost) {
    constraint.width = width;
  }

  // Yoga expects the measure function to return the *content* size.
  // Yoga itself adds the padding to the result to determine the node size.
  // However, UITextField's sizeThatFits (via our textRectForBounds overrides) 
  // includes our custom padding in its result.
  // To avoid double-counting padding (once by UITextField, once by Yoga),
  // we temporarily zero out the padding during measurement.
  UIEdgeInsets originalPadding = self.padding;
  self.padding = UIEdgeInsetsZero;

  CGSize fitted = [self sizeThatFits:constraint];

  self.padding = originalPadding;

  CGFloat finalWidth = fitted.width;
  if (widthMode == YGMeasureModeExactly) finalWidth = width;
  else if (widthMode == YGMeasureModeAtMost) finalWidth = MIN(width, fitted.width);

  CGFloat finalHeight = fitted.height;
  if (heightMode == YGMeasureModeExactly) finalHeight = height;
  else if (heightMode == YGMeasureModeAtMost) finalHeight = MIN(height, fitted.height);

  return CGSizeMake(ceil(finalWidth), ceil(finalHeight));
}


#pragma mark - Event Emitters

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
}

- (void)emitBlurIfNeeded {
  if (!self.hasOnBlur || !self.didEmitFocus) return;
  self.didEmitFocus = NO;
  if (!self.manager || !self.node) return;
  [self.manager zynth_dispatchEvent:@"onBlur" payload:@{} toNode:self.node];
}

- (void)emitChange {
    if ([self shouldThrottleEvent]) return;

    if (self.hasOnChangeText) {
        NSDictionary *textPayload = @{@"text": self.text ?: @""};
        [self.manager zynth_dispatchEvent:@"onChangeText" payload:textPayload toNode:self.node];
    }
    [self recordEventDispatch];
}


#pragma mark - UITextFieldDelegate

- (void)textFieldDidBeginEditing:(UITextField *)textField {
    [self emitFocusIfNeeded];
    if (self.selectTextOnFocus) {
        dispatch_async(dispatch_get_main_queue(), ^{
            [textField selectAll:nil];
        });
    }
}

- (void)textFieldDidEndEditing:(UITextField *)textField {
    [self emitBlurIfNeeded];
}

- (BOOL)textFieldShouldReturn:(UITextField *)textField {
    if (self.hasOnSubmitEditing) {
        NSDictionary *payload = @{@"text": self.text ?: @""};
        [self.manager zynth_dispatchEvent:@"onSubmitEditing" payload:payload toNode:self.node];
    }

    if (self.blurOnSubmit) {
        dispatch_async(dispatch_get_main_queue(), ^{ 
            [self resignFirstResponder];
        });
    }

    // Do not insert newline for single-line input
    return NO;
}

- (void)textFieldDidChange:(UITextField *)textField {
    [self emitChange];
}

- (BOOL)textField:(UITextField *)textField
shouldChangeCharactersInRange:(NSRange)range
replacementString:(NSString *)string {
    NSString *current = textField.text ?: @"";
    NSString *incoming = string ?: @"";

    if (self.inputHandlerWorkletId > 0 && self.manager) {
        NSString *transformed = [self.manager runInputHandlerWorklet:(int)self.inputHandlerWorkletId
                                                         currentText:current
                                                            newInput:incoming];
        NSString *proposed = [current stringByReplacingCharactersInRange:range withString:incoming];
        if ([transformed isKindOfClass:[NSString class]] && ![transformed isEqualToString:proposed]) {
            textField.text = transformed ?: current;
            NSInteger cursor = textField.text.length;
            UITextPosition *position = [textField positionFromPosition:textField.beginningOfDocument
                                                                offset:cursor];
            if (position) {
                UITextRange *cursorRange = [textField textRangeFromPosition:position toPosition:position];
                if (cursorRange) {
                    textField.selectedTextRange = cursorRange;
                }
            }
            return NO;
        }
    }

    return YES;
}

@end
