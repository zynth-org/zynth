#import "ZynthUIManager+Private.h"
#import "ZynthUIManager+Scheduler.h"
#import "ZynthUIManager+Surface.h"

@implementation ZynthUIManager (Surface)

- (void)ensureSurface:(int)surfaceId {
  NSNumber *key = @(surfaceId);
  if (_surfaceRoots[key] && _surfaceYoga[key]) return;
  UIView *root = nil;
  if (surfaceId == 0) {
    root = _rootView;
  } else {
    root = [[UIView alloc] initWithFrame:_rootView.bounds];
    root.backgroundColor = UIColor.clearColor;
    [_rootView addSubview:root];
  }
  if (!root) return;
  _surfaceRoots[key] = root;
  _surfaceYoga[key] = [[ZynthYogaLayout alloc] initWithRootView:root];
  _surfaceSizes[key] = [NSValue valueWithCGSize:root.bounds.size];
}

- (UIView *)rootViewForSurface:(int)surfaceId {
  NSNumber *key = @(surfaceId);
  UIView *root = _surfaceRoots[key];
  return root ?: _rootView;
}

- (ZynthYogaLayout *)yogaForSurface:(int)surfaceId {
  NSNumber *key = @(surfaceId);
  ZynthYogaLayout *layout = _surfaceYoga[key];
  if (layout) return layout;
  [self ensureSurface:surfaceId];
  return _surfaceYoga[key] ?: _surfaceYoga[@(0)];
}

- (ZynthYogaLayout *)yogaForNode:(NSNumber *)nodeId {
  NSNumber *surfaceId = _nodeSurfaces[nodeId];
  return [self yogaForSurface:(surfaceId ? surfaceId.intValue : _activeSurfaceId)];
}

- (void)markSurfaceDirty:(int)surfaceId {
  if ([NSThread isMainThread]) {
    [_dirtySurfaces addObject:@(surfaceId)];
    _needsLayout = YES;
    if (_displayLink) _displayLink.paused = NO;
  } else {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self markSurfaceDirty:surfaceId];
    });
  }
}

- (void)markSurfaceDirtyForNode:(NSNumber *)nodeId {
  NSNumber *surfaceId = _nodeSurfaces[nodeId];
  if (surfaceId) {
    [self markSurfaceDirty:surfaceId.intValue];
  } else {
    [self markSurfaceDirty:_activeSurfaceId];
  }
}

- (void)syncSurfaceRootSize:(int)surfaceId rootView:(UIView *)rootView {
  if (!rootView) return;
  CGSize size = _rootView.bounds.size;
  if (size.width <= 0 || size.height <= 0) return;
  NSNumber *key = @(surfaceId);
  NSValue *prev = _surfaceSizes[key];
  if (!prev || !CGSizeEqualToSize(prev.CGSizeValue, size)) {
    rootView.frame = CGRectMake(0, 0, size.width, size.height);
    _surfaceSizes[key] = [NSValue valueWithCGSize:size];
    [_dirtySurfaces addObject:key];
  }
}

- (void)observeValueForKeyPath:(NSString *)keyPath
                      ofObject:(id)object
                        change:(NSDictionary<NSKeyValueChangeKey, id> *)change
                       context:(void *)context {
  if (object == _rootView && [keyPath isEqualToString:@"bounds"]) {
    for (NSNumber *key in _surfaceRoots) {
      [self markSurfaceDirty:key.intValue];
    }
    [self requestLayout];
    return;
  }
  [super observeValueForKeyPath:keyPath ofObject:object change:change context:context];
}

@end
