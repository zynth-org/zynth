#import <Foundation/Foundation.h>
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#else
@class UIView;
@class UIGestureRecognizer;
#endif

#import "SNUIManager+Internal.h"
#import "ZynthViewHost.h"

@interface SNUIManager (ZynthView)

- (void)zynth_initializePointerDefaultsForNode:(SNNode *)node;
- (void)zynth_updateInteractionStateForNode:(SNNode *)node;
- (void)zynth_attachTapRecognizerForNode:(SNNode *)node;
- (void)zynth_handleTap:(UIGestureRecognizer *)gr;

@end
