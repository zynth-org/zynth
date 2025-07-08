#import <UIKit/UIKit.h>

#if __has_include(<RuneKit/RuneKit.h>)
#import <RuneKit/RuneKit.h>
#else
#import "RuneViewHost.h"
#endif

NS_ASSUME_NONNULL_BEGIN

@interface RuneProgressIndicatorView : UIActivityIndicatorView

@property(nonatomic, assign) int nodeId;
@property(nonatomic, assign) RunePointerEventsMode pointerMode;

- (void)rune_setColor:(UIColor *_Nullable)color;
- (void)rune_setSize:(NSString *_Nullable)size;
- (void)rune_setAnimating:(BOOL)animating;

/// Returns the current indicator size in points based on the size mode
- (CGFloat)rune_indicatorSize;

@end

NS_ASSUME_NONNULL_END
