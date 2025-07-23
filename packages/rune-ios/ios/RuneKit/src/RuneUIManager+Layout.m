#import "RuneUIManager+Layout.h"
#import "RuneUIManager+Events.h"
#import "SNUIManager+Internal.h"
#import "utils/RuneGradientParser.h"

extern void SNApplyGradientToView(UIView *view, RuneLinearGradient *gradient);

#if __has_include(<RuneKit/RuneKit-Swift.h>)
#import <RuneKit/RuneKit-Swift.h>
#elif __has_include("RuneKit-Swift.h")
#import "RuneKit-Swift.h"
#endif

static NSString *const kRuneBorderLayerName = @"rune-border-style";

@implementation SNUIManager (RuneLayout)

- (void)rune_startDisplayLinkIfNeeded {
  if (self.displayLink) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.displayLink) return;
    [self rune_setDisplayLink:[CADisplayLink displayLinkWithTarget:self selector:@selector(rune_displayLinkTick:)]];
    [self.displayLink addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
  });
}

- (void)rune_stopDisplayLink {
  if (self.displayLink) {
    [self.displayLink invalidate];
    [self rune_setDisplayLink:nil];
  }
}

- (void)rune_markNeedsFlush {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self rune_setNeedsFlush:YES];
    [self rune_startDisplayLinkIfNeeded];
  });
}

- (void)rune_displayLinkTick:(CADisplayLink *)link {
  if (!self.needsFlush) return;
  [self rune_setNeedsFlush:NO];
  [self rune_performFlush];
}

- (void)rune_performFlush {
  [[PerformanceProfiler shared] recordLayoutStart];
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!self.nodes) {
      return;
    }
    NSArray<NSNumber *> *surfaceIds = [self rune_allSurfaceIds];
    for (NSNumber *sid in surfaceIds) {
      int surfaceId = sid.intValue;
      UIView *rootView = [self rune_rootViewForSurface:surfaceId];
      YGNodeRef rootYoga = [self rune_rootYogaForSurface:surfaceId];
      if (!rootView || !rootYoga) {
        continue;
      }

      CGSize boundsSize = rootView.bounds.size;
      if (boundsSize.width <= 0 || boundsSize.height <= 0) {
        boundsSize = rootView.frame.size;
      }
      if ((boundsSize.width <= 0 || boundsSize.height <= 0) && surfaceId == [self rune_rootSurfaceId]) {
        CGRect screenBounds = [UIScreen mainScreen].bounds;
        boundsSize = screenBounds.size;
      }

      YGNodeStyleSetWidth(rootYoga, (float)boundsSize.width);
      YGNodeStyleSetHeight(rootYoga, (float)boundsSize.height);

      if (YGNodeGetChildCount(rootYoga) > 0) {
        YGNodeRef firstChild = YGNodeGetChild(rootYoga, 0);
        YGNodeStyleSetWidth(firstChild, (float)boundsSize.width);
        YGNodeStyleSetHeight(firstChild, (float)boundsSize.height);
      }

      @try {
        YGNodeCalculateLayout(rootYoga, YGUndefined, YGUndefined, YGDirectionLTR);
      } @catch (NSException *exception) {
        NSLog(@"[SN] Exception in YGNodeCalculateLayout for surface %d: %@", surfaceId, exception);
        [[PerformanceProfiler shared] recordLayoutEnd];
        return;
      }
    }
    [[PerformanceProfiler shared] recordLayoutEnd];

    [[PerformanceProfiler shared] recordRenderStart];
    [self.nodes enumerateKeysAndObjectsUsingBlock:^(NSNumber *key, SNNode *obj, BOOL *stop) {
      if (!obj || !obj.view || !obj.yoga) {
        return;
      }

      if (!obj.view.superview) {
        return;
      }

      @try {
        CGFloat x = YGNodeLayoutGetLeft(obj.yoga);
        CGFloat y = YGNodeLayoutGetTop(obj.yoga);
        CGFloat w = YGNodeLayoutGetWidth(obj.yoga);
        CGFloat h = YGNodeLayoutGetHeight(obj.yoga);

        if (isnan(x) || isnan(y) || isnan(w) || isnan(h) ||
            isinf(x) || isinf(y) || isinf(w) || isinf(h) ||
            w < 0 || h < 0) {
          return;
        }

        // Using center/bounds instead of frame to support transform
        CGPoint center = CGPointMake(x + w / 2.0, y + h / 2.0);
        CGRect bounds = CGRectMake(0, 0, w, h);

        if (!CGPointEqualToPoint(obj.view.center, center) || !CGRectEqualToRect(obj.view.bounds, bounds)) {
          obj.view.center = center;
          obj.view.bounds = bounds;
        }
        
        [self rune_dispatchLayoutEventForNode:obj force:NO];

        // Re-apply border style to update layer paths based on new frame
        if (obj.latestStyle) {
            [self sn_applyBorderStyle:obj.latestStyle toView:obj.view];
        }
        if (obj.latestStyle) {
            id bgValue = obj.latestStyle[@"background"] ?: obj.latestStyle[@"backgroundImage"];
            RuneLinearGradient *gradient = [RuneGradientParser parse:bgValue];
            if (!gradient && [bgValue isKindOfClass:[NSString class]]) {
                gradient = [RuneGradientParser parse:bgValue];
            }
            if (gradient) {
                SNApplyGradientToView(obj.view, gradient);
            }
        }
        if (obj.latestShadowLayers || obj.latestElevation) {
            [self sn_applyShadowLayers:obj.latestShadowLayers elevation:obj.latestElevation toView:obj.view];
        }
      } @catch (NSException *exception) {
        NSLog(@"[SN] Exception applying frame for nid=%d: %@", obj.nid, exception);
      }
    }];
    
    // Post-layout pass for scroll view component content geometry updates
    [self.nodes enumerateKeysAndObjectsUsingBlock:^(NSNumber *key, SNNode *obj, BOOL *stop) {
      if (!obj || !obj.view) return;
      // Only trigger layout for views that have scroll-specific methods
      if ([obj.view respondsToSelector:@selector(insertContentSubview:atIndex:)]) {
        [obj.view setNeedsLayout];
        [obj.view layoutIfNeeded];
      }
    }];
    
    [[PerformanceProfiler shared] recordRenderEnd];
  });
}

- (void)rune_dispatchLayoutEventForNode:(SNNode *)node force:(BOOL)force {
  if (!node || !node.view || !node.hasOnLayoutHandler) {
    return;
  }

  CGRect frame = node.view.frame;
  if (CGRectIsNull(frame)) {
    return;
  }

  CGFloat width = CGRectGetWidth(frame);
  CGFloat height = CGRectGetHeight(frame);
  if (width <= 0.f && height <= 0.f) {
    return;
  }

  if (!force && node.hasDispatchedLayout && CGRectEqualToRect(node.lastLayoutFrame, frame)) {
    return;
  }

  node.lastLayoutFrame = frame;
  node.hasDispatchedLayout = YES;

  NSDictionary *layout = @{
    @"x": @(CGRectGetMinX(frame)),
    @"y": @(CGRectGetMinY(frame)),
    @"width": @(width),
    @"height": @(height),
  };
  NSDictionary *payload = @{ @"nativeEvent": @{ @"layout": layout } };
  [self rune_dispatchEvent:@"onLayout" payload:payload toNode:node];
}

@end
