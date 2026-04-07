#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@class ZynthRuntime;

@interface ZynthNativePerformanceOverlayManager : NSObject

+ (instancetype)shared;
- (void)attachRuntime:(ZynthRuntime *)runtime;
- (void)detach;
- (void)setPerformanceOverlayEnabled:(BOOL)enabled;
- (NSDictionary<NSString *, NSNumber *> *)performanceOverlaySnapshot;
- (void)recordPerformanceFrameWithFrameMs:(NSTimeInterval)frameMs
                               overBudget:(BOOL)overBudget
                                nodeCount:(NSUInteger)nodeCount;
- (BOOL)requestPerformanceJSPing;
- (void)recordPerformanceJSPing;

@end

NS_ASSUME_NONNULL_END
