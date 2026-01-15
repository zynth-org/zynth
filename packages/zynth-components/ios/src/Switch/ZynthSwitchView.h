#import <UIKit/UIKit.h>

#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthViewHost.h"
#endif

NS_ASSUME_NONNULL_BEGIN

@interface ZynthSwitchView : UISwitch

@property(nonatomic, assign) int nodeId;
@property(nonatomic, assign) ZynthPointerEventsMode pointerMode;

/// Called when the switch value changes from user interaction
@property(nonatomic, copy, nullable) void (^onValueChange)(BOOL value);

- (void)zynth_setValue:(BOOL)value;
- (void)zynth_setDisabled:(BOOL)disabled;
- (void)zynth_setTrackColor:(UIColor *_Nullable)color;
- (void)zynth_setThumbColor:(UIColor *_Nullable)color;

@end

NS_ASSUME_NONNULL_END
