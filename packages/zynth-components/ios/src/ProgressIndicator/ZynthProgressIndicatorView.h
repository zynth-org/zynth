#import <UIKit/UIKit.h>

#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthViewHost.h"
#endif

NS_ASSUME_NONNULL_BEGIN

@interface ZynthProgressIndicatorView : UIActivityIndicatorView

@property(nonatomic, assign) int nodeId;
@property(nonatomic, assign) ZynthPointerEventsMode pointerMode;

- (void)zynth_setColor:(UIColor *_Nullable)color;
- (void)zynth_setSize:(NSString *_Nullable)size;
- (void)zynth_setAnimating:(BOOL)animating;

/// Returns the current indicator size in points based on the size mode
- (CGFloat)zynth_indicatorSize;

@end

NS_ASSUME_NONNULL_END
