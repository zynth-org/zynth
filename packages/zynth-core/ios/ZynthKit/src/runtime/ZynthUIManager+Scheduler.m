#import "ZynthUIManager+Private.h"
#import "ZynthUIManager+Scheduler.h"
#import "ZynthUIManager+Surface.h"
#import "ZynthUIManager+Events.h"
#import "ZynthUIManager+Style.h"

@implementation ZynthUIManager (Scheduler)

- (void)zynth_setFrameProfilerInternal:(void (^)(NSTimeInterval,
                                                 NSTimeInterval,
                                                 BOOL,
                                                 NSUInteger))profiler {
  _frameProfiler = [profiler copy];
}

- (void)ensureDisplayLink {
  if (_displayLink) return;
  if ([NSThread isMainThread]) {
    _displayLink = [CADisplayLink displayLinkWithTarget:self selector:@selector(handleDisplayLink:)];
    _displayLink.paused = YES;
    [_displayLink addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
  } else {
    dispatch_async(dispatch_get_main_queue(), ^{
      if (self->_displayLink) return;
      self->_displayLink = [CADisplayLink displayLinkWithTarget:self selector:@selector(handleDisplayLink:)];
      self->_displayLink.paused = YES;
      [self->_displayLink addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
    });
  }
}

- (void)requestLayout {
  if ([NSThread isMainThread]) {
    [self ensureDisplayLink];
    _needsLayout = YES;
    if (_displayLink) _displayLink.paused = NO;
  } else {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self ensureDisplayLink];
      self->_needsLayout = YES;
      if (self->_displayLink) self->_displayLink.paused = NO;
    });
  }
}

- (void)handleDisplayLink:(CADisplayLink *)link {
  (void)link;
  if (_frameInProgress) return;
  if (_dirtySurfaces.count == 0) {
    _displayLink.paused = YES;
    return;
  }
  _frameInProgress = YES;
  _needsLayout = NO;

  static const NSTimeInterval kFrameBudgetMs = 14.0;
  CFTimeInterval frameStart = CACurrentMediaTime();
  if (!_didWarmup) {
    _didWarmup = YES;
    [self warmUpTextMeasurement];
  }
  NSSet<NSNumber *> *dirtySurfaces = [_dirtySurfaces copy];
  [_dirtySurfaces removeAllObjects];
  for (NSNumber *key in dirtySurfaces) {
    UIView *root = [self rootViewForSurface:key.intValue];
    [self syncSurfaceRootSize:key.intValue rootView:root];
    ZynthYogaLayout *layout = [self yogaForSurface:key.intValue];
    [layout applyLayout];
  }
  [self applyStyleLayoutIfNeeded];
  CFTimeInterval frameEnd = CACurrentMediaTime();
  _lastFrameMs = (frameEnd - frameStart) * 1000.0;
  _lastLayoutMs = _lastFrameMs;
  BOOL overBudget = _lastFrameMs > kFrameBudgetMs;
  NSUInteger nodeCount = 0;
  for (NSNumber *key in _surfaceYoga) {
    nodeCount += [_surfaceYoga[key] nodeCount];
  }
  NSLog(@"[ZynthUI] frame summary %.2fms layout=%.2fms surfaces=%lu nodes=%lu overBudget=%@",
        _lastFrameMs,
        _lastLayoutMs,
        (unsigned long)dirtySurfaces.count,
        (unsigned long)nodeCount,
        overBudget ? @"true" : @"false");
  if (overBudget) {
    _budgetOverruns += 1;
    NSLog(@"[ZynthUI] frame over budget %.2fms (budget %.2fms, nodes %lu, overruns %lu)",
          _lastFrameMs, kFrameBudgetMs, (unsigned long)nodeCount,
          (unsigned long)_budgetOverruns);
  }
  if (_frameProfiler) {
    _frameProfiler(_lastFrameMs, _lastLayoutMs, overBudget, nodeCount);
  }
  [self dispatchLayoutEvents];
  _frameInProgress = NO;
  if (_dirtySurfaces.count == 0) {
    _displayLink.paused = YES;
  }
}

- (void)warmUpTextMeasurement {
  UILabel *label = [[UILabel alloc] initWithFrame:CGRectZero];
  label.text = @"Z";
  (void)[label sizeThatFits:CGSizeMake(1000.0, CGFLOAT_MAX)];
}

@end
