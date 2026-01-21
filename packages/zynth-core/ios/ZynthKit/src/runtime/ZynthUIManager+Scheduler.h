#import "ZynthUIManager.h"

NS_ASSUME_NONNULL_BEGIN

@interface ZynthUIManager (Scheduler)

- (void)zynth_setFrameProfilerInternal:(void (^_Nullable)(NSTimeInterval frameMs,
                                                         NSTimeInterval layoutMs,
                                                         BOOL overBudget,
                                                         NSUInteger nodeCount))profiler;
- (void)ensureDisplayLink;
- (void)requestLayout;
- (void)handleDisplayLink:(CADisplayLink *)link;

@end

NS_ASSUME_NONNULL_END
