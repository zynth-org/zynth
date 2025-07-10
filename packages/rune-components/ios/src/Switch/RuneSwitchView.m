#import "RuneSwitchView.h"

@interface RuneSwitchView ()
@property(nonatomic, strong, nullable) UIColor *customTrackColor;
@property(nonatomic, strong, nullable) UIColor *customThumbColor;
@property(nonatomic, assign) BOOL isUpdatingFromJS;
@end

@implementation RuneSwitchView

- (instancetype)init {
  return [self initWithFrame:CGRectZero];
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _pointerMode = RunePointerEventsAuto;
    _isUpdatingFromJS = NO;
    [self addTarget:self action:@selector(switchValueChanged:) forControlEvents:UIControlEventValueChanged];
  }
  return self;
}

#pragma mark - Value Change Handler

- (void)switchValueChanged:(UISwitch *)sender {
  // Only dispatch event if this is a user-initiated change, not a JS update
  if (!self.isUpdatingFromJS && self.onValueChange) {
    self.onValueChange(sender.isOn);
  }
}

#pragma mark - Property Setters

- (void)rune_setValue:(BOOL)value {
  // Avoid redundant updates and feedback loops
  if (self.isOn == value) {
    return;
  }
  
  self.isUpdatingFromJS = YES;
  [self setOn:value animated:YES];
  self.isUpdatingFromJS = NO;
}

- (void)rune_setDisabled:(BOOL)disabled {
  self.enabled = !disabled;
  self.alpha = disabled ? 0.5 : 1.0;
}

- (void)rune_setTrackColor:(UIColor *)color {
  if (self.customTrackColor == color || [self.customTrackColor isEqual:color]) {
    return;
  }
  self.customTrackColor = color;
  
  // Use performWithoutAnimation to prevent visual glitches when setting onTintColor
  // iOS can have animation artifacts when changing tint colors
  [UIView performWithoutAnimation:^{
    self.onTintColor = color;
    [self layoutIfNeeded];
  }];
}

- (void)rune_setThumbColor:(UIColor *)color {
  // thumbTintColor is intentionally not supported as it causes visual glitches
  // during animations on iOS. The thumb loses its shadow/depth effects.
  // This method is kept for potential future use but does nothing.
}

#pragma mark - Intrinsic Size

- (CGSize)intrinsicContentSize {
  // UISwitch has a fixed intrinsic size, let the system handle it
  return [super intrinsicContentSize];
}

@end
