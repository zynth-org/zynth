#import <Foundation/Foundation.h>
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#else
@class UIView;
@class UIGestureRecognizer;
#endif

#import "SNUIManager+Internal.h"

typedef NS_ENUM(NSInteger, RunePointerEventsMode) {
  RunePointerEventsAuto = 0,
  RunePointerEventsNone,
  RunePointerEventsBoxNone,
  RunePointerEventsBoxOnly
};

NS_INLINE RunePointerEventsMode RunePointerEventsFromString(NSString *value) {
  if (![value isKindOfClass:[NSString class]] || value.length == 0) return RunePointerEventsAuto;
  if ([value isEqualToString:@"none"]) return RunePointerEventsNone;
  if ([value isEqualToString:@"box-none"]) return RunePointerEventsBoxNone;
  if ([value isEqualToString:@"box-only"]) return RunePointerEventsBoxOnly;
  return RunePointerEventsAuto;
}

@interface RuneHitTestingView : UIView
@property(nonatomic, assign) RunePointerEventsMode pointerMode;
@end

@interface SNUIManager (RuneView)

- (UIView *)rune_makeContainerView;
- (void)rune_initializePointerDefaultsForNode:(SNNode *)node;
- (void)rune_updateInteractionStateForNode:(SNNode *)node;
- (void)rune_attachTapRecognizerForNode:(SNNode *)node;
- (void)rune_handleTap:(UIGestureRecognizer *)gr;

@end

