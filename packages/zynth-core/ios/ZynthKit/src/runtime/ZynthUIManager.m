#import "ZynthUIManager.h"
#import "ZynthUIBindings.h"
#import "ZynthUIManager+Private.h"
#import "ZynthUIManager+Scheduler.h"
#import "ZynthUIManager+Surface.h"
#import "ZynthUIManager+Events.h"
#import "ZynthUIManager+Style.h"
#import "ZynthColorParser.h"
#import <dispatch/dispatch.h>
#import <math.h>
#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>

@implementation ZynthUIManager

- (instancetype)initWithRootView:(UIView *)rootView {
  self = [super init];
  if (self) {
    _rootView = rootView;
    _nodes = [NSMutableDictionary dictionary];
    _parents = [NSMutableDictionary dictionary];
    _nodeSurfaces = [NSMutableDictionary dictionary];
    _surfaceRoots = [NSMutableDictionary dictionary];
    _surfaceYoga = [NSMutableDictionary dictionary];
    _dirtySurfaces = [NSMutableSet set];
    _surfaceSizes = [NSMutableDictionary dictionary];
    _activeSurfaceId = 0;
    _pointerEvents = [NSMutableDictionary dictionary];
    _pressNodes = [NSMutableSet set];
    _longPressNodes = [NSMutableSet set];
    _doublePressNodes = [NSMutableSet set];
    _activePressNodes = [NSMutableSet set];
    _longPressFired = [NSMutableSet set];
    _longPressDurations = [NSMutableDictionary dictionary];
    _doublePressWindows = [NSMutableDictionary dictionary];
    _lastPressTimestamps = [NSMutableDictionary dictionary];
    _pressLocalPoints = [NSMutableDictionary dictionary];
    _pressScreenPoints = [NSMutableDictionary dictionary];
    _longPressTimers = [NSMutableDictionary dictionary];
    _layoutNodes = [NSMutableSet set];
    _layoutPending = [NSMutableSet set];
    _layoutFrames = [NSMutableDictionary dictionary];
    _styleStates = [NSMutableDictionary dictionary];
    _styleDirtyNodes = [NSMutableSet set];
    _textStyleStates = [NSMutableDictionary dictionary];
    _nextId = 1;
    _needsLayout = NO;
    _frameInProgress = NO;
    _didWarmup = NO;
    _budgetOverruns = 0;
    _lastLayoutMs = 0;
    _lastFrameMs = 0;
    [self ensureSurface:0];
    [self ensureDisplayLink];
    [_rootView addObserver:self forKeyPath:@"bounds" options:NSKeyValueObservingOptionNew context:nil];
  }
  return self;
}

- (NSNumber *)createNode:(NSString *)type {
  int nid = _nextId++;
  UIView *view = nil;
  if ([type isEqualToString:@"text"]) {
    UILabel *label = [[UILabel alloc] initWithFrame:CGRectZero];
    label.numberOfLines = 0;
    view = label;
  } else {
    view = [[UIView alloc] initWithFrame:CGRectZero];
  }
  _nodes[@(nid)] = view;
  _pointerEvents[@(nid)] = @"auto";
  _nodeSurfaces[@(nid)] = @(_activeSurfaceId);
  ZynthYogaLayout *layout = [self yogaForSurface:_activeSurfaceId];
  [layout createNodeWithId:@(nid) type:type view:view];
  [self markSurfaceDirty:_activeSurfaceId];
  return @(nid);
}

- (void)setProp:(NSNumber *)nodeId name:(NSString *)name value:(NSString *)value {
  UIView *view = _nodes[nodeId];
  if (!view || name.length == 0) return;
  if ([self applyStyleProp:nodeId view:view name:name value:value]) {
    return;
  }
  if ([name isEqualToString:@"backgroundColor"]) {
    UIColor *color = [ZynthColorParser parseColor:value];
    if (color) view.backgroundColor = color;
    return;
  }
  if ([name isEqualToString:@"color"] && [view isKindOfClass:[UILabel class]]) {
    UIColor *color = [ZynthColorParser parseColor:value];
    if (color) {
      UILabel *label = (UILabel *)view;
      label.textColor = color;
      [self applyTextValue:nodeId label:label text:label.text ?: @""];
    }
    return;
  }
  if ([name isEqualToString:@"opacity"]) {
    view.alpha = (CGFloat)[value doubleValue];
    return;
  }
  if ([name isEqualToString:@"zIndex"]) {
    view.layer.zPosition = (CGFloat)[value doubleValue];
    return;
  }
  if ([name isEqualToString:@"borderRadius"]) {
    view.layer.cornerRadius = (CGFloat)[value doubleValue];
    view.clipsToBounds = YES;
    return;
  }
  if ([name isEqualToString:@"borderWidth"]) {
    view.layer.borderWidth = (CGFloat)[value doubleValue];
    return;
  }
  if ([name isEqualToString:@"borderColor"]) {
    UIColor *color = [ZynthColorParser parseColor:value];
    if (color) view.layer.borderColor = color.CGColor;
    return;
  }
  if ([name isEqualToString:@"delayLongPressMs"]) {
    if (value.length > 0) {
      _longPressDurations[nodeId] = @([value doubleValue]);
    } else {
      [_longPressDurations removeObjectForKey:nodeId];
    }
    return;
  }
  if ([name isEqualToString:@"doublePressWindowMs"]) {
    if (value.length > 0) {
      _doublePressWindows[nodeId] = @([value doubleValue]);
    } else {
      [_doublePressWindows removeObjectForKey:nodeId];
    }
    return;
  }
  if ([name isEqualToString:@"enableDoublePress"]) {
    if (value.length > 0) {
      NSString *lower = [value lowercaseString];
      BOOL enabled = [lower isEqualToString:@"true"] || [lower isEqualToString:@"1"];
      if (enabled) {
        [_doublePressNodes addObject:nodeId];
      } else {
        [_doublePressNodes removeObject:nodeId];
      }
    }
    return;
  }
  if ([name isEqualToString:@"pointerEvents"]) {
    if (value.length > 0) {
      _pointerEvents[nodeId] = value;
    } else {
      [_pointerEvents removeObjectForKey:nodeId];
    }
    [self updateInteractionStateForNode:nodeId];
    return;
  }
  if ([name isEqualToString:@"fontSize"] && [view isKindOfClass:[UILabel class]]) {
    UILabel *label = (UILabel *)view;
    CGFloat size = (CGFloat)[value doubleValue];
    UIFont *font = label.font ?: [UIFont systemFontOfSize:size];
    label.font = [font fontWithSize:size];
    [self applyTextValue:nodeId label:label text:label.text ?: @""];
    return;
  }
  if ([name isEqualToString:@"fontWeight"] && [view isKindOfClass:[UILabel class]]) {
    UILabel *label = (UILabel *)view;
    CGFloat fontSize = label.font ? label.font.pointSize : 14.0;
    UIFontWeight weight = UIFontWeightRegular;
    if ([value isEqualToString:@"bold"] || [value isEqualToString:@"700"]) weight = UIFontWeightBold;
    else if ([value isEqualToString:@"600"]) weight = UIFontWeightSemibold;
    else if ([value isEqualToString:@"500"]) weight = UIFontWeightMedium;
    label.font = [UIFont systemFontOfSize:fontSize weight:weight];
    [self applyTextValue:nodeId label:label text:label.text ?: @""];
    return;
  }
  if ([name isEqualToString:@"fontFamily"] && [view isKindOfClass:[UILabel class]]) {
    UILabel *label = (UILabel *)view;
    UIFont *font = [UIFont fontWithName:value size:label.font.pointSize];
    if (font) {
      label.font = font;
      [self applyTextValue:nodeId label:label text:label.text ?: @""];
    }
    return;
  }
  if ([name isEqualToString:@"fontStyle"] && [view isKindOfClass:[UILabel class]]) {
    UILabel *label = (UILabel *)view;
    if ([value isEqualToString:@"italic"]) {
      UIFontDescriptor *descriptor = [label.font.fontDescriptor fontDescriptorWithSymbolicTraits:UIFontDescriptorTraitItalic];
      if (descriptor) {
        label.font = [UIFont fontWithDescriptor:descriptor size:label.font.pointSize];
        [self applyTextValue:nodeId label:label text:label.text ?: @""];
      }
    }
    return;
  }
  if ([name isEqualToString:@"textAlign"] && [view isKindOfClass:[UILabel class]]) {
    UILabel *label = (UILabel *)view;
    if ([value isEqualToString:@"center"]) label.textAlignment = NSTextAlignmentCenter;
    else if ([value isEqualToString:@"right"]) label.textAlignment = NSTextAlignmentRight;
    else if ([value isEqualToString:@"left"]) label.textAlignment = NSTextAlignmentLeft;
    else label.textAlignment = NSTextAlignmentNatural;
    return;
  }
  if ([name isEqualToString:@"width"]) {
    [[self yogaForNode:nodeId] setStyle:nodeId name:@"width" value:value];
    [self markSurfaceDirtyForNode:nodeId];
    return;
  }
  if ([name isEqualToString:@"height"]) {
    [[self yogaForNode:nodeId] setStyle:nodeId name:@"height" value:value];
    [self markSurfaceDirtyForNode:nodeId];
    return;
  }
  if ([name isEqualToString:@"flexDirection"]) {
    [[self yogaForNode:nodeId] setStyle:nodeId name:@"flexDirection" value:value];
    [self markSurfaceDirtyForNode:nodeId];
    return;
  }
  [[self yogaForNode:nodeId] setStyle:nodeId name:name value:value];
  [self markSurfaceDirtyForNode:nodeId];
}

- (void)setText:(NSNumber *)nodeId text:(NSString *)text {
  UIView *view = _nodes[nodeId];
  if ([view isKindOfClass:[UILabel class]]) {
    UILabel *label = (UILabel *)view;
    [self applyTextValue:nodeId label:label text:text ?: @""];
    [[self yogaForNode:nodeId] markDirty:nodeId];
    [self markSurfaceDirtyForNode:nodeId];
    NSNumber *parentId = _parents[nodeId];
    if (parentId) {
      UIView *parent = _nodes[parentId];
      if ([parent isKindOfClass:[UILabel class]]) {
        UILabel *parentLabel = (UILabel *)parent;
        [self applyTextValue:parentId label:parentLabel text:text ?: @""];
        [[self yogaForNode:parentId] markDirty:parentId];
        [self markSurfaceDirtyForNode:parentId];
      }
    }
  }
}

- (void)insertChild:(NSNumber *)parentId child:(NSNumber *)childId index:(NSNumber *)index {
  UIView *child = _nodes[childId];
  if (!child) return;
  int surfaceId = _activeSurfaceId;
  if (parentId.intValue != 0) {
    NSNumber *parentSurface = _nodeSurfaces[parentId];
    if (parentSurface) surfaceId = parentSurface.intValue;
  }
  UIView *parent = parentId.intValue == 0 ? [self rootViewForSurface:surfaceId] : _nodes[parentId];
  if (!parent) return;
  _parents[childId] = parentId;
  _nodeSurfaces[childId] = @(surfaceId);
  if ([parent isKindOfClass:[UILabel class]]) {
    if ([child isKindOfClass:[UILabel class]]) {
      ((UILabel *)parent).text = ((UILabel *)child).text ?: @"";
      [[self yogaForNode:parentId] markDirty:parentId];
      [self markSurfaceDirty:surfaceId];
    }
    return;
  }
  NSInteger idx = MAX(0, MIN(index.integerValue, (NSInteger)parent.subviews.count));
  [parent insertSubview:child atIndex:(NSUInteger)idx];
  [[self yogaForSurface:surfaceId] insertChild:parentId child:childId index:index];
  [self markSurfaceDirty:surfaceId];
}

- (void)removeChild:(NSNumber *)parentId child:(NSNumber *)childId {
  UIView *child = _nodes[childId];
  if (!child) return;
  [self cleanupNode:childId];
  [_parents removeObjectForKey:childId];
  [child removeFromSuperview];
  [[self yogaForNode:childId] removeChild:parentId child:childId];
  [self markSurfaceDirtyForNode:childId];
}

- (void)setHandler:(NSNumber *)nodeId name:(NSString *)name {
  UIView *view = _nodes[nodeId];
  if (!view || name.length == 0) return;
  if ([name isEqualToString:@"onPress"] || [name isEqualToString:@"onPressIn"] ||
      [name isEqualToString:@"onPressOut"] || [name isEqualToString:@"onLongPress"] ||
      [name isEqualToString:@"onDoublePress"]) {
    [_pressNodes addObject:nodeId];
    if ([name isEqualToString:@"onLongPress"]) {
      [_longPressNodes addObject:nodeId];
    }
    if ([name isEqualToString:@"onDoublePress"]) {
      [_doublePressNodes addObject:nodeId];
    }
    [self attachPressRecognizerForNode:nodeId];
    [self updateInteractionStateForNode:nodeId];
    return;
  }
  if ([name isEqualToString:@"onLayout"]) {
    [_layoutNodes addObject:nodeId];
    [_layoutPending addObject:nodeId];
    [self requestLayout];
    return;
  }
}

- (void)applyBatch:(NSString *)batchJSON {
  (void)batchJSON;
}

- (void)setSurface:(NSNumber *)surfaceId {
  if (!surfaceId) return;
  [self ensureSurface:surfaceId.intValue];
  _activeSurfaceId = surfaceId.intValue;
  [self markSurfaceDirty:_activeSurfaceId];
}

- (void)flush {
  [self markSurfaceDirty:_activeSurfaceId];
  [self requestLayout];
}

- (void)setFrameProfiler:(void (^)(NSTimeInterval,
                                   NSTimeInterval,
                                   BOOL,
                                   NSUInteger))profiler {
  [self zynth_setFrameProfilerInternal:profiler];
}

- (void)dealloc {
  if (_rootView) {
    @try {
      [_rootView removeObserver:self forKeyPath:@"bounds"];
    } @catch (__unused NSException *exception) {
    }
  }
  for (NSNumber *key in _longPressTimers) {
    dispatch_source_t timer = _longPressTimers[key];
    if (timer) dispatch_source_cancel(timer);
  }
  [_longPressTimers removeAllObjects];
  if (_displayLink) {
    [_displayLink invalidate];
    _displayLink = nil;
  }
}

@end
