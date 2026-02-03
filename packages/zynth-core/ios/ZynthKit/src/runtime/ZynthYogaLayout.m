#import "ZynthYogaLayout.h"
#import <Yoga/Yoga.h>

@implementation ZynthYogaLayout {
  __weak UIView *_rootView;
  NSMutableDictionary<NSNumber *, NSValue *> *_nodes;
  YGNodeRef _rootNode;
}

static YGSize ZynthMeasureText(YGNodeConstRef node,
                               float width,
                               YGMeasureMode widthMode,
                               float height,
                               YGMeasureMode heightMode) {
  UIView *view = (__bridge UIView *)YGNodeGetContext(node);
  if (![view isKindOfClass:[UILabel class]]) {
    return (YGSize){0, 0};
  }
  UILabel *label = (UILabel *)view;
  CGFloat maxWidth = widthMode == YGMeasureModeUndefined ? CGFLOAT_MAX : width;
  CGSize size = [label sizeThatFits:CGSizeMake(maxWidth, CGFLOAT_MAX)];
  // NSLog(@"[ZynthYoga] measure text '%@' => %.1fx%.1f", label.text, size.width, size.height);
  return (YGSize){size.width, size.height};
}

- (instancetype)initWithRootView:(UIView *)rootView {
  self = [super init];
  if (self) {
    _rootView = rootView;
    _nodes = [NSMutableDictionary dictionary];
    _rootNode = YGNodeNew();
    YGNodeStyleSetFlexDirection(_rootNode, YGFlexDirectionColumn);
    YGNodeStyleSetAlignItems(_rootNode, YGAlignStretch);
  }
  return self;
}

- (void)dealloc {
  if (_rootNode) {
    YGNodeFreeRecursive(_rootNode);
    _rootNode = NULL;
  }
}

- (void)createNodeWithId:(NSNumber *)nodeId type:(NSString *)type view:(UIView *)view {
  @synchronized(self) {
    if (!nodeId || !view) return;
    if (_nodes[nodeId]) return;
    YGNodeRef node = YGNodeNew();
    YGNodeStyleSetFlexDirection(node, YGFlexDirectionColumn);
    YGNodeStyleSetAlignItems(node, YGAlignStretch);
    YGNodeSetContext(node, (__bridge void *)view);
    if ([view isKindOfClass:[UILabel class]]) {
      YGNodeSetMeasureFunc(node, ZynthMeasureText);
    }
    _nodes[nodeId] = [NSValue valueWithPointer:node];
  }
}

- (YGNodeRef)yogaForNode:(NSNumber *)nodeId {
  @synchronized(self) {
    NSValue *value = _nodes[nodeId];
    return value ? (YGNodeRef)value.pointerValue : NULL;
  }
}

- (void)removeNode:(NSNumber *)nodeId {
  @synchronized(self) {
    NSValue *value = _nodes[nodeId];
    if (!value) return;
    YGNodeRef node = (YGNodeRef)value.pointerValue;
    if (!node) {
      [_nodes removeObjectForKey:nodeId];
      return;
    }
    while (YGNodeGetChildCount(node) > 0) {
      YGNodeRef child = YGNodeGetChild(node, 0);
      if (child) {
        YGNodeRemoveChild(node, child);
      } else {
        break;
      }
    }
    YGNodeRef parent = YGNodeGetParent(node);
    if (parent) {
      YGNodeRemoveChild(parent, node);
    }
    YGNodeSetContext(node, NULL);
    YGNodeFree(node);
    [_nodes removeObjectForKey:nodeId];
  }
}

- (BOOL)isValidValue:(id)value {
  if (!value) return NO;
  if ([value isKindOfClass:[NSString class]]) {
    return [(NSString *)value length] > 0;
  }
  return YES;
}

- (double)doubleValue:(id)value {
  if ([value respondsToSelector:@selector(doubleValue)]) {
    return [value doubleValue];
  }
  return 0.0;
}

- (void)setStyle:(NSNumber *)nodeId name:(NSString *)name value:(id _Nullable)value {
  @synchronized(self) {
    YGNodeRef node = [self yogaForNode:nodeId];
    if (!node || name.length == 0) return;
    
    // Helper to ensure we only process valid strings for enums
    NSString *strValue = [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;

    if ([name isEqualToString:@"width"]) {
      [self applyDimension:value
                      node:node
                      set:^(float v) { YGNodeStyleSetWidth(node, v); }
                 setPercent:^(float v) { YGNodeStyleSetWidthPercent(node, v); }
                    setAuto:^{ YGNodeStyleSetWidthAuto(node); }];
      return;
    }
    if ([name isEqualToString:@"height"]) {
      [self applyDimension:value
                      node:node
                      set:^(float v) { YGNodeStyleSetHeight(node, v); }
                 setPercent:^(float v) { YGNodeStyleSetHeightPercent(node, v); }
                    setAuto:^{ YGNodeStyleSetHeightAuto(node); }];
      return;
    }
    if ([name isEqualToString:@"minWidth"]) {
      [self applyDimension:value
                      node:node
                      set:^(float v) { YGNodeStyleSetMinWidth(node, v); }
                 setPercent:^(float v) { YGNodeStyleSetMinWidthPercent(node, v); }
                    setAuto:nil];
      return;
    }
    if ([name isEqualToString:@"minHeight"]) {
      [self applyDimension:value
                      node:node
                      set:^(float v) { YGNodeStyleSetMinHeight(node, v); }
                 setPercent:^(float v) { YGNodeStyleSetMinHeightPercent(node, v); }
                    setAuto:nil];
      return;
    }
    if ([name isEqualToString:@"maxWidth"]) {
      [self applyDimension:value
                      node:node
                      set:^(float v) { YGNodeStyleSetMaxWidth(node, v); }
                 setPercent:^(float v) { YGNodeStyleSetMaxWidthPercent(node, v); }
                    setAuto:nil];
      return;
    }
    if ([name isEqualToString:@"maxHeight"]) {
      [self applyDimension:value
                      node:node
                      set:^(float v) { YGNodeStyleSetMaxHeight(node, v); }
                 setPercent:^(float v) { YGNodeStyleSetMaxHeightPercent(node, v); }
                    setAuto:nil];
      return;
    }
    if ([name isEqualToString:@"flex"]) {
      if ([self isValidValue:value]) YGNodeStyleSetFlex(node, (float)[self doubleValue:value]);
      return;
    }
    if ([name isEqualToString:@"flexGrow"]) {
      if ([self isValidValue:value]) YGNodeStyleSetFlexGrow(node, (float)[self doubleValue:value]);
      return;
    }
    if ([name isEqualToString:@"flexShrink"]) {
      if ([self isValidValue:value]) YGNodeStyleSetFlexShrink(node, (float)[self doubleValue:value]);
      return;
    }
    if ([name isEqualToString:@"flexBasis"]) {
      [self applyDimension:value
                      node:node
                      set:^(float v) { YGNodeStyleSetFlexBasis(node, v); }
                 setPercent:^(float v) { YGNodeStyleSetFlexBasisPercent(node, v); }
                    setAuto:^{ YGNodeStyleSetFlexBasisAuto(node); }];
      return;
    }
    if ([name isEqualToString:@"flexDirection"]) {
      if ([strValue isEqualToString:@"row"]) {
        YGNodeStyleSetFlexDirection(node, YGFlexDirectionRow);
      } else if ([strValue isEqualToString:@"column-reverse"]) {
        YGNodeStyleSetFlexDirection(node, YGFlexDirectionColumnReverse);
      } else if ([strValue isEqualToString:@"row-reverse"]) {
        YGNodeStyleSetFlexDirection(node, YGFlexDirectionRowReverse);
      } else {
        YGNodeStyleSetFlexDirection(node, YGFlexDirectionColumn);
      }
      return;
    }
    if ([name isEqualToString:@"flexWrap"]) {
      if ([strValue isEqualToString:@"wrap"]) {
        YGNodeStyleSetFlexWrap(node, YGWrapWrap);
      } else if ([strValue isEqualToString:@"wrap-reverse"]) {
        YGNodeStyleSetFlexWrap(node, YGWrapWrapReverse);
      } else {
        YGNodeStyleSetFlexWrap(node, YGWrapNoWrap);
      }
      return;
    }
    if ([name isEqualToString:@"justifyContent"]) {
      YGJustify j = YGJustifyFlexStart;
      if ([strValue isEqualToString:@"flex-end"]) j = YGJustifyFlexEnd;
      else if ([strValue isEqualToString:@"center"]) j = YGJustifyCenter;
      else if ([strValue isEqualToString:@"space-between"]) j = YGJustifySpaceBetween;
      else if ([strValue isEqualToString:@"space-around"]) j = YGJustifySpaceAround;
      else if ([strValue isEqualToString:@"space-evenly"]) j = YGJustifySpaceEvenly;
      YGNodeStyleSetJustifyContent(node, j);
      return;
    }
    if ([name isEqualToString:@"alignItems"]) {
      YGNodeStyleSetAlignItems(node, [self parseAlign:value]);
      return;
    }
    if ([name isEqualToString:@"alignSelf"]) {
      YGNodeStyleSetAlignSelf(node, [self parseAlign:value]);
      return;
    }
    if ([name isEqualToString:@"alignContent"]) {
      YGNodeStyleSetAlignContent(node, [self parseAlign:value]);
      return;
    }
    if ([name isEqualToString:@"position"]) {
      if ([strValue isEqualToString:@"absolute"]) {
        YGNodeStyleSetPositionType(node, YGPositionTypeAbsolute);
      } else {
        YGNodeStyleSetPositionType(node, YGPositionTypeRelative);
      }
      return;
    }
    if ([name isEqualToString:@"top"]) {
      if ([self isValidValue:value]) YGNodeStyleSetPosition(node, YGEdgeTop, (float)[self doubleValue:value]);
      return;
    }
    if ([name isEqualToString:@"right"]) {
      if ([self isValidValue:value]) YGNodeStyleSetPosition(node, YGEdgeRight, (float)[self doubleValue:value]);
      return;
    }
    if ([name isEqualToString:@"bottom"]) {
      if ([self isValidValue:value]) YGNodeStyleSetPosition(node, YGEdgeBottom, (float)[self doubleValue:value]);
      return;
    }
    if ([name isEqualToString:@"left"]) {
      if ([self isValidValue:value]) YGNodeStyleSetPosition(node, YGEdgeLeft, (float)[self doubleValue:value]);
      return;
    }
    if ([name isEqualToString:@"padding"]) {
      if ([self isValidValue:value]) YGNodeStyleSetPadding(node, YGEdgeAll, (float)[self doubleValue:value]);
      return;
    }
    if ([name isEqualToString:@"paddingHorizontal"]) {
      if ([self isValidValue:value]) {
        float v = (float)[self doubleValue:value];
        YGNodeStyleSetPadding(node, YGEdgeLeft, v);
        YGNodeStyleSetPadding(node, YGEdgeRight, v);
      }
      return;
    }
    if ([name isEqualToString:@"paddingVertical"]) {
      if ([self isValidValue:value]) {
        float v = (float)[self doubleValue:value];
        YGNodeStyleSetPadding(node, YGEdgeTop, v);
        YGNodeStyleSetPadding(node, YGEdgeBottom, v);
      }
      return;
    }
    if ([name isEqualToString:@"paddingTop"]) {
      if ([self isValidValue:value]) YGNodeStyleSetPadding(node, YGEdgeTop, (float)[self doubleValue:value]);
      return;
    }
    if ([name isEqualToString:@"paddingRight"]) {
      if ([self isValidValue:value]) YGNodeStyleSetPadding(node, YGEdgeRight, (float)[self doubleValue:value]);
      return;
    }
    if ([name isEqualToString:@"paddingBottom"]) {
      if ([self isValidValue:value]) YGNodeStyleSetPadding(node, YGEdgeBottom, (float)[self doubleValue:value]);
      return;
    }
    if ([name isEqualToString:@"paddingLeft"]) {
      if ([self isValidValue:value]) YGNodeStyleSetPadding(node, YGEdgeLeft, (float)[self doubleValue:value]);
      return;
    }
    if ([name isEqualToString:@"margin"]) {
      if ([self isValidValue:value]) YGNodeStyleSetMargin(node, YGEdgeAll, (float)[self doubleValue:value]);
      return;
    }
    if ([name isEqualToString:@"marginHorizontal"]) {
      if ([self isValidValue:value]) {
        float v = (float)[self doubleValue:value];
        YGNodeStyleSetMargin(node, YGEdgeLeft, v);
        YGNodeStyleSetMargin(node, YGEdgeRight, v);
      }
      return;
    }
    if ([name isEqualToString:@"marginVertical"]) {
      if ([self isValidValue:value]) {
        float v = (float)[self doubleValue:value];
        YGNodeStyleSetMargin(node, YGEdgeTop, v);
        YGNodeStyleSetMargin(node, YGEdgeBottom, v);
      }
      return;
    }
    if ([name isEqualToString:@"marginTop"]) {
      if ([self isValidValue:value]) YGNodeStyleSetMargin(node, YGEdgeTop, (float)[self doubleValue:value]);
      return;
    }
    if ([name isEqualToString:@"marginRight"]) {
      if ([self isValidValue:value]) YGNodeStyleSetMargin(node, YGEdgeRight, (float)[self doubleValue:value]);
      return;
    }
    if ([name isEqualToString:@"marginBottom"]) {
      if ([self isValidValue:value]) YGNodeStyleSetMargin(node, YGEdgeBottom, (float)[self doubleValue:value]);
      return;
    }
    if ([name isEqualToString:@"marginLeft"]) {
      if ([self isValidValue:value]) YGNodeStyleSetMargin(node, YGEdgeLeft, (float)[self doubleValue:value]);
      return;
    }
    if ([name isEqualToString:@"gap"]) {
      if ([self isValidValue:value]) YGNodeStyleSetGap(node, YGGutterAll, (float)[self doubleValue:value]);
      return;
    }
    if ([name isEqualToString:@"rowGap"]) {
      if ([self isValidValue:value]) YGNodeStyleSetGap(node, YGGutterRow, (float)[self doubleValue:value]);
      return;
    }
    if ([name isEqualToString:@"columnGap"]) {
      if ([self isValidValue:value]) YGNodeStyleSetGap(node, YGGutterColumn, (float)[self doubleValue:value]);
      return;
    }
    if ([name isEqualToString:@"aspectRatio"]) {
      if ([self isValidValue:value]) YGNodeStyleSetAspectRatio(node, (float)[self doubleValue:value]);
      return;
    }
    if ([name isEqualToString:@"overflow"]) {
      if ([strValue isEqualToString:@"hidden"]) {
        YGNodeStyleSetOverflow(node, YGOverflowHidden);
      } else if ([strValue isEqualToString:@"scroll"]) {
        YGNodeStyleSetOverflow(node, YGOverflowScroll);
      } else {
        YGNodeStyleSetOverflow(node, YGOverflowVisible);
      }
      return;
    }
    if ([name isEqualToString:@"display"]) {
      if ([strValue isEqualToString:@"none"]) {
        YGNodeStyleSetDisplay(node, YGDisplayNone);
      } else if ([strValue isEqualToString:@"flex"]) {
        YGNodeStyleSetDisplay(node, YGDisplayFlex);
      } else {
        YGNodeStyleSetDisplay(node, YGDisplayFlex);
      }
      return;
    }
  }
}

- (void)insertChild:(NSNumber *)parentId child:(NSNumber *)childId index:(NSNumber *)index {
  @synchronized(self) {
    YGNodeRef child = [self yogaForNode:childId];
    if (!child) return;
    YGNodeRef parent = parentId.intValue == 0 ? _rootNode : [self yogaForNode:parentId];
    if (!parent) return;
    if (YGNodeHasMeasureFunc(parent)) {
      return;
    }
    
    // Prevent cycles
    if (parent == child) return;

    // Remove from existing parent (standard Yoga behavior)
    if (YGNodeGetOwner(child)) {
      YGNodeRef owner = YGNodeGetOwner(child);
      YGNodeRemoveChild(owner, child);
    }
    
    // Safety check: Ensure child is not already in parent (prevents duplicates if owner was desynced)
    while (true) {
      size_t count = (size_t)YGNodeGetChildCount(parent);
      BOOL found = NO;
      for (size_t i = 0; i < count; i++) {
        if (YGNodeGetChild(parent, (uint32_t)i) == child) {
          YGNodeRemoveChild(parent, child);
          found = YES;
          break;
        }
      }
      if (!found) break;
    }
    
    size_t count = YGNodeGetChildCount(parent);
    int maxIndex = (count > (size_t)INT_MAX) ? INT_MAX : (int)count;
    uint32_t idx = (uint32_t)MAX(0, MIN(index.intValue, maxIndex));
    
    YGNodeInsertChild(parent, child, idx);
  }
}

- (void)removeChild:(NSNumber *)parentId child:(NSNumber *)childId {
  @synchronized(self) {
    YGNodeRef child = [self yogaForNode:childId];
    if (!child) return;
    YGNodeRef parent = parentId.intValue == 0 ? _rootNode : [self yogaForNode:parentId];
    if (!parent) return;
    YGNodeRemoveChild(parent, child);
  }
}

- (void)markDirty:(NSNumber *)nodeId {
  @synchronized(self) {
    YGNodeRef node = [self yogaForNode:nodeId];
    if (!node) return;
    if (!YGNodeHasMeasureFunc(node)) return;
    if (YGNodeGetChildCount(node) != 0) return;
    if (YGNodeGetOwner(node) == NULL) return;
    YGNodeMarkDirty(node);
  }
}

- (void)applyLayout {
  UIView *rootView = _rootView;
  if (!rootView) return;
  __weak typeof(self) weakSelf = self;
  void (^layoutBlock)(void) = ^{
    @synchronized(self) {
      __strong typeof(self) strongSelf = weakSelf;
      if (!strongSelf) return;
      CGSize size = rootView.bounds.size;
      if (size.width <= 0 || size.height <= 0) {
        UIView *superview = rootView.superview;
        if (superview) {
          size = superview.bounds.size;
        } else {
          size = UIScreen.mainScreen.bounds.size;
        }
      }
      if (size.width <= 0 || size.height <= 0) return;
      // NSLog(@"[ZynthYoga] layout rootSize=%.1fx%.1f", size.width, size.height);
      YGNodeStyleSetWidth(strongSelf->_rootNode, (float)size.width);
      YGNodeStyleSetHeight(strongSelf->_rootNode, (float)size.height);
      YGNodeCalculateLayout(strongSelf->_rootNode, YGUndefined, YGUndefined, YGDirectionLTR);
      for (NSNumber *nodeId in strongSelf->_nodes) {
        UIView *view = [strongSelf viewForNode:nodeId];
        YGNodeRef node = [strongSelf yogaForNode:nodeId];
        if (!view || !node) continue;
        CGFloat x = YGNodeLayoutGetLeft(node);
        CGFloat y = YGNodeLayoutGetTop(node);
        CGFloat w = YGNodeLayoutGetWidth(node);
        CGFloat h = YGNodeLayoutGetHeight(node);
        if (!isfinite(x) || !isfinite(y) || !isfinite(w) || !isfinite(h)) {
          continue;
        }
        if (w <= 0.0 || h <= 0.0) {
          continue;
        }
        CGPoint anchor = view.layer.anchorPoint;
        CGPoint center = CGPointMake(x + w * anchor.x, y + h * anchor.y);
        CGRect bounds = CGRectMake(0, 0, w, h);
        BOOL frameChanged = !CGPointEqualToPoint(view.center, center) ||
                            !CGRectEqualToRect(view.bounds, bounds);
        if (frameChanged) {
          view.center = center;
          view.bounds = bounds;
        }
        if (self.layoutDidUpdate) {
          self.layoutDidUpdate(nodeId, bounds, frameChanged);
        }
      }
    }
  };
  if ([NSThread isMainThread]) {
    layoutBlock();
  } else {
    dispatch_async(dispatch_get_main_queue(), layoutBlock);
  }
}

- (NSUInteger)nodeCount {
  return _nodes.count;
}

- (UIView *)viewForNode:(NSNumber *)nodeId {
  @synchronized(self) {
    YGNodeRef node = [self yogaForNode:nodeId];
    if (!node) return nil;
    void *ctx = YGNodeGetContext(node);
    return ctx ? (__bridge UIView *)ctx : nil;
  }
}

- (void)applyDimension:(id _Nullable)value
                  node:(YGNodeRef)node
                   set:(void (^)(float))set
            setPercent:(void (^_Nullable)(float))setPercent
               setAuto:(void (^_Nullable)(void))setAuto {
  if (!value) return;
  if ([value isKindOfClass:[NSNumber class]]) {
    set(((NSNumber *)value).floatValue);
    return;
  }
  if ([value isKindOfClass:[NSString class]]) {
    NSString *str = (NSString *)value;
    if (str.length == 0) return;
    if ([str isEqualToString:@"auto"]) {
      if (setAuto) setAuto();
      return;
    }
    if ([str hasSuffix:@"%"] && setPercent) {
      NSString *trimmed = [str substringToIndex:str.length - 1];
      setPercent((float)[trimmed doubleValue]);
      return;
    }
    set((float)[str doubleValue]);
    return;
  }
}

- (YGAlign)parseAlign:(id _Nullable)value {
  if (![value isKindOfClass:[NSString class]]) return YGAlignStretch;
  NSString *str = (NSString *)value;
  if ([str isEqualToString:@"flex-start"]) return YGAlignFlexStart;
  if ([str isEqualToString:@"flex-end"]) return YGAlignFlexEnd;
  if ([str isEqualToString:@"center"]) return YGAlignCenter;
  if ([str isEqualToString:@"baseline"]) return YGAlignBaseline;
  if ([str isEqualToString:@"space-between"]) return YGAlignSpaceBetween;
  if ([str isEqualToString:@"space-around"]) return YGAlignSpaceAround;
  if ([str isEqualToString:@"stretch"]) return YGAlignStretch;
  return YGAlignStretch;
}

@end
