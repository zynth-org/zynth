#import <Foundation/Foundation.h>
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#else
@class UIVisualEffectView;
#endif

#if __has_include(<RuneKit/RuneKit.h>)
#import <RuneKit/RuneKit.h>
#else
#import "RuneViewHost.h"
#endif

NS_ASSUME_NONNULL_BEGIN

@interface RuneGlassEffectView : UIVisualEffectView

@property (nonatomic, assign) RunePointerEventsMode pointerMode;

- (void)rune_setGlassEffect:(NSString *_Nullable)effect;
- (void)rune_setInteractive:(BOOL)interactive;
- (void)rune_setTintColor:(UIColor *_Nullable)tintColor;
- (void)rune_setPointerEvents:(NSString *_Nullable)pointerEvents;

@end

NS_ASSUME_NONNULL_END
