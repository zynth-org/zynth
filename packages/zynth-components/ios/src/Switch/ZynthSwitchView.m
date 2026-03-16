#import "ZynthSwitchView.h"

@interface ZynthSwitchView ()
@property(nonatomic, strong, nullable) UIColor *customTrackColor;
@property(nonatomic, strong, nullable) UIColor *customThumbColor;
@property(nonatomic, assign) BOOL isUpdatingFromJS;
@end

@implementation ZynthSwitchView

- (instancetype)init {
  return [self initWithFrame:CGRectZero];
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _pointerMode = ZynthPointerEventsAuto;
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

- (void)zynth_setValue:(BOOL)value {
  // Avoid redundant updates and feedback loops
  if (self.isOn == value) {
    return;
  }
  
  self.isUpdatingFromJS = YES;
  [self setOn:value animated:YES];
  self.isUpdatingFromJS = NO;
}

- (void)zynth_setDisabled:(BOOL)disabled {
  self.enabled = !disabled;
  self.alpha = disabled ? 0.5 : 1.0;
}

- (void)zynth_setTrackColor:(UIColor *)color {
  [self zynth_setOnTrackColor:color offTrackColor:nil];
}

- (void)zynth_setOnTrackColor:(UIColor *)onColor offTrackColor:(UIColor *)offColor {
  // Use performWithoutAnimation to prevent visual glitches when setting tint colors
  [UIView performWithoutAnimation:^{
    if (onColor) {
      self.onTintColor = onColor;
    }
    if (offColor) {
      self.tintColor = offColor;
    }
    [self layoutIfNeeded];
  }];
}

- (void)zynth_setThumbColor:(UIColor *)color {
  self.thumbTintColor = color;
}

- (void)zynth_setOnThumbColor:(UIColor *)onColor offThumbColor:(UIColor *)offColor {
  // iOS UISwitch doesn't support different thumb colors per state natively.
  // We'll use the 'on' color as primary thumb color for now.
  if (onColor) {
    self.thumbTintColor = onColor;
  }
}

#pragma mark - Intrinsic Size

- (CGSize)intrinsicContentSize {
  // UISwitch has a fixed intrinsic size, let the system handle it
  return [super intrinsicContentSize];
}

@end
