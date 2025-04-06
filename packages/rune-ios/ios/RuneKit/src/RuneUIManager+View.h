#import <Foundation/Foundation.h>
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#else
@class UIView;
@class UIGestureRecognizer;
#endif

#import "SNUIManager+Internal.h"
#import "RuneViewHost.h"

@interface SNUIManager (RuneView)

- (void)rune_initializePointerDefaultsForNode:(SNNode *)node;
- (void)rune_updateInteractionStateForNode:(SNNode *)node;
- (void)rune_attachTapRecognizerForNode:(SNNode *)node;
- (void)rune_handleTap:(UIGestureRecognizer *)gr;

@end
