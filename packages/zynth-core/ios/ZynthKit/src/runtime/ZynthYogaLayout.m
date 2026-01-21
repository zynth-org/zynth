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
  NSLog(@"[ZynthYoga] measure text '%@' => %.1fx%.1f", label.text, size.width, size.height);
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

- (void)createNodeWithId:(NSNumber *)nodeId type:(NSString *)type view:(UIView *)view {
  if (!nodeId || !view) return;
  YGNodeRef node = YGNodeNew();
  YGNodeStyleSetFlexDirection(node, YGFlexDirectionColumn);
  YGNodeStyleSetAlignItems(node, YGAlignStretch);
  YGNodeSetContext(node, (__bridge void *)view);
  if ([view isKindOfClass:[UILabel class]]) {
    YGNodeSetMeasureFunc(node, ZynthMeasureText);
  }
  _nodes[nodeId] = [NSValue valueWithPointer:node];
}

- (YGNodeRef)yogaForNode:(NSNumber *)nodeId {
  NSValue *value = _nodes[nodeId];
  return value ? (YGNodeRef)value.pointerValue : NULL;
}

- (void)setStyle:(NSNumber *)nodeId name:(NSString *)name value:(NSString *_Nullable)value {
  YGNodeRef node = [self yogaForNode:nodeId];
  if (!node || name.length == 0) return;
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
    if (value.length > 0) YGNodeStyleSetFlex(node, (float)[value doubleValue]);
    return;
  }
  if ([name isEqualToString:@"flexGrow"]) {
    if (value.length > 0) YGNodeStyleSetFlexGrow(node, (float)[value doubleValue]);
    return;
  }
  if ([name isEqualToString:@"flexShrink"]) {
    if (value.length > 0) YGNodeStyleSetFlexShrink(node, (float)[value doubleValue]);
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
    if ([value isEqualToString:@"row"]) {
      YGNodeStyleSetFlexDirection(node, YGFlexDirectionRow);
    } else if ([value isEqualToString:@"column-reverse"]) {
      YGNodeStyleSetFlexDirection(node, YGFlexDirectionColumnReverse);
    } else if ([value isEqualToString:@"row-reverse"]) {
      YGNodeStyleSetFlexDirection(node, YGFlexDirectionRowReverse);
    } else {
      YGNodeStyleSetFlexDirection(node, YGFlexDirectionColumn);
    }
    return;
  }
  if ([name isEqualToString:@"flexWrap"]) {
    if ([value isEqualToString:@"wrap"]) {
      YGNodeStyleSetFlexWrap(node, YGWrapWrap);
    } else if ([value isEqualToString:@"wrap-reverse"]) {
      YGNodeStyleSetFlexWrap(node, YGWrapWrapReverse);
    } else {
      YGNodeStyleSetFlexWrap(node, YGWrapNoWrap);
    }
    return;
  }
  if ([name isEqualToString:@"justifyContent"]) {
    YGJustify j = YGJustifyFlexStart;
    if ([value isEqualToString:@"flex-end"]) j = YGJustifyFlexEnd;
    else if ([value isEqualToString:@"center"]) j = YGJustifyCenter;
    else if ([value isEqualToString:@"space-between"]) j = YGJustifySpaceBetween;
    else if ([value isEqualToString:@"space-around"]) j = YGJustifySpaceAround;
    else if ([value isEqualToString:@"space-evenly"]) j = YGJustifySpaceEvenly;
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
    if ([value isEqualToString:@"absolute"]) {
      YGNodeStyleSetPositionType(node, YGPositionTypeAbsolute);
    } else {
      YGNodeStyleSetPositionType(node, YGPositionTypeRelative);
    }
    return;
  }
  if ([name isEqualToString:@"top"]) {
    if (value.length > 0) YGNodeStyleSetPosition(node, YGEdgeTop, (float)[value doubleValue]);
    return;
  }
  if ([name isEqualToString:@"right"]) {
    if (value.length > 0) YGNodeStyleSetPosition(node, YGEdgeRight, (float)[value doubleValue]);
    return;
  }
  if ([name isEqualToString:@"bottom"]) {
    if (value.length > 0) YGNodeStyleSetPosition(node, YGEdgeBottom, (float)[value doubleValue]);
    return;
  }
  if ([name isEqualToString:@"left"]) {
    if (value.length > 0) YGNodeStyleSetPosition(node, YGEdgeLeft, (float)[value doubleValue]);
    return;
  }
  if ([name isEqualToString:@"padding"]) {
    if (value.length > 0) YGNodeStyleSetPadding(node, YGEdgeAll, (float)[value doubleValue]);
    return;
  }
  if ([name isEqualToString:@"paddingHorizontal"]) {
    if (value.length > 0) {
      float v = (float)[value doubleValue];
      YGNodeStyleSetPadding(node, YGEdgeLeft, v);
      YGNodeStyleSetPadding(node, YGEdgeRight, v);
    }
    return;
  }
  if ([name isEqualToString:@"paddingVertical"]) {
    if (value.length > 0) {
      float v = (float)[value doubleValue];
      YGNodeStyleSetPadding(node, YGEdgeTop, v);
      YGNodeStyleSetPadding(node, YGEdgeBottom, v);
    }
    return;
  }
  if ([name isEqualToString:@"paddingTop"]) {
    if (value.length > 0) YGNodeStyleSetPadding(node, YGEdgeTop, (float)[value doubleValue]);
    return;
  }
  if ([name isEqualToString:@"paddingRight"]) {
    if (value.length > 0) YGNodeStyleSetPadding(node, YGEdgeRight, (float)[value doubleValue]);
    return;
  }
  if ([name isEqualToString:@"paddingBottom"]) {
    if (value.length > 0) YGNodeStyleSetPadding(node, YGEdgeBottom, (float)[value doubleValue]);
    return;
  }
  if ([name isEqualToString:@"paddingLeft"]) {
    if (value.length > 0) YGNodeStyleSetPadding(node, YGEdgeLeft, (float)[value doubleValue]);
    return;
  }
  if ([name isEqualToString:@"margin"]) {
    if (value.length > 0) YGNodeStyleSetMargin(node, YGEdgeAll, (float)[value doubleValue]);
    return;
  }
  if ([name isEqualToString:@"marginHorizontal"]) {
    if (value.length > 0) {
      float v = (float)[value doubleValue];
      YGNodeStyleSetMargin(node, YGEdgeLeft, v);
      YGNodeStyleSetMargin(node, YGEdgeRight, v);
    }
    return;
  }
  if ([name isEqualToString:@"marginVertical"]) {
    if (value.length > 0) {
      float v = (float)[value doubleValue];
      YGNodeStyleSetMargin(node, YGEdgeTop, v);
      YGNodeStyleSetMargin(node, YGEdgeBottom, v);
    }
    return;
  }
  if ([name isEqualToString:@"marginTop"]) {
    if (value.length > 0) YGNodeStyleSetMargin(node, YGEdgeTop, (float)[value doubleValue]);
    return;
  }
  if ([name isEqualToString:@"marginRight"]) {
    if (value.length > 0) YGNodeStyleSetMargin(node, YGEdgeRight, (float)[value doubleValue]);
    return;
  }
  if ([name isEqualToString:@"marginBottom"]) {
    if (value.length > 0) YGNodeStyleSetMargin(node, YGEdgeBottom, (float)[value doubleValue]);
    return;
  }
  if ([name isEqualToString:@"marginLeft"]) {
    if (value.length > 0) YGNodeStyleSetMargin(node, YGEdgeLeft, (float)[value doubleValue]);
    return;
  }
  if ([name isEqualToString:@"gap"]) {
    if (value.length > 0) YGNodeStyleSetGap(node, YGGutterAll, (float)[value doubleValue]);
    return;
  }
  if ([name isEqualToString:@"rowGap"]) {
    if (value.length > 0) YGNodeStyleSetGap(node, YGGutterRow, (float)[value doubleValue]);
    return;
  }
  if ([name isEqualToString:@"columnGap"]) {
    if (value.length > 0) YGNodeStyleSetGap(node, YGGutterColumn, (float)[value doubleValue]);
    return;
  }
  if ([name isEqualToString:@"aspectRatio"]) {
    if (value.length > 0) YGNodeStyleSetAspectRatio(node, (float)[value doubleValue]);
    return;
  }
  if ([name isEqualToString:@"overflow"]) {
    if ([value isEqualToString:@"hidden"]) {
      YGNodeStyleSetOverflow(node, YGOverflowHidden);
    } else if ([value isEqualToString:@"scroll"]) {
      YGNodeStyleSetOverflow(node, YGOverflowScroll);
    } else {
      YGNodeStyleSetOverflow(node, YGOverflowVisible);
    }
    return;
  }
  if ([name isEqualToString:@"display"]) {
    if ([value isEqualToString:@"none"]) {
      YGNodeStyleSetDisplay(node, YGDisplayNone);
    } else if ([value isEqualToString:@"flex"]) {
      YGNodeStyleSetDisplay(node, YGDisplayFlex);
    } else {
      YGNodeStyleSetDisplay(node, YGDisplayFlex);
    }
    return;
  }
}

- (void)insertChild:(NSNumber *)parentId child:(NSNumber *)childId index:(NSNumber *)index {
  YGNodeRef child = [self yogaForNode:childId];
  if (!child) return;
  YGNodeRef parent = parentId.intValue == 0 ? _rootNode : [self yogaForNode:parentId];
  if (!parent) return;
  if (YGNodeHasMeasureFunc(parent)) {
    return;
  }
  size_t count = YGNodeGetChildCount(parent);
  int maxIndex = (count > (size_t)INT_MAX) ? INT_MAX : (int)count;
  uint32_t idx = (uint32_t)MAX(0, MIN(index.intValue, maxIndex));
  if (YGNodeGetOwner(child)) {
    YGNodeRef owner = YGNodeGetOwner(child);
    YGNodeRemoveChild(owner, child);
  }
  YGNodeInsertChild(parent, child, idx);
}

- (void)removeChild:(NSNumber *)parentId child:(NSNumber *)childId {
  YGNodeRef child = [self yogaForNode:childId];
  if (!child) return;
  YGNodeRef parent = parentId.intValue == 0 ? _rootNode : [self yogaForNode:parentId];
  if (!parent) return;
  YGNodeRemoveChild(parent, child);
}

- (void)markDirty:(NSNumber *)nodeId {
  YGNodeRef node = [self yogaForNode:nodeId];
  if (!node) return;
  if (!YGNodeHasMeasureFunc(node)) return;
  if (YGNodeGetChildCount(node) != 0) return;
  if (YGNodeGetOwner(node) == NULL) return;
  YGNodeMarkDirty(node);
}

- (void)applyLayout {
  UIView *rootView = _rootView;
  if (!rootView) return;
  __weak typeof(self) weakSelf = self;
  void (^layoutBlock)(void) = ^{
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
    NSLog(@"[ZynthYoga] layout rootSize=%.1fx%.1f", size.width, size.height);
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
      if (!CGPointEqualToPoint(view.center, center) || !CGRectEqualToRect(view.bounds, bounds)) {
        view.center = center;
        view.bounds = bounds;
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
  YGNodeRef node = [self yogaForNode:nodeId];
  if (!node) return nil;
  void *ctx = YGNodeGetContext(node);
  return ctx ? (__bridge UIView *)ctx : nil;
}

- (void)applyDimension:(NSString *_Nullable)value
                  node:(YGNodeRef)node
                   set:(void (^)(float))set
            setPercent:(void (^_Nullable)(float))setPercent
               setAuto:(void (^_Nullable)(void))setAuto {
  if (value.length == 0) return;
  if ([value isEqualToString:@"auto"]) {
    if (setAuto) setAuto();
    return;
  }
  if ([value hasSuffix:@"%"] && setPercent) {
    NSString *trimmed = [value substringToIndex:value.length - 1];
    double percent = [trimmed doubleValue];
    setPercent((float)percent);
    return;
  }
  set((float)[value doubleValue]);
}

- (YGAlign)parseAlign:(NSString *_Nullable)value {
  if ([value isEqualToString:@"flex-start"]) return YGAlignFlexStart;
  if ([value isEqualToString:@"flex-end"]) return YGAlignFlexEnd;
  if ([value isEqualToString:@"center"]) return YGAlignCenter;
  if ([value isEqualToString:@"baseline"]) return YGAlignBaseline;
  if ([value isEqualToString:@"space-between"]) return YGAlignSpaceBetween;
  if ([value isEqualToString:@"space-around"]) return YGAlignSpaceAround;
  if ([value isEqualToString:@"stretch"]) return YGAlignStretch;
  return YGAlignStretch;
}

@end
