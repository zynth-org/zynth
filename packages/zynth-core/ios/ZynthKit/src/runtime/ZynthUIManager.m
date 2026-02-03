#import "ZynthUIManager.h"
#import "ZynthUIBindings.h"
#import "ZynthLayoutTransition.h"
#import "ZynthUIManager+Private.h"
#import "ZynthUIManager+Scheduler.h"
#import "ZynthUIManager+Surface.h"
#import "ZynthUIManager+Events.h"
#import "ZynthUIManager+Style.h"
#import "ZynthPointerEventsView.h"
#import "ZynthColorParser.h"
#import <dispatch/dispatch.h>
#import <math.h>
#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>

@implementation ZynthUIManager

- (UIView *)viewForNodeId:(NSNumber *)nodeId {
  return _nodes[nodeId];
}

- (instancetype)initWithRootView:(UIView *)rootView {
  self = [super init];
  if (self) {
    _rootView = rootView;
    _nodes = [NSMutableDictionary dictionary];
    _nodeStates = [NSMutableDictionary dictionary];
    _eventPayloads = [NSMutableDictionary dictionary];
    _parents = [NSMutableDictionary dictionary];
    _nodeSurfaces = [NSMutableDictionary dictionary];
    _surfaceRoots = [NSMutableDictionary dictionary];
    _surfaceYoga = [NSMutableDictionary dictionary];
    _dirtySurfaces = [NSMutableSet set];
    _surfaceSizes = [NSMutableDictionary dictionary];
    _surfaceFirstFrameListeners = [NSMutableDictionary dictionary];
    _surfaceFirstFrameDispatched = [NSMutableSet set];
    _ownedSurfaces = [NSMutableSet set];
    _surfaceObserved = [NSHashTable weakObjectsHashTable];
    _surfaceIdSeed = 1 << 20;
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
    _styleLayoutFrames = [NSMutableDictionary dictionary];
    _styleLayoutDirtyNodes = [NSMutableSet set];
    _textStyleStates = [NSMutableDictionary dictionary];
    _yogaStyleCache = [NSMutableDictionary dictionary];
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
  ZynthComponentDescriptor *descriptor = ZynthGetComponentDescriptor(type);
  UIView *view = nil;
  if (descriptor && descriptor.createView) {
    view = descriptor.createView((ZynthUIManager *)self, type);
  }
  if (!view) {
    if ([type isEqualToString:@"text"]) {
      UILabel *label = [[UILabel alloc] initWithFrame:CGRectZero];
      label.numberOfLines = 0;
      view = label;
    } else {
      view = [[ZynthPointerEventsView alloc] initWithFrame:CGRectZero];
    }
  }
  _nodes[@(nid)] = view;
  _pointerEvents[@(nid)] = @"auto";
  _nodeSurfaces[@(nid)] = @(_activeSurfaceId);
  ZynthNode *node = [[ZynthNode alloc] init];
  node.nid = nid;
  node.view = view;
  node.type = type ?: @"";
  node.parentId = 0;
  node.surfaceId = _activeSurfaceId;
  node.pointerEvents = @"auto";
  _nodeStates[@(nid)] = node;
  ZynthYogaLayout *layout = [self yogaForSurface:_activeSurfaceId];
  [layout createNodeWithId:@(nid) type:type view:view];
  node.yoga = [layout yogaForNode:@(nid)];
  if (descriptor && descriptor.attach) {
    descriptor.attach((ZynthUIManager *)self, node);
  }
  [self markSurfaceDirty:_activeSurfaceId];
  return @(nid);
}

- (void)setProp:(NSNumber *)nodeId name:(NSString *)name value:(NSString *_Nullable)value {
  [self setProp:nodeId name:name valueAny:value];
}

- (void)setProp:(NSNumber *)nodeId name:(NSString *)name valueAny:(id _Nullable)value {
  UIView *view = _nodes[nodeId];
  if (!view || name.length == 0) return;
  ZynthNode *node = _nodeStates[nodeId];
  ZynthComponentDescriptor *descriptor = node ? ZynthGetComponentDescriptor(node.type) : nil;
  id parsedValue = value;
  if ([value isKindOfClass:[NSString class]]) {
    NSString *trimmed = [value stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if ([trimmed isEqualToString:@"true"] || [trimmed isEqualToString:@"false"]) {
      parsedValue = @([trimmed isEqualToString:@"true"]);
    } else {
      NSScanner *scanner = [NSScanner scannerWithString:trimmed];
      double number = 0;
      if ([scanner scanDouble:&number] && scanner.isAtEnd) {
        parsedValue = @(number);
      } else if (([trimmed hasPrefix:@"{"] && [trimmed hasSuffix:@"}"]) ||
                 ([trimmed hasPrefix:@"["] && [trimmed hasSuffix:@"]"])) {
        NSData *data = [trimmed dataUsingEncoding:NSUTF8StringEncoding];
        if (data) {
          id json = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
          if (json) {
            parsedValue = json;
          }
        }
      }
    }
  }
  if (node && descriptor && descriptor.handleSetProp) {
    if (descriptor.handleSetProp((ZynthUIManager *)self, node, name, parsedValue, [value isKindOfClass:[NSString class]] ? value : nil)) {
      return;
    }
  }
  static NSSet *styleKeys = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    styleKeys = [NSSet setWithArray:@[
      @"fontSize",
      @"fontFamily",
      @"fontWeight",
      @"fontStyle",
      @"color",
      @"textAlign",
      @"lineHeight",
      @"lineSpacing",
      @"paragraphSpacing",
      @"letterSpacing",
      @"textDecorationLine",
      @"textTransform",
      @"hyphenation",
      @"minimumFontScale"
    ]];
  });
  BOOL isStyleKey = [styleKeys containsObject:name];
  if ([self applyStyleProp:nodeId view:view name:name value:value]) {
    if (node && descriptor && descriptor.applyStyle && isStyleKey) {
      NSMutableDictionary *style = node.attachments[@"style"];
      if (!style) {
        style = [NSMutableDictionary dictionary];
        node.attachments[@"style"] = style;
      }
      if (parsedValue && parsedValue != (id)kCFNull) {
        style[name] = parsedValue;
      } else {
        [style removeObjectForKey:name];
      }
      descriptor.applyStyle((ZynthUIManager *)self, node, style.copy);
    }
    return;
  }
  if ([name isEqualToString:@"layout"]) {
    if (node) {
      node.layoutTransition = [ZynthLayoutTransitionConfig fromValue:parsedValue];
      if (!node.layoutTransition) {
        [view.layer removeAnimationForKey:@"zynth_layout"];
      }
    }
    return;
  }
  if ([name isEqualToString:@"backgroundColor"]) {
    UIColor *color = [value isKindOfClass:[UIColor class]] ? value : [ZynthColorParser parseColor:value];
    if (color) view.backgroundColor = color;
    return;
  }
  if ([name isEqualToString:@"color"] && [view isKindOfClass:[UILabel class]]) {
    UIColor *color = [value isKindOfClass:[UIColor class]] ? value : [ZynthColorParser parseColor:value];
    if (color) {
      UILabel *label = (UILabel *)view;
      label.textColor = color;
      [self applyTextValue:nodeId label:label text:label.text ?: @""];
    }
    if (node && descriptor && descriptor.applyStyle && isStyleKey) {
      NSMutableDictionary *style = node.attachments[@"style"];
      if (!style) {
        style = [NSMutableDictionary dictionary];
        node.attachments[@"style"] = style;
      }
      if (parsedValue && parsedValue != (id)kCFNull) {
        style[name] = parsedValue;
      } else {
        [style removeObjectForKey:name];
      }
      descriptor.applyStyle((ZynthUIManager *)self, node, style.copy);
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
    UIColor *color = [value isKindOfClass:[UIColor class]] ? value : [ZynthColorParser parseColor:value];
    if (color) view.layer.borderColor = color.CGColor;
    return;
  }
  if ([name isEqualToString:@"delayLongPressMs"]) {
    _longPressDurations[nodeId] = @([value doubleValue]);
    return;
  }
  if ([name isEqualToString:@"doublePressWindowMs"]) {
    _doublePressWindows[nodeId] = @([value doubleValue]);
    return;
  }
  if ([name isEqualToString:@"enableDoublePress"]) {
    BOOL enabled = [value boolValue];
    if (enabled) {
      [_doublePressNodes addObject:nodeId];
    } else {
      [_doublePressNodes removeObject:nodeId];
    }
    return;
  }
  if ([name isEqualToString:@"pointerEvents"]) {
    NSString *pe = [value isKindOfClass:[NSString class]] ? value : @"auto";
    _pointerEvents[nodeId] = pe;
    if (node) node.pointerEvents = pe;
    if ([view respondsToSelector:@selector(setPointerMode:)]) {
      ZynthPointerEventsMode mode = ZynthPointerEventsFromString(pe);
      [(id)view setPointerMode:mode];
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
    if (node && descriptor && descriptor.applyStyle && isStyleKey) {
      NSMutableDictionary *style = node.attachments[@"style"];
      if (!style) {
        style = [NSMutableDictionary dictionary];
        node.attachments[@"style"] = style;
      }
      if (parsedValue && parsedValue != (id)kCFNull) {
        style[name] = parsedValue;
      } else {
        [style removeObjectForKey:name];
      }
      descriptor.applyStyle((ZynthUIManager *)self, node, style.copy);
    }
    return;
  }
  if ([name isEqualToString:@"fontWeight"] && [view isKindOfClass:[UILabel class]]) {
    UILabel *label = (UILabel *)view;
    CGFloat fontSize = label.font ? label.font.pointSize : 14.0;
    UIFontWeight weight = UIFontWeightRegular;
    NSString *valStr = [value description];
    if ([valStr isEqualToString:@"bold"] || [valStr isEqualToString:@"700"]) weight = UIFontWeightBold;
    else if ([valStr isEqualToString:@"600"]) weight = UIFontWeightSemibold;
    else if ([valStr isEqualToString:@"500"]) weight = UIFontWeightMedium;
    label.font = [UIFont systemFontOfSize:fontSize weight:weight];
    [self applyTextValue:nodeId label:label text:label.text ?: @""];
    if (node && descriptor && descriptor.applyStyle && isStyleKey) {
      NSMutableDictionary *style = node.attachments[@"style"];
      if (!style) {
        style = [NSMutableDictionary dictionary];
        node.attachments[@"style"] = style;
      }
      if (parsedValue && parsedValue != (id)kCFNull) {
        style[name] = parsedValue;
      } else {
        [style removeObjectForKey:name];
      }
      descriptor.applyStyle((ZynthUIManager *)self, node, style.copy);
    }
    return;
  }
  if ([name isEqualToString:@"fontFamily"] && [view isKindOfClass:[UILabel class]]) {
    UILabel *label = (UILabel *)view;
    UIFont *font = [UIFont fontWithName:[value description] size:label.font.pointSize];
    if (font) {
      label.font = font;
      [self applyTextValue:nodeId label:label text:label.text ?: @""];
    }
    if (node && descriptor && descriptor.applyStyle && isStyleKey) {
      NSMutableDictionary *style = node.attachments[@"style"];
      if (!style) {
        style = [NSMutableDictionary dictionary];
        node.attachments[@"style"] = style;
      }
      if (parsedValue && parsedValue != (id)kCFNull) {
        style[name] = parsedValue;
      } else {
        [style removeObjectForKey:name];
      }
      descriptor.applyStyle((ZynthUIManager *)self, node, style.copy);
    }
    return;
  }
  if ([name isEqualToString:@"fontStyle"] && [view isKindOfClass:[UILabel class]]) {
    UILabel *label = (UILabel *)view;
    if ([[value description] isEqualToString:@"italic"]) {
      UIFontDescriptor *descriptor = [label.font.fontDescriptor fontDescriptorWithSymbolicTraits:UIFontDescriptorTraitItalic];
      if (descriptor) {
        label.font = [UIFont fontWithDescriptor:descriptor size:label.font.pointSize];
        [self applyTextValue:nodeId label:label text:label.text ?: @""];
      }
    }
    if (node && descriptor && descriptor.applyStyle && isStyleKey) {
      NSMutableDictionary *style = node.attachments[@"style"];
      if (!style) {
        style = [NSMutableDictionary dictionary];
        node.attachments[@"style"] = style;
      }
      if (parsedValue && parsedValue != (id)kCFNull) {
        style[name] = parsedValue;
      } else {
        [style removeObjectForKey:name];
      }
      descriptor.applyStyle((ZynthUIManager *)self, node, style.copy);
    }
    return;
  }
  if ([name isEqualToString:@"textAlign"] && [view isKindOfClass:[UILabel class]]) {
    UILabel *label = (UILabel *)view;
    NSString *valStr = [value description];
    if ([valStr isEqualToString:@"center"]) label.textAlignment = NSTextAlignmentCenter;
    else if ([valStr isEqualToString:@"right"]) label.textAlignment = NSTextAlignmentRight;
    else if ([valStr isEqualToString:@"left"]) label.textAlignment = NSTextAlignmentLeft;
    else label.textAlignment = NSTextAlignmentNatural;
    if (node && descriptor && descriptor.applyStyle && isStyleKey) {
      NSMutableDictionary *style = node.attachments[@"style"];
      if (!style) {
        style = [NSMutableDictionary dictionary];
        node.attachments[@"style"] = style;
      }
      if (parsedValue && parsedValue != (id)kCFNull) {
        style[name] = parsedValue;
      } else {
        [style removeObjectForKey:name];
      }
      descriptor.applyStyle((ZynthUIManager *)self, node, style.copy);
    }
    return;
  }
  if ([name isEqualToString:@"width"] || [name isEqualToString:@"height"] || [name isEqualToString:@"flexDirection"]) {
    [self cacheYogaStyle:nodeId name:name value:value];
    [[self yogaForNode:nodeId] setStyle:nodeId name:name value:value];
    [self markSurfaceDirtyForNode:nodeId];
    return;
  }
  [self cacheYogaStyle:nodeId name:name value:value];
  [[self yogaForNode:nodeId] setStyle:nodeId name:name value:value];
  [self markSurfaceDirtyForNode:nodeId];
}

- (void)setText:(NSNumber *)nodeId text:(NSString *)text {
  UIView *view = _nodes[nodeId];
  if (!view || ![view isKindOfClass:[UILabel class]]) return;
  ZynthNode *node = _nodeStates[nodeId];
  ZynthComponentDescriptor *descriptor = node ? ZynthGetComponentDescriptor(node.type) : nil;
  if (node && descriptor && descriptor.handleSetProp) {
    if (descriptor.handleSetProp((ZynthUIManager *)self, node, @"text", text ?: @"", text)) {
      return;
    }
  }
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

- (void)insertChild:(NSNumber *)parentId child:(NSNumber *)childId index:(NSNumber *)index {
  UIView *child = _nodes[childId];
  if (!child) return;
  BOOL isSurfaceRoot = [self isSurfaceRootId:parentId];
  int surfaceId = _activeSurfaceId;
  if (isSurfaceRoot) {
    surfaceId = parentId.intValue;
  } else if (parentId.intValue != 0) {
    NSNumber *parentSurface = _nodeSurfaces[parentId];
    if (parentSurface) surfaceId = parentSurface.intValue;
  }
  UIView *parent = (parentId.intValue == 0 || isSurfaceRoot)
                       ? [self rootViewForSurface:surfaceId]
                       : _nodes[parentId];
  if (!parent) return;
  ZynthNode *parentNode = _nodeStates[parentId];
  ZynthNode *childNode = _nodeStates[childId];
  _parents[childId] = parentId;
  NSNumber *previousSurface = _nodeSurfaces[childId];
  if (!previousSurface || previousSurface.intValue != surfaceId) {
    [self moveSubtree:childId toSurface:surfaceId parentId:parentId index:index];
  } else {
    _nodeSurfaces[childId] = @(surfaceId);
  }
  if (childNode) {
    childNode.parentId = parentId.intValue;
    childNode.surfaceId = surfaceId;
  }
  if (parentNode) {
    ZynthComponentDescriptor *descriptor = ZynthGetComponentDescriptor(parentNode.type);
    if (descriptor && descriptor.handleInsertChild &&
        descriptor.handleInsertChild((ZynthUIManager *)self, parentNode, childNode, childId, index.unsignedIntegerValue)) {
      return;
    }
  }
  [self markSurfaceDirtyForNode:parentId];
  if ([parent isKindOfClass:[UILabel class]]) {
    if ([child isKindOfClass:[UILabel class]]) {
      ((UILabel *)parent).text = ((UILabel *)child).text ?: @"";
      [[self yogaForNode:parentId] markDirty:parentId];
      [self markSurfaceDirty:surfaceId];
    }
    return;
  }
  if (child.superview == parent) {
    [child removeFromSuperview];
  }
  NSInteger idx = MAX(0, MIN(index.integerValue, (NSInteger)parent.subviews.count));
  [parent insertSubview:child atIndex:(NSUInteger)idx];
  if (parentNode && childId) {
    NSUInteger existing = [parentNode.children indexOfObject:childId];
    if (existing != NSNotFound) {
      [parentNode.children removeObjectAtIndex:existing];
      if ((NSInteger)existing < idx) {
        idx = MAX(0, idx - 1);
      }
    }
    [parentNode.children insertObject:childId atIndex:(NSUInteger)idx];
  }
  NSNumber *yogaParentId = isSurfaceRoot ? @(0) : parentId;
  [[self yogaForSurface:surfaceId] insertChild:yogaParentId child:childId index:index];
  [self markSurfaceDirty:surfaceId];
}

- (void)cacheYogaStyle:(NSNumber *)nodeId name:(NSString *)name value:(id)value {
  if (!nodeId || name.length == 0) return;
  NSMutableDictionary<NSString *, id> *styles = _yogaStyleCache[nodeId];
  if (!styles) {
    styles = [NSMutableDictionary dictionary];
    _yogaStyleCache[nodeId] = styles;
  }
  if (value) {
    styles[name] = value;
  } else {
    [styles removeObjectForKey:name];
  }
}

- (void)reapplyYogaStyles:(NSNumber *)nodeId surfaceId:(int)surfaceId {
  NSMutableDictionary<NSString *, id> *styles = _yogaStyleCache[nodeId];
  if (!styles) return;
  ZynthYogaLayout *layout = [self yogaForSurface:surfaceId];
  for (NSString *name in styles) {
    [layout setStyle:nodeId name:name value:styles[name]];
  }
}

- (void)moveSubtree:(NSNumber *)nodeId toSurface:(int)surfaceId parentId:(NSNumber *)parentId index:(NSNumber *)index {
  UIView *view = _nodes[nodeId];
  if (!view) return;
  NSNumber *previousSurface = _nodeSurfaces[nodeId];
  if (previousSurface && previousSurface.intValue != surfaceId) {
    ZynthYogaLayout *previousLayout = _surfaceYoga[previousSurface];
    if (previousLayout) {
      [previousLayout removeNode:nodeId];
    }
  }
  _nodeSurfaces[nodeId] = @(surfaceId);
  ZynthYogaLayout *layout = [self yogaForSurface:surfaceId];
  [layout createNodeWithId:nodeId type:_nodeStates[nodeId].type view:view];
  
  // CRITICAL FIX: Update ZynthNode.yoga pointer after recreating the node in the new layout.
  // Previous implementation left node.yoga pointing to the old (freed) node.
  _nodeStates[nodeId].yoga = [layout yogaForNode:nodeId];
  
  [self reapplyYogaStyles:nodeId surfaceId:surfaceId];
  NSNumber *yogaParentId = ([self isSurfaceRootId:parentId] || parentId.intValue == 0) ? @(0) : parentId;
  [layout insertChild:yogaParentId child:nodeId index:index];

  ZynthNode *node = _nodeStates[nodeId];
  if (!node) return;
  node.surfaceId = surfaceId;
  for (NSUInteger i = 0; i < node.children.count; i++) {
    NSNumber *childId = node.children[i];
    [self moveSubtree:childId toSurface:surfaceId parentId:nodeId index:@(i)];
  }
}

- (void)removeChild:(NSNumber *)parentId child:(NSNumber *)childId {
  UIView *child = _nodes[childId];
  if (!child) return;
  ZynthNode *parentNode = _nodeStates[parentId];
  ZynthNode *childNode = _nodeStates[childId];
  if (parentNode) {
    ZynthComponentDescriptor *descriptor = ZynthGetComponentDescriptor(parentNode.type);
    if (descriptor && descriptor.handleRemoveChild &&
        descriptor.handleRemoveChild((ZynthUIManager *)self, parentNode, childNode, childId)) {
      return;
    }
    NSUInteger existing = [parentNode.children indexOfObject:childId];
    if (existing != NSNotFound) {
      [parentNode.children removeObjectAtIndex:existing];
    }
  }

  // Unparent in Yoga before recursive removal
  NSNumber *yogaParentId = [self isSurfaceRootId:parentId] ? @(0) : parentId;
  [[self yogaForNode:childId] removeChild:yogaParentId child:childId];

  // Safe Detach Logic (Move Support)
  [self detachNode:childId];
  UIView *childView = _nodes[childId];
  [childView removeFromSuperview];

  [self markSurfaceDirtyForNode:parentId];
}

- (void)dropNode:(NSNumber *)nodeId {
  if (![NSThread isMainThread]) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self dropNode:nodeId];
    });
    return;
  }
  [self zynth_recursiveDestroyNode:nodeId];
}

- (void)zynth_recursiveDestroyNode:(NSNumber *)nodeId {
  ZynthNode *node = _nodeStates[nodeId];
  if (!node) return;

  // Recursively destroy children
  NSArray<NSNumber *> *children = [node.children copy];
  for (NSNumber *childId in children) {
    [self zynth_recursiveDestroyNode:childId];
  }

  // Retrieve layout BEFORE destroyNode wipes _nodeSurfaces
  ZynthYogaLayout *layout = [self yogaForNode:nodeId];

  // Cleanup component-specific state
  [self destroyNode:nodeId];

  // Free Yoga node and null out pointer to prevent use-after-free
  if (layout) {
    [layout removeNode:nodeId];
  }
  node.yoga = NULL;

  // Remove native view
  UIView *view = node.view;
  if (view) {
    [view removeFromSuperview];
  }

  // Final cleanup from manager dictionaries
  [_nodes removeObjectForKey:nodeId];
  [_nodeStates removeObjectForKey:nodeId];
  [_parents removeObjectForKey:nodeId];
  // [_nodeSurfaces removeObjectForKey:nodeId]; // Already done in destroyNode
  [_layoutNodes removeObject:nodeId];
  [_layoutPending removeObject:nodeId];
  [_yogaStyleCache removeObjectForKey:nodeId];
}

- (void)setHandler:(NSNumber *)nodeId name:(NSString *)name {
  UIView *view = _nodes[nodeId];
  if (!view || name.length == 0) return;
  ZynthNode *node = _nodeStates[nodeId];
  if (node) {
    ZynthComponentDescriptor *descriptor = ZynthGetComponentDescriptor(node.type);
    if (descriptor && descriptor.handleSetHandler &&
        descriptor.handleSetHandler((ZynthUIManager *)self, node, name)) {
      return;
    }
    if ([name isEqualToString:@"onPress"] || [name isEqualToString:@"onPressIn"] ||
        [name isEqualToString:@"onPressOut"] || [name isEqualToString:@"onLongPress"] ||
        [name isEqualToString:@"onDoublePress"]) {
      node.hasOnPressHandler = YES;
    }
    if ([name isEqualToString:@"onLayout"]) {
      node.hasOnLayoutHandler = YES;
    }
  }
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

- (ZynthNode *)getNodeState:(NSNumber *)nodeId {
  return _nodeStates[nodeId];
}

- (NSNumber *)getParentId:(NSNumber *)nodeId {
  return _parents[nodeId];
}

- (void)markNodeDirty:(NSNumber *)nodeId {
  [[self yogaForNode:nodeId] markDirty:nodeId];
  [self markSurfaceDirtyForNode:nodeId];
}

- (void)applyKeyboardAvoidingAdjustment:(NSNumber *)nodeId behavior:(NSString *)behavior overlap:(CGFloat)overlap availableHeight:(NSNumber *_Nullable)availableHeight {
  if (![NSThread isMainThread]) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self applyKeyboardAvoidingAdjustment:nodeId behavior:behavior overlap:overlap availableHeight:availableHeight];
    });
    return;
  }
  
  NSMutableDictionary *cached = _yogaStyleCache[nodeId];
  ZynthYogaLayout *yoga = [self yogaForNode:nodeId];
  CGFloat safeOverlap = MAX(0, overlap);
  
  if (safeOverlap <= 0) {
    if ([behavior isEqualToString:@"padding"]) {
      id original = cached[@"paddingBottom"] ?: @"0";
      [yoga setStyle:nodeId name:@"paddingBottom" value:original];
    } else if ([behavior isEqualToString:@"height"]) {
      id original = cached[@"marginBottom"] ?: @"0";
      [yoga setStyle:nodeId name:@"marginBottom" value:original];
    }
    [self markSurfaceDirtyForNode:nodeId];
    return;
  }
  
  if ([behavior isEqualToString:@"padding"]) {
    CGFloat base = [cached[@"paddingBottom"] doubleValue];
    [yoga setStyle:nodeId name:@"paddingBottom" value:@(base + safeOverlap)];
  } else if ([behavior isEqualToString:@"height"]) {
    CGFloat base = [cached[@"marginBottom"] doubleValue];
    [yoga setStyle:nodeId name:@"marginBottom" value:@(base + safeOverlap)];
  }
  [self markSurfaceDirtyForNode:nodeId];
}

- (void)dealloc {
  // Unregister all surfaces to trigger recursive node cleanup
  NSArray<NSNumber *> *surfaceIds = [_surfaceRoots allKeys];
  for (NSNumber *sid in surfaceIds) {
    [self unregisterSurface:sid.intValue];
  }

  if (_rootView) {
    @try {
      [_rootView removeObserver:self forKeyPath:@"bounds"];
    } @catch (__unused NSException *exception) {
    }
  }
  if (_surfaceObserved) {
    for (UIView *view in _surfaceObserved.allObjects) {
      @try {
        [view removeObserver:self forKeyPath:@"bounds"];
      } @catch (__unused NSException *exception) {
      }
    }
    [_surfaceObserved removeAllObjects];
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
