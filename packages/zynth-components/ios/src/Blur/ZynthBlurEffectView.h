#import <Foundation/Foundation.h>
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#else
@class UIVisualEffectView;
#endif

#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthViewHost.h"
#endif

NS_ASSUME_NONNULL_BEGIN

@interface ZynthBlurEffectView : UIVisualEffectView

@property (nonatomic, assign) ZynthPointerEventsMode pointerMode;

- (void)zynth_setBlurIntensity:(NSNumber *_Nullable)intensity;
- (void)zynth_setBlurTint:(NSString *_Nullable)tint;
- (void)zynth_setBlurVariant:(NSString *_Nullable)variant;
- (void)zynth_setInteractive:(BOOL)interactive;
- (void)zynth_setTintColor:(UIColor *_Nullable)tintColor;
- (void)zynth_setPointerEvents:(NSString *_Nullable)pointerEvents;
- (void)zynth_setStyleCornerRadius:(NSNumber *_Nullable)radius;

@end

NS_ASSUME_NONNULL_END
