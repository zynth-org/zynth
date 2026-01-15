#import <UIKit/UIKit.h>

#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthViewHost.h"
#endif

NS_ASSUME_NONNULL_BEGIN

@interface ZynthSliderView : UISlider

@property(nonatomic, assign) int nodeId;
@property(nonatomic, assign) ZynthPointerEventsMode pointerMode;

/// Called for continuous value updates while sliding
@property(nonatomic, copy, nullable) void (^onValueChange)(double value);
/// Called when the user releases the slider
@property(nonatomic, copy, nullable) void (^onSlidingComplete)(double value);

- (void)zynth_setValue:(double)value;
- (void)zynth_setMinimumValue:(double)minValue;
- (void)zynth_setMaximumValue:(double)maxValue;
- (void)zynth_setStep:(double)stepValue;
- (void)zynth_setDisabled:(BOOL)disabled;
- (void)zynth_setMinimumTrackColor:(UIColor *_Nullable)color;
- (void)zynth_setMaximumTrackColor:(UIColor *_Nullable)color;
- (void)zynth_setThumbTintColor:(UIColor *_Nullable)color;

/// Returns a clamped/snapped value respecting min/max/step.
- (double)snapValue:(double)value;

@end

NS_ASSUME_NONNULL_END
