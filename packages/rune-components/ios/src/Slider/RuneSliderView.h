#import <UIKit/UIKit.h>

#if __has_include(<RuneKit/RuneKit.h>)
#import <RuneKit/RuneKit.h>
#else
#import "RuneViewHost.h"
#endif

NS_ASSUME_NONNULL_BEGIN

@interface RuneSliderView : UISlider

@property(nonatomic, assign) int nodeId;
@property(nonatomic, assign) RunePointerEventsMode pointerMode;

/// Called for continuous value updates while sliding
@property(nonatomic, copy, nullable) void (^onValueChange)(double value);
/// Called when the user releases the slider
@property(nonatomic, copy, nullable) void (^onSlidingComplete)(double value);

- (void)rune_setValue:(double)value;
- (void)rune_setMinimumValue:(double)minValue;
- (void)rune_setMaximumValue:(double)maxValue;
- (void)rune_setStep:(double)stepValue;
- (void)rune_setDisabled:(BOOL)disabled;
- (void)rune_setMinimumTrackColor:(UIColor *_Nullable)color;
- (void)rune_setMaximumTrackColor:(UIColor *_Nullable)color;
- (void)rune_setThumbTintColor:(UIColor *_Nullable)color;

/// Returns a clamped/snapped value respecting min/max/step.
- (double)snapValue:(double)value;

@end

NS_ASSUME_NONNULL_END
