#import <UIKit/UIKit.h>

#import "ZynthHitTestingView.h"

NS_ASSUME_NONNULL_BEGIN

@class ZynthUIManager;
@class ZynthNode;

typedef NS_ENUM(NSInteger, ZynthScrollAxis) {
  ZynthScrollAxisVertical,
  ZynthScrollAxisHorizontal,
};

@interface ZynthScrollView : ZynthHitTestingView <UIScrollViewDelegate>

- (void)attachToManager:(nullable ZynthUIManager *)manager node:(nullable ZynthNode *)node;
- (void)insertContentSubview:(UIView *)view atIndex:(NSInteger)index;
- (void)removeContentSubview:(UIView *)view;

- (void)zynth_setAxis:(ZynthScrollAxis)axis;
- (void)zynth_setScrollEnabled:(BOOL)enabled;
- (void)zynth_setDirectionalLockEnabled:(BOOL)enabled;
- (void)zynth_setShowsVerticalScrollIndicator:(BOOL)show;
- (void)zynth_setShowsHorizontalScrollIndicator:(BOOL)show;
- (void)zynth_setIndicatorStyle:(NSString *_Nullable)style;
- (void)zynth_setOverScrollBehavior:(NSString *_Nullable)behavior;
- (void)zynth_setBounces:(BOOL)enabled;
- (void)zynth_setDecelerationRate:(NSNumber *_Nullable)value;
- (void)zynth_setEventThrottleMs:(NSNumber *_Nullable)ms;
- (void)zynth_setEventMinDisplacement:(NSNumber *_Nullable)value;
- (void)zynth_setBridgeCoalescing:(BOOL)enabled;
- (void)zynth_setContentInset:(NSDictionary *_Nullable)inset;
- (void)zynth_setScrollGuardConfig:(NSDictionary *_Nullable)config;
- (void)zynth_setScrollSnapType:(id _Nullable)value;
- (void)zynth_setScrollSnapAlign:(id _Nullable)value;
- (void)zynth_setScrollSnapStop:(id _Nullable)value;
- (void)zynth_setScrollPadding:(id _Nullable)value;
- (void)zynth_setContentOffsetSharedValue:(NSNumber *_Nullable)value;
- (void)zynth_applyCommand:(NSDictionary *_Nullable)command;

- (void)zynth_setManualContentSize:(NSDictionary *_Nullable)size;

- (void)zynth_lockAxis:(NSString *_Nullable)axisName;

@end

NS_ASSUME_NONNULL_END
