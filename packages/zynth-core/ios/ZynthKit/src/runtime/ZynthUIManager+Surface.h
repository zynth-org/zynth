#import "ZynthUIManager.h"
#import "ZynthYogaLayout.h"

NS_ASSUME_NONNULL_BEGIN

@interface ZynthUIManager (Surface)

- (void)ensureSurface:(int)surfaceId;
- (UIView *)rootViewForSurface:(int)surfaceId;
- (ZynthYogaLayout *)yogaForSurface:(int)surfaceId;
- (ZynthYogaLayout *)yogaForNode:(NSNumber *)nodeId;
- (void)markSurfaceDirty:(int)surfaceId;
- (void)markSurfaceDirtyForNode:(NSNumber *)nodeId;
- (void)syncSurfaceRootSize:(int)surfaceId rootView:(UIView *)rootView;

@end

NS_ASSUME_NONNULL_END
