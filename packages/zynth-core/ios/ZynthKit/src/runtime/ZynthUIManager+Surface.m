#import "ZynthUIManager+Private.h"
#import "ZynthUIManager+Scheduler.h"
#import "ZynthUIManager+Surface.h"
#import "ZynthUIManager+Events.h"
#import "ZynthPointerEventsView.h"

static const int kZynthSurfaceIdBase = 1 << 20;

@implementation ZynthUIManager (Surface)

- (int)rootSurfaceId {
  return 0;
}

- (BOOL)isSurfaceRootId:(NSNumber *)nodeId {
  if (!nodeId) return NO;
  return _surfaceRoots[nodeId] != nil;
}

- (BOOL)hasSurface:(int)surfaceId {
  return _surfaceRoots[@(surfaceId)] != nil;
}

- (int)allocateSurfaceId {
  int candidate = _surfaceIdSeed;
  int minSafe = _nextId + kZynthSurfaceIdBase;
  if (candidate < minSafe) {
    candidate = minSafe;
  }
  while (_surfaceRoots[@(candidate)] != nil) {
    candidate += kZynthSurfaceIdBase;
  }
  _surfaceIdSeed = candidate + 1;
  return candidate;
}

- (NSNumber *)registerSurfaceWithRootView:(UIView *)rootView {
  if (!rootView) return nil;
  if (![NSThread isMainThread]) {
    __block NSNumber *result = nil;
    dispatch_sync(dispatch_get_main_queue(), ^{
      result = [self registerSurfaceWithRootView:rootView];
    });
    return result;
  }
  for (NSNumber *key in _surfaceRoots) {
    if (_surfaceRoots[key] == rootView) {
      return key;
    }
  }
  int surfaceId = [self allocateSurfaceId];
  if (_surfaceRoots[@(surfaceId)]) {
    return @(surfaceId);
  }
  if (_nextId <= surfaceId) {
    _nextId = surfaceId + 1;
  }
  _surfaceRoots[@(surfaceId)] = rootView;
  ZynthYogaLayout *layout = [[ZynthYogaLayout alloc] initWithRootView:rootView];
  __weak typeof(self) weakSelf = self;
  layout.layoutDidUpdate = ^(NSNumber *nodeId, CGRect bounds, BOOL changed) {
    if (!changed) return;
    __strong typeof(self) strongSelf = weakSelf;
    if (!strongSelf) return;
    if (strongSelf->_styleStates[nodeId]) {
      [strongSelf->_styleLayoutDirtyNodes addObject:nodeId];
      strongSelf->_styleLayoutFrames[nodeId] = [NSValue valueWithCGRect:bounds];
    }
  };
  _surfaceYoga[@(surfaceId)] = layout;
  _surfaceSizes[@(surfaceId)] = [NSValue valueWithCGSize:rootView.bounds.size];
  if (rootView != _rootView && ![_surfaceObserved containsObject:rootView]) {
    [rootView addObserver:self forKeyPath:@"bounds" options:NSKeyValueObservingOptionNew context:nil];
    [_surfaceObserved addObject:rootView];
  }
  if ([rootView respondsToSelector:@selector(setPointerMode:)] && surfaceId != 0) {
    [(id)rootView setPointerMode:ZynthPointerEventsBoxNone];
  }
  [self markSurfaceDirty:surfaceId];
  return @(surfaceId);
}

- (void)unregisterSurface:(int)surfaceId {
  if (surfaceId == 0) return;
  UIView *rootView = _surfaceRoots[@(surfaceId)];
  if (!rootView) return;
  NSArray<NSNumber *> *allKeys = [_nodeStates allKeys];
  for (NSNumber *key in allKeys) {
    ZynthNode *node = _nodeStates[key];
    if (!node || node.surfaceId != surfaceId) continue;
    [self zynth_recursiveRemoveNode:key];
  }
  if ([_ownedSurfaces containsObject:@(surfaceId)]) {
    [rootView removeFromSuperview];
  }
  [_ownedSurfaces removeObject:@(surfaceId)];
  [_surfaceRoots removeObjectForKey:@(surfaceId)];
  [_surfaceYoga removeObjectForKey:@(surfaceId)];
  [_surfaceSizes removeObjectForKey:@(surfaceId)];
  [_dirtySurfaces removeObject:@(surfaceId)];
  if ([_surfaceObserved containsObject:rootView]) {
    @try {
      [rootView removeObserver:self forKeyPath:@"bounds"];
    } @catch (__unused NSException *exception) {
    }
    [_surfaceObserved removeObject:rootView];
  }
  if (_activeSurfaceId == surfaceId) {
    _activeSurfaceId = 0;
  }
}

- (void)ensureSurface:(int)surfaceId {
  NSNumber *key = @(surfaceId);
  if (_surfaceRoots[key] && _surfaceYoga[key]) return;
  UIView *root = nil;
  if (surfaceId == 0) {
    root = _rootView;
  } else {
    root = [[ZynthPointerEventsView alloc] initWithFrame:_rootView.bounds];
    ((ZynthPointerEventsView *)root).pointerMode = ZynthPointerEventsBoxNone;
    root.backgroundColor = UIColor.clearColor;
    [_rootView addSubview:root];
  }
  if (!root) return;
  _surfaceRoots[key] = root;
  ZynthYogaLayout *layout = [[ZynthYogaLayout alloc] initWithRootView:root];
  __weak typeof(self) weakSelf = self;
  layout.layoutDidUpdate = ^(NSNumber *nodeId, CGRect bounds, BOOL changed) {
    if (!changed) return;
    __strong typeof(self) strongSelf = weakSelf;
    if (!strongSelf) return;
    if (strongSelf->_styleStates[nodeId]) {
      [strongSelf->_styleLayoutDirtyNodes addObject:nodeId];
      strongSelf->_styleLayoutFrames[nodeId] = [NSValue valueWithCGRect:bounds];
    }
  };
  _surfaceYoga[key] = layout;
  _surfaceSizes[key] = [NSValue valueWithCGSize:root.bounds.size];
  if (surfaceId != 0) {
    [_ownedSurfaces addObject:key];
  }
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
  CGSize size = rootView.bounds.size;
  if (size.width <= 0 || size.height <= 0) {
    UIView *superview = rootView.superview;
    if (superview) {
      size = superview.bounds.size;
    }
  }
  if (size.width <= 0 || size.height <= 0) return;
  if (surfaceId != 0) {
    BOOL hasChildren = rootView.subviews.count > 0;
    rootView.userInteractionEnabled = hasChildren;
  }
  NSNumber *key = @(surfaceId);
  NSValue *prev = _surfaceSizes[key];
  if (!prev || !CGSizeEqualToSize(prev.CGSizeValue, size)) {
    if ([_ownedSurfaces containsObject:key]) {
      rootView.frame = CGRectMake(0, 0, size.width, size.height);
    }
    _surfaceSizes[key] = [NSValue valueWithCGSize:size];
    [_dirtySurfaces addObject:key];
  }
}

- (void)observeValueForKeyPath:(NSString *)keyPath
                      ofObject:(id)object
                        change:(NSDictionary<NSKeyValueChangeKey, id> *)change
                       context:(void *)context {
  if ([keyPath isEqualToString:@"bounds"]) {
    if (object == _rootView) {
      for (NSNumber *key in _surfaceRoots) {
        [self markSurfaceDirty:key.intValue];
      }
      [self requestLayout];
      return;
    }
    for (NSNumber *key in _surfaceRoots) {
      if (_surfaceRoots[key] == object) {
        [self markSurfaceDirty:key.intValue];
        [self requestLayout];
        return;
      }
    }
  }
  [super observeValueForKeyPath:keyPath ofObject:object change:change context:context];
}

@end
