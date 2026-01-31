#import "ZynthUIManager.h"
#import "ZynthYogaLayout.h"
#import <dispatch/dispatch.h>

NS_ASSUME_NONNULL_BEGIN

@interface ZynthUIManager (Surface)

- (int)rootSurfaceId;
- (NSNumber *)registerSurfaceWithRootView:(UIView *)rootView;
- (void)unregisterSurface:(int)surfaceId;
- (BOOL)isSurfaceRootId:(NSNumber *)nodeId;
- (void)ensureSurface:(int)surfaceId;
- (UIView *)rootViewForSurface:(int)surfaceId;
- (ZynthYogaLayout *)yogaForSurface:(int)surfaceId;
- (ZynthYogaLayout *)yogaForNode:(NSNumber *)nodeId;
- (void)markSurfaceDirty:(int)surfaceId;
- (void)markSurfaceDirtyForNode:(NSNumber *)nodeId;
- (void)syncSurfaceRootSize:(int)surfaceId rootView:(UIView *)rootView;
- (void)addSurfaceFirstFrameListener:(int)surfaceId listener:(dispatch_block_t)listener;
- (void)removeSurfaceFirstFrameListener:(int)surfaceId listener:(dispatch_block_t)listener;
- (void)dispatchSurfaceFirstFrameIfNeeded:(int)surfaceId;

@end

NS_ASSUME_NONNULL_END
