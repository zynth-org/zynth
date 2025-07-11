#import "RuneTextFieldView.h"

@interface RuneTextFieldView ()
@property(nonatomic, strong, readwrite) UITextField *textField;
@property(nonatomic, assign) BOOL isUpdatingFromJS;
@property(nonatomic, assign) NSInteger maxLength;
@property(nonatomic, copy) NSString *currentVariant;
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
    _currentVariant = @"filled"; // Default variant
    
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

#pragma mark - Styling

- (void)rune_setVariant:(NSString *)variant {
  self.currentVariant = variant;
  
  // Always switch to UITextBorderStyleNone for full control
  self.textField.borderStyle = UITextBorderStyleNone;
  self.textField.layer.masksToBounds = YES;
  
  // Add padding since UITextBorderStyleNone removes it
  if (!self.textField.leftView) {
    self.textField.leftView = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 10, 0)];
    self.textField.leftViewMode = UITextFieldViewModeAlways;
    self.textField.rightView = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 10, 0)];
    self.textField.rightViewMode = UITextFieldViewModeAlways;
  }
  
  if ([variant isEqualToString:@"outlined"]) {
    // Outlined: transparent background, visible border
    self.textField.backgroundColor = [UIColor clearColor];
    self.textField.layer.cornerRadius = 5.0;
    self.textField.layer.borderWidth = 1.0;
    self.textField.layer.borderColor = [[UIColor systemGrayColor] colorWithAlphaComponent:0.5].CGColor;
  } else if ([variant isEqualToString:@"none"]) {
    // None: no background, no border - fully custom
    self.textField.backgroundColor = [UIColor clearColor];
    self.textField.layer.cornerRadius = 0;
    self.textField.layer.borderWidth = 0;
    self.textField.layer.borderColor = nil;
  } else {
    // Filled (default): gray background, no border
    self.textField.backgroundColor = [[UIColor systemGrayColor] colorWithAlphaComponent:0.12];
    self.textField.layer.cornerRadius = 5.0;
    self.textField.layer.borderWidth = 0;
    self.textField.layer.borderColor = nil;
  }
}

- (void)applyCustomStylingIfNeeded {
  // Switch from UITextBorderStyleRoundedRect to UITextBorderStyleNone
  // so we have full control over background, border, and corner radius
  if (self.textField.borderStyle == UITextBorderStyleRoundedRect) {
    self.textField.borderStyle = UITextBorderStyleNone;
    // Apply corner radius matching UITextBorderStyleRoundedRect (approximately 5pt)
    self.textField.layer.cornerRadius = 5.0;
    self.textField.layer.masksToBounds = YES;
    // Add padding since UITextBorderStyleNone removes it
    if (!self.textField.leftView) {
      self.textField.leftView = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 10, 0)];
      self.textField.leftViewMode = UITextFieldViewModeAlways;
      self.textField.rightView = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 10, 0)];
      self.textField.rightViewMode = UITextFieldViewModeAlways;
    }
    
    // Apply default filled style if no variant was explicitly set
    if (!self.currentVariant || [self.currentVariant isEqualToString:@"filled"]) {
      self.textField.backgroundColor = [[UIColor systemGrayColor] colorWithAlphaComponent:0.12];
    }
  }
}

- (void)rune_setBackgroundColor:(UIColor *)color {
  [self applyCustomStylingIfNeeded];
  
  if (color) {
    self.textField.backgroundColor = color;
  } else if ([self.currentVariant isEqualToString:@"outlined"] || 
             [self.currentVariant isEqualToString:@"none"]) {
    // For outlined/none variants, default to transparent
    self.textField.backgroundColor = [UIColor clearColor];
  } else {
    // For filled variant, use a light gray background
    self.textField.backgroundColor = [[UIColor systemGrayColor] colorWithAlphaComponent:0.12];
  }
  
  // Also clip the container view to prevent any background bleeding
  self.clipsToBounds = YES;
  self.layer.cornerRadius = self.textField.layer.cornerRadius;
}

- (void)rune_setBorderRadius:(CGFloat)radius {
  [self applyCustomStylingIfNeeded];
  
  self.textField.layer.cornerRadius = radius;
  // Also apply to container to ensure clipping
  self.layer.cornerRadius = radius;
  self.clipsToBounds = YES;
}

- (void)rune_setBorderWidth:(CGFloat)width {
  [self applyCustomStylingIfNeeded];
  self.textField.layer.borderWidth = width;
}

- (void)rune_setBorderColor:(UIColor *)color {
  [self applyCustomStylingIfNeeded];
  if (color) {
    self.textField.layer.borderColor = color.CGColor;
  } else {
    self.textField.layer.borderColor = nil;
  }
}

- (void)rune_setTextColor:(UIColor *)color {
  if (color) {
    self.textField.textColor = color;
  } else {
    self.textField.textColor = [UIColor labelColor];
  }
}

- (void)rune_setPlaceholderColor:(UIColor *)color {
  if (color && self.textField.placeholder) {
    NSDictionary *attributes = @{NSForegroundColorAttributeName: color};
    self.textField.attributedPlaceholder = [[NSAttributedString alloc] initWithString:self.textField.placeholder attributes:attributes];
  }
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
