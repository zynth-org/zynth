#import <Foundation/Foundation.h>
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#else
@class UIView;
#endif

#if __has_include(<RuneKit/RuneKit.h>)
#import <RuneKit/RuneKit.h>
#else
#import "RuneViewHost.h"
#endif

/**
 * Custom UIView subclass that handles pointer events modes.
 * Supports auto, none, box-none, and box-only pointer event modes.
 */
@interface RuneHitTestingView : UIView

@property (nonatomic, assign) RunePointerEventsMode pointerMode;

@end
