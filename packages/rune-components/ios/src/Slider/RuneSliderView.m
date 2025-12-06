#import "RuneSliderView.h"

@interface RuneSliderView ()
@property(nonatomic, assign) BOOL isUpdatingFromJS;
@property(nonatomic, assign) double stepValue;
@end

@implementation RuneSliderView

- (instancetype)init {
  return [self initWithFrame:CGRectZero];
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _pointerMode = RunePointerEventsAuto;
    _isUpdatingFromJS = NO;
    _stepValue = 0.0;

    [self addTarget:self action:@selector(sliderValueChanged:) forControlEvents:UIControlEventValueChanged];
    UIControlEvents endEvents = UIControlEventTouchUpInside | UIControlEventTouchUpOutside | UIControlEventTouchCancel;
    [self addTarget:self action:@selector(sliderTouchEnded:) forControlEvents:endEvents];
  }
  return self;
}

#pragma mark - Event handlers

- (void)sliderValueChanged:(UISlider *)sender {
  if (self.isUpdatingFromJS) return;

  double snapped = [self snapValue:sender.value];
  if (snapped != sender.value) {
    self.isUpdatingFromJS = YES;
    sender.value = snapped;
    self.isUpdatingFromJS = NO;
  }

  if (self.onValueChange) {
    self.onValueChange(snapped);
  }
}

- (void)sliderTouchEnded:(UISlider *)sender {
  if (self.isUpdatingFromJS) return;

  double snapped = [self snapValue:sender.value];
  if (snapped != sender.value) {
    self.isUpdatingFromJS = YES;
    sender.value = snapped;
    self.isUpdatingFromJS = NO;
  }

  if (self.onValueChange) {
    self.onValueChange(snapped);
  }
  if (self.onSlidingComplete) {
    self.onSlidingComplete(snapped);
  }
}

#pragma mark - Property setters

- (void)rune_setValue:(double)value {
  double snapped = [self snapValue:value];
  if (self.value == snapped) return;

  self.isUpdatingFromJS = YES;
  [self setValue:snapped animated:YES];
  self.isUpdatingFromJS = NO;
}

- (void)rune_setMinimumValue:(double)minValue {
  self.minimumValue = (float)minValue;
  if (self.maximumValue < self.minimumValue) {
    self.maximumValue = self.minimumValue;
  }
  [self rune_setValue:self.value];
}

- (void)rune_setMaximumValue:(double)maxValue {
  self.maximumValue = (float)maxValue;
  if (self.minimumValue > self.maximumValue) {
    self.minimumValue = self.maximumValue;
  }
  [self rune_setValue:self.value];
}

- (void)rune_setStep:(double)stepValue {
  self.stepValue = stepValue > 0 ? stepValue : 0.0;
  [self rune_setValue:self.value];
}

- (void)rune_setDisabled:(BOOL)disabled {
  self.enabled = !disabled;
  self.alpha = disabled ? 0.5 : 1.0;
}

- (void)rune_setMinimumTrackColor:(UIColor *)color {
  self.minimumTrackTintColor = color;
}

- (void)rune_setMaximumTrackColor:(UIColor *)color {
  self.maximumTrackTintColor = color;
}

- (void)rune_setThumbTintColor:(UIColor *)color {
  self.thumbTintColor = color;
}

#pragma mark - Helpers

- (double)snapValue:(double)value {
  double minValue = (double)self.minimumValue;
  double maxValue = (double)self.maximumValue;

  if (isnan(minValue) || isnan(maxValue)) {
    return 0.0;
  }

  if (isnan(value) || isinf(value)) {
    return minValue;
  }

  double clamped = MIN(MAX(value, minValue), maxValue);

  if (self.stepValue <= 0.0) {
    return clamped;
  }

  double steps = round((clamped - minValue) / self.stepValue);
  double snapped = minValue + (steps * self.stepValue);
  double bounded = MIN(MAX(snapped, minValue), maxValue);

  if (isnan(bounded) || isinf(bounded)) {
    return minValue;
  }

  return bounded;
}

- (CGSize)intrinsicContentSize {
  return [super intrinsicContentSize];
}

@end
