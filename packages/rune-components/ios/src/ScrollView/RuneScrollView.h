#import <UIKit/UIKit.h>

#import "RuneUIManager+View.h"
#import "RuneHitTestingView.h"

NS_ASSUME_NONNULL_BEGIN

@class SNUIManager;
@class SNNode;

typedef NS_ENUM(NSInteger, RuneScrollAxis) {
  RuneScrollAxisVertical,
  RuneScrollAxisHorizontal,
};

@interface RuneScrollView : RuneHitTestingView <UIScrollViewDelegate>

- (void)attachToManager:(nullable SNUIManager *)manager node:(nullable SNNode *)node;
- (void)insertContentSubview:(UIView *)view atIndex:(NSInteger)index;
- (void)removeContentSubview:(UIView *)view;

- (void)rune_setAxis:(RuneScrollAxis)axis;
- (void)rune_setScrollEnabled:(BOOL)enabled;
- (void)rune_setDirectionalLockEnabled:(BOOL)enabled;
- (void)rune_setShowsVerticalScrollIndicator:(BOOL)show;
- (void)rune_setShowsHorizontalScrollIndicator:(BOOL)show;
- (void)rune_setIndicatorStyle:(NSString *_Nullable)style;
- (void)rune_setOverScrollBehavior:(NSString *_Nullable)behavior;
- (void)rune_setBounces:(BOOL)enabled;
- (void)rune_setDecelerationRate:(NSNumber *_Nullable)value;
- (void)rune_setEventThrottleMs:(NSNumber *_Nullable)ms;
- (void)rune_setEventMinDisplacement:(NSNumber *_Nullable)value;
- (void)rune_setBridgeCoalescing:(BOOL)enabled;
- (void)rune_setContentInset:(NSDictionary *_Nullable)inset;
- (void)rune_setScrollSnapType:(id _Nullable)value;
- (void)rune_setScrollSnapAlign:(id _Nullable)value;
- (void)rune_setScrollSnapStop:(id _Nullable)value;
- (void)rune_setScrollPadding:(id _Nullable)value;
- (void)rune_applyCommand:(NSDictionary *_Nullable)command;

- (void)rune_lockAxis:(NSString *_Nullable)axisName;

@end

NS_ASSUME_NONNULL_END
