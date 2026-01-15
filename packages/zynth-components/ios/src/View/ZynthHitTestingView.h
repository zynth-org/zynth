#import <Foundation/Foundation.h>
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#else
@class UIView;
#endif

#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthViewHost.h"
#endif

/**
 * Custom UIView subclass that handles pointer events modes.
 * Supports auto, none, box-none, and box-only pointer event modes.
 */
@interface ZynthHitTestingView : UIView

@property (nonatomic, assign) ZynthPointerEventsMode pointerMode;

- (void)zynth_setEnableGlassIOS:(BOOL)enabled;
- (void)zynth_setGlassTintColor:(UIColor *_Nullable)tintColor;
- (void)zynth_setGlassPressed:(BOOL)pressed animated:(BOOL)animated;
- (UIView *_Nullable)zynth_glassEffectView;

@end
