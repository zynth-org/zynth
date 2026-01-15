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

@interface ZynthGlassEffectView : UIVisualEffectView

@property (nonatomic, assign) ZynthPointerEventsMode pointerMode;

- (void)zynth_setGlassEffect:(NSString *_Nullable)effect;
- (void)zynth_setInteractive:(BOOL)interactive;
- (void)zynth_setTintColor:(UIColor *_Nullable)tintColor;
- (void)zynth_setPointerEvents:(NSString *_Nullable)pointerEvents;

@end

NS_ASSUME_NONNULL_END
