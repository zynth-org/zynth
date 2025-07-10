#import <UIKit/UIKit.h>

#if __has_include(<RuneKit/RuneKit.h>)
#import <RuneKit/RuneKit.h>
#else
#import "RuneViewHost.h"
#endif

NS_ASSUME_NONNULL_BEGIN

@interface RuneSwitchView : UISwitch

@property(nonatomic, assign) int nodeId;
@property(nonatomic, assign) RunePointerEventsMode pointerMode;

/// Called when the switch value changes from user interaction
@property(nonatomic, copy, nullable) void (^onValueChange)(BOOL value);

- (void)rune_setValue:(BOOL)value;
- (void)rune_setDisabled:(BOOL)disabled;
- (void)rune_setTrackColor:(UIColor *_Nullable)color;
- (void)rune_setThumbColor:(UIColor *_Nullable)color;

@end

NS_ASSUME_NONNULL_END
