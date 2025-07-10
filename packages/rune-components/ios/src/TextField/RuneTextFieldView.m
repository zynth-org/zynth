#import "RuneTextFieldView.h"

@interface RuneTextFieldView ()
@property(nonatomic, strong, readwrite) UITextField *textField;
@property(nonatomic, assign) BOOL isUpdatingFromJS;
@property(nonatomic, assign) NSInteger maxLength;
@end

@implementation RuneTextFieldView

- (instancetype)init {
  return [self initWithFrame:CGRectZero];
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _pointerMode = RunePointerEventsAuto;
    _isUpdatingFromJS = NO;
    _maxLength = NSIntegerMax;
    
    _textField = [[UITextField alloc] initWithFrame:CGRectZero];
    _textField.delegate = self;
    _textField.borderStyle = UITextBorderStyleRoundedRect;
    _textField.translatesAutoresizingMaskIntoConstraints = NO;
    
    [self addSubview:_textField];
    
    // Constrain text field to fill the container
    [NSLayoutConstraint activateConstraints:@[
      [_textField.topAnchor constraintEqualToAnchor:self.topAnchor],
      [_textField.leadingAnchor constraintEqualToAnchor:self.leadingAnchor],
      [_textField.trailingAnchor constraintEqualToAnchor:self.trailingAnchor],
      [_textField.bottomAnchor constraintEqualToAnchor:self.bottomAnchor],
    ]];
    
    // Listen for text changes
    [_textField addTarget:self
                   action:@selector(textFieldDidChange:)
         forControlEvents:UIControlEventEditingChanged];
  }
  return self;
}

#pragma mark - Text Change Handler

- (void)textFieldDidChange:(UITextField *)textField {
  if (!self.isUpdatingFromJS && self.onChange) {
    self.onChange(textField.text ?: @"");
  }
}

#pragma mark - UITextFieldDelegate

- (void)textFieldDidBeginEditing:(UITextField *)textField {
  if (self.onFocus) {
    self.onFocus();
  }
}

- (void)textFieldDidEndEditing:(UITextField *)textField {
  if (self.onBlur) {
    self.onBlur();
  }
}

- (BOOL)textFieldShouldReturn:(UITextField *)textField {
  if (self.onSubmit) {
    self.onSubmit(textField.text ?: @"");
  }
  return YES;
}

- (BOOL)textField:(UITextField *)textField
    shouldChangeCharactersInRange:(NSRange)range
                replacementString:(NSString *)string {
  // Enforce maxLength if set
  if (self.maxLength < NSIntegerMax) {
    NSString *currentText = textField.text ?: @"";
    NSString *newText = [currentText stringByReplacingCharactersInRange:range withString:string];
    return newText.length <= (NSUInteger)self.maxLength;
  }
  return YES;
}

#pragma mark - Property Setters

- (void)rune_setValue:(NSString *)value {
  if ([self.textField.text isEqualToString:value]) {
    return;
  }
  
  self.isUpdatingFromJS = YES;
  self.textField.text = value;
  self.isUpdatingFromJS = NO;
}

- (void)rune_setPlaceholder:(NSString *)placeholder {
  self.textField.placeholder = placeholder;
}

- (void)rune_setDisabled:(BOOL)disabled {
  self.textField.enabled = !disabled;
  self.textField.alpha = disabled ? 0.5 : 1.0;
}

- (void)rune_setEditable:(BOOL)editable {
  self.textField.userInteractionEnabled = editable;
}

- (void)rune_setSecureTextEntry:(BOOL)secure {
  self.textField.secureTextEntry = secure;
}

- (void)rune_setKeyboardType:(NSString *)keyboardType {
  if ([keyboardType isEqualToString:@"numeric"]) {
    self.textField.keyboardType = UIKeyboardTypeNumberPad;
  } else if ([keyboardType isEqualToString:@"email"]) {
    self.textField.keyboardType = UIKeyboardTypeEmailAddress;
  } else if ([keyboardType isEqualToString:@"phone"]) {
    self.textField.keyboardType = UIKeyboardTypePhonePad;
  } else if ([keyboardType isEqualToString:@"url"]) {
    self.textField.keyboardType = UIKeyboardTypeURL;
  } else {
    self.textField.keyboardType = UIKeyboardTypeDefault;
  }
}

- (void)rune_setReturnKeyType:(NSString *)returnKeyType {
  if ([returnKeyType isEqualToString:@"go"]) {
    self.textField.returnKeyType = UIReturnKeyGo;
  } else if ([returnKeyType isEqualToString:@"next"]) {
    self.textField.returnKeyType = UIReturnKeyNext;
  } else if ([returnKeyType isEqualToString:@"search"]) {
    self.textField.returnKeyType = UIReturnKeySearch;
  } else if ([returnKeyType isEqualToString:@"send"]) {
    self.textField.returnKeyType = UIReturnKeySend;
  } else {
    self.textField.returnKeyType = UIReturnKeyDone;
  }
}

- (void)rune_setAutoCapitalize:(NSString *)autoCapitalize {
  if ([autoCapitalize isEqualToString:@"none"]) {
    self.textField.autocapitalizationType = UITextAutocapitalizationTypeNone;
  } else if ([autoCapitalize isEqualToString:@"words"]) {
    self.textField.autocapitalizationType = UITextAutocapitalizationTypeWords;
  } else if ([autoCapitalize isEqualToString:@"characters"]) {
    self.textField.autocapitalizationType = UITextAutocapitalizationTypeAllCharacters;
  } else {
    self.textField.autocapitalizationType = UITextAutocapitalizationTypeSentences;
  }
}

- (void)rune_setAutoCorrect:(BOOL)autoCorrect {
  self.textField.autocorrectionType = autoCorrect ? UITextAutocorrectionTypeYes : UITextAutocorrectionTypeNo;
}

- (void)rune_setMaxLength:(NSInteger)maxLength {
  self.maxLength = maxLength > 0 ? maxLength : NSIntegerMax;
}

#pragma mark - Focus Control

- (void)rune_requestFocus {
  [self.textField becomeFirstResponder];
}

- (void)rune_requestBlur {
  [self.textField resignFirstResponder];
}

#pragma mark - Intrinsic Size

- (CGSize)intrinsicContentSize {
  CGSize textFieldSize = [self.textField intrinsicContentSize];
  // Add some padding for a more comfortable touch target
  return CGSizeMake(textFieldSize.width, MAX(textFieldSize.height, 44.0));
}

- (void)layoutSubviews {
  [super layoutSubviews];
  self.textField.frame = self.bounds;
}

@end
