#import "RuneSecureTextInputView.h"
#if __has_include(<RuneKit/SNHexColor.h>)
#import <RuneKit/SNHexColor.h>
#else
#import "SNHexColor.h"
#endif
#if __has_include(<RuneKit/SNUIManager+Internal.h>)
#import <RuneKit/SNUIManager+Internal.h>
#else
#import "SNUIManager+Internal.h"
#endif

static UIColor *RuneColorFromHexOrNil(NSString *hex) {
  if (![hex isKindOfClass:[NSString class]] || hex.length == 0) {
    return nil;
  }
  return SNColorFromHex(hex);
}

@interface RuneSecureTextInputView () <UITextFieldDelegate>

@property(nonatomic, strong) NSDate *lastChangeDispatch;
@property(nonatomic, assign) BOOL didEmitFocus;

@end

@implementation RuneSecureTextInputView

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
  self.textColor = [UIColor whiteColor];
  self.font = [UIFont systemFontOfSize:16 weight:UIFontWeightRegular];
  self.lastChangeDispatch = [NSDate dateWithTimeIntervalSince1970:0];
  self.submitBehavior = @"submit";
  self.blurOnSubmit = NO;
  self.secureTextEntry = YES; // Default to secure
  self.padding = UIEdgeInsetsZero;

  [self addTarget:self action:@selector(textFieldDidChange:) forControlEvents:UIControlEventEditingChanged];
}

- (void)setPlaceholder:(NSString *)placeholder {
    [super setPlaceholder:placeholder];
    [self applyPlaceholderToneFromTextColor];
}

#pragma mark - Prop Applicators

- (void)applyCaretColor:(NSString *)hexString {
  UIColor *color = RuneColorFromHexOrNil(hexString);
  if (color) {
    self.tintColor = color;
  }
}

- (void)applySelectionColor:(NSString *)hexString {
    // UITextField doesn't have a separate selection color like UITextView.
    // The tintColor affects both the caret and the selection highlight.
}

- (void)applyPlaceholderTextColor:(NSString *)hexString {
  self.placeholderTextColor = RuneColorFromHexOrNil(hexString);
  [self applyPlaceholderToneFromTextColor];
}

- (void)applyPlaceholderToneFromTextColor {
    if (self.placeholder.length == 0) return;
    UIColor *placeholderColor = self.placeholderTextColor;
    if (!placeholderColor) {
        UIColor *base = self.textColor ?: [UIColor lightGrayColor];
        placeholderColor = [base colorWithAlphaComponent:0.45];
    }
    self.attributedPlaceholder = [[NSAttributedString alloc] initWithString:self.placeholder attributes:@{NSForegroundColorAttributeName: placeholderColor}];
}

- (void)setTextColor:(UIColor *)textColor {
    [super setTextColor:textColor];
    [self applyPlaceholderToneFromTextColor];
}

#pragma mark - Layout

- (CGRect)textRectForBounds:(CGRect)bounds {
    return UIEdgeInsetsInsetRect(bounds, self.padding);
}

- (CGRect)editingRectForBounds:(CGRect)bounds {
    return UIEdgeInsetsInsetRect(bounds, self.padding);
}

- (CGSize)measureForWidth:(CGFloat)width height:(CGFloat)height widthMode:(YGMeasureMode)widthMode heightMode:(YGMeasureMode)heightMode {
  CGSize constraint = CGSizeMake(CGFLOAT_MAX, CGFLOAT_MAX);
  if (widthMode == YGMeasureModeExactly || widthMode == YGMeasureModeAtMost) {
    constraint.width = width;
  }

  CGSize fitted = [self sizeThatFits:constraint];

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
  [self.manager sn_dispatchEvent:@"onFocus" payload:@{} toNode:self.node];
}

- (void)emitBlurIfNeeded {
  if (!self.hasOnBlur || !self.didEmitFocus) return;
  self.didEmitFocus = NO;
  if (!self.manager || !self.node) return;
  [self.manager sn_dispatchEvent:@"onBlur" payload:@{} toNode:self.node];
}

- (void)emitChange {
    if ([self shouldThrottleEvent]) return;

    if (self.hasOnChangeText) {
        NSDictionary *textPayload = @{@"text": self.text ?: @""};
        [self.manager sn_dispatchEvent:@"onChangeText" payload:textPayload toNode:self.node];
    }
    [self recordEventDispatch];
}


#pragma mark - UITextFieldDelegate

- (void)textFieldDidBeginEditing:(UITextField *)textField {
    [self emitFocusIfNeeded];
}

- (void)textFieldDidEndEditing:(UITextField *)textField {
    [self emitBlurIfNeeded];
}

- (BOOL)textFieldShouldReturn:(UITextField *)textField {
    if (self.hasOnSubmitEditing) {
        NSDictionary *payload = @{@"text": self.text ?: @""};
        [self.manager sn_dispatchEvent:@"onSubmitEditing" payload:payload toNode:self.node];
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

@end
