#import "SNUIManager.h"
#import "SNHexColor.h"
#import <Yoga/Yoga.h>
#import <QuartzCore/QuartzCore.h>
#import <JavaScriptCore/JavaScriptCore.h>

#if __has_include(<RuneKit/RuneKit-Swift.h>)
#import <RuneKit/RuneKit-Swift.h>
#elif __has_include("RuneKit-Swift.h")
#import "RuneKit-Swift.h"
#endif

@interface SNNode : NSObject
@property(nonatomic, assign) int nid;
@property(nonatomic, strong) UIView *view;
@property(nonatomic, assign) YGNodeRef yoga;
@property(nonatomic, strong) NSMutableArray<NSNumber *> *children;
@property(nonatomic, strong) JSValue *onPressCallback;
@property(nonatomic, assign) BOOL hasOnPressHandler;
@property(nonatomic, assign) int parentId;
@end

@implementation SNNode

- (void)dealloc {
  if (_yoga) {
    NSLog(@"[SN] deallocating SNNode nid=%d, freeing yoga node", _nid);
    // Ensure we're on the main queue when freeing Yoga nodes to avoid race conditions
    if ([NSThread isMainThread]) {
      YGNodeFree(_yoga);
    } else {
      YGNodeRef yogaToFree = _yoga;
      dispatch_async(dispatch_get_main_queue(), ^{
        YGNodeFree(yogaToFree);
      });
    }
    _yoga = NULL;
  }
}

@end

@interface SNUIManager ()
@property(nonatomic, strong) UIView *root;
@property(nonatomic, strong) NSMutableDictionary<NSNumber *, SNNode *> *nodes;
@property(nonatomic, assign) int nextId;
@property(nonatomic, assign) YGNodeRef rootYoga;
@property(nonatomic, strong) CADisplayLink *displayLink;
@property(nonatomic, assign) BOOL needsFlush;
@end

@implementation SNUIManager

- (void)dealloc {
  [self sn_stopDisplayLink];
  if (_rootYoga) {
    YGNodeFreeRecursive(_rootYoga);
    _rootYoga = NULL;
  }
}

- (instancetype)initWithRootView:(UIView *)rootView {
  if (self = [super init]) {
    _root = rootView;
    _nodes = [NSMutableDictionary new];
    _nextId = 1;
    _rootYoga = YGNodeNew();

    // Prepare root surface - ensure it fills the entire screen
    CGRect screenBounds = [UIScreen mainScreen].bounds;
    rootView.frame = screenBounds;
    rootView.backgroundColor = [UIColor colorWithRed:0.06 green:0.07 blue:0.09 alpha:1.0];
  }
  return self;
}

#pragma mark - Flush scheduling

- (void)sn_startDisplayLinkIfNeeded {
  if (self.displayLink) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.displayLink) return;
    self.displayLink = [CADisplayLink displayLinkWithTarget:self selector:@selector(sn_displayLinkTick:)];
    [self.displayLink addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
  });
}

- (void)sn_stopDisplayLink {
  if (self.displayLink) {
    [self.displayLink invalidate];
    self.displayLink = nil;
  }
}

- (void)sn_refreshTextForLabelNode:(SNNode *)node {
  if (!node || ![node.view isKindOfClass:[UILabel class]]) return;
  if (!node.children.count) {
    ((UILabel *)node.view).text = @"";
    if (node.yoga) YGNodeMarkDirty(node.yoga);
    return;
  }

  NSMutableString *composed = [NSMutableString string];
  for (NSNumber *childId in node.children) {
    SNNode *child = _nodes[childId];
    if (!child || ![child.view isKindOfClass:[UILabel class]]) continue;
    NSString *childText = ((UILabel *)child.view).text ?: @"";
    [composed appendString:childText];
  }

  ((UILabel *)node.view).text = composed;
  if (node.yoga) YGNodeMarkDirty(node.yoga);
}

- (void)sn_propagateTextChangeFromNode:(SNNode *)node {
  if (!node) return;

  int currentParentId = node.parentId;
  while (currentParentId > 0) {
    SNNode *parent = _nodes[@(currentParentId)];
    if (!parent || ![parent.view isKindOfClass:[UILabel class]]) break;

    [self sn_refreshTextForLabelNode:parent];
    currentParentId = parent.parentId;
  }
}

- (void)sn_markNeedsFlush {
  dispatch_async(dispatch_get_main_queue(), ^{
    self.needsFlush = YES;
    [self sn_startDisplayLinkIfNeeded];
  });
}

- (void)sn_displayLinkTick:(CADisplayLink *)link {
  if (!self.needsFlush) return;
  self.needsFlush = NO;
  [self sn_performFlush];
}

- (NSNumber *)createNode:(NSString *)type {
  int nid = _nextId++;
  UIView *v;
  if ([type isEqualToString:@"text"]) {
    UILabel *l = [UILabel new];
    l.textColor = [UIColor whiteColor];
    l.numberOfLines = 0;
    v = l;
  } else {
    v = [UIView new];
  }
  v.userInteractionEnabled = YES;

  SNNode *n = [SNNode new];
  n.nid = nid;
  n.view = v;
  n.yoga = YGNodeNew();
  n.children = [NSMutableArray new];
  n.parentId = -1;

  // Safety check for Yoga node creation
  if (!n.yoga) {
    NSLog(@"[SN] ERROR: Failed to create Yoga node for nid=%d", nid);
    return @(nid);
  }

  // Defaults
  YGNodeStyleSetFlexDirection(n.yoga, YGFlexDirectionColumn);

  // Attach text measurement for UILabel-backed nodes
  if ([v isKindOfClass:[UILabel class]]) {
    YGNodeSetContext(n.yoga, (__bridge void *)v);
    YGNodeSetMeasureFunc(n.yoga, SNMeasureLabelFunc);
  }

  _nodes[@(nid)] = n;
  NSLog(@"[SN] createNode type=%@ nid=%d", type, nid);
  return @(nid);
}

static CGFloat SNNum(id x) { return x ? [x doubleValue] : NAN; }

static YGSize SNMeasureLabelFunc(YGNodeConstRef node,
                                 float width,
                                 YGMeasureMode widthMode,
                                 float height,
                                 YGMeasureMode heightMode) {
  UILabel *label = (__bridge UILabel *)YGNodeGetContext(node);
  if (![label isKindOfClass:[UILabel class]]) {
    return (YGSize){.width = 0, .height = 0};
  }
  CGFloat maxW;
  switch (widthMode) {
    case YGMeasureModeExactly: maxW = width; break;
    case YGMeasureModeAtMost: maxW = width; break;
    case YGMeasureModeUndefined: default: maxW = CGFLOAT_MAX; break;
  }
  CGSize fit = [label sizeThatFits:CGSizeMake(maxW, CGFLOAT_MAX)];
  float outW;
  switch (widthMode) {
    case YGMeasureModeExactly: outW = width; break;
    case YGMeasureModeAtMost: outW = MIN(width, fit.width); break;
    case YGMeasureModeUndefined: default: outW = fit.width; break;
  }
  float outH;
  switch (heightMode) {
    case YGMeasureModeExactly: outH = height; break;
    case YGMeasureModeAtMost: outH = MIN(height, fit.height); break;
    case YGMeasureModeUndefined: default: outH = fit.height; break;
  }
  return (YGSize){.width = outW, .height = outH};
}

static void SNApplyEdges(NSDictionary *style,
                        NSString *baseKey,
                        NSString *horizontalKey,
                        NSString *verticalKey,
                        NSString *topKey,
                        NSString *rightKey,
                        NSString *bottomKey,
                        YGNodeRef yoga,
                        void (^setter)(YGEdge edge, float value)) {
  NSNumber *base = style[baseKey];
  NSNumber *horizontal = style[horizontalKey];
  NSNumber *vertical = style[verticalKey];
  NSNumber *top = style[topKey];
  NSNumber *right = style[rightKey];
  NSNumber *bottom = style[bottomKey];

  NSNumber *T = top ?: vertical ?: base;
  NSNumber *R = right ?: horizontal ?: base;
  NSNumber *B = bottom ?: vertical ?: base;
  NSNumber *L = horizontal ?: base;

  if (T) setter(YGEdgeTop, (float)SNNum(T));
  if (R) setter(YGEdgeRight, (float)SNNum(R));
  if (B) setter(YGEdgeBottom, (float)SNNum(B));
  if (L) setter(YGEdgeLeft, (float)SNNum(L));
}

- (void)sn_applyStyleDictionary:(NSDictionary *)style toNode:(SNNode *)n {
  if (!style || !n || !n.view) return;
  if (![style isKindOfClass:[NSDictionary class]] || !n.yoga) return;

  // Sizes
  NSNumber *w = style[@"width"]; if (w) YGNodeStyleSetWidth(n.yoga, (float)SNNum(w));
  NSNumber *h = style[@"height"]; if (h) YGNodeStyleSetHeight(n.yoga, (float)SNNum(h));

  // Flex
  NSNumber *flex = style[@"flex"]; if (flex) YGNodeStyleSetFlex(n.yoga, (float)SNNum(flex));
  NSString *fd = style[@"flexDirection"];
  if (fd) YGNodeStyleSetFlexDirection(n.yoga, [fd isEqualToString:@"row"] ? YGFlexDirectionRow : YGFlexDirectionColumn);

  NSString *jc = style[@"justifyContent"];
  if (jc) {
    YGJustify j = YGJustifyFlexStart;
    if ([jc isEqualToString:@"center"]) j = YGJustifyCenter;
    else if ([jc isEqualToString:@"flex-end"]) j = YGJustifyFlexEnd;
    else if ([jc isEqualToString:@"space-between"]) j = YGJustifySpaceBetween;
    else if ([jc isEqualToString:@"space-around"]) j = YGJustifySpaceAround;
    YGNodeStyleSetJustifyContent(n.yoga, j);
  }

  NSString *ai = style[@"alignItems"];
  if (ai) {
    YGAlign a = YGAlignFlexStart;
    if ([ai isEqualToString:@"center"]) a = YGAlignCenter;
    else if ([ai isEqualToString:@"flex-end"]) a = YGAlignFlexEnd;
    else if ([ai isEqualToString:@"stretch"]) a = YGAlignStretch;
    YGNodeStyleSetAlignItems(n.yoga, a);
  }

  SNApplyEdges(style, @"padding", @"paddingHorizontal", @"paddingVertical", @"paddingTop", @"paddingRight", @"paddingBottom", n.yoga,
               ^(YGEdge e, float v){ YGNodeStyleSetPadding(n.yoga, e, v); });

  SNApplyEdges(style, @"margin", @"marginHorizontal", @"marginVertical", @"marginTop", @"marginRight", @"marginBottom", n.yoga,
               ^(YGEdge e, float v){ YGNodeStyleSetMargin(n.yoga, e, v); });

  // View styling
  NSString *bg = style[@"backgroundColor"]; if (bg) { n.view.backgroundColor = SNColorFromHex(bg); }
  NSNumber *br = style[@"borderRadius"];
  if (br) { n.view.layer.cornerRadius = (CGFloat)SNNum(br); n.view.clipsToBounds = YES; }

  // Text styling
  if ([n.view isKindOfClass:[UILabel class]]) {
    UILabel *l = (UILabel *)n.view;
    NSNumber *fs = style[@"fontSize"]; if (fs) l.font = [UIFont systemFontOfSize:(CGFloat)SNNum(fs) weight:UIFontWeightRegular];
    NSString *fw = style[@"fontWeight"];
    if (fw) {
      NSDictionary *m = @{@"normal":@(UIFontWeightRegular),@"bold":@(UIFontWeightBold),
                           @"100":@(UIFontWeightUltraLight),@"200":@(UIFontWeightThin),@"300":@(UIFontWeightLight),@"400":@(UIFontWeightRegular),
                           @"500":@(UIFontWeightMedium),@"600":@(UIFontWeightSemibold),@"700":@(UIFontWeightBold),@"800":@(UIFontWeightHeavy),@"900":@(UIFontWeightBlack)};
      l.font = [UIFont systemFontOfSize:l.font.pointSize weight:[m[fw] doubleValue]];
    }
    NSString *color = style[@"color"]; if (color) l.textColor = SNColorFromHex(color);
    if (n.yoga) YGNodeMarkDirty(n.yoga);
  }
}

- (void)setProp:(NSNumber *)nodeId name:(NSString *)name valueJSON:(NSString *)json {
  SNNode *n = _nodes[nodeId]; 
  if (!n || !n.view) return;

  if ([name isEqualToString:@"style"]) {
    NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *s = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    [self sn_applyStyleDictionary:s toNode:n];
    [self sn_markNeedsFlush];
    return;
  }
}

- (void)setStyle:(NSNumber *)nodeId style:(NSDictionary *)style {
  SNNode *n = _nodes[nodeId];
  if (!n || !n.view) return;
  [self sn_applyStyleDictionary:style toNode:n];
  [self sn_markNeedsFlush];
}


- (void)sn_attachTapRecognizerForNode:(SNNode *)node {
  if (!node || !node.view) return;

  for (UIGestureRecognizer *gr in node.view.gestureRecognizers.copy) {
    if ([gr isKindOfClass:[UITapGestureRecognizer class]]) {
      [node.view removeGestureRecognizer:gr];
    }
  }

  UITapGestureRecognizer *tap = [[UITapGestureRecognizer alloc] initWithTarget:self action:@selector(_handleTap:)];
  tap.name = [NSString stringWithFormat:@"node:%d", node.nid];
  [node.view addGestureRecognizer:tap];
  node.hasOnPressHandler = YES;
  NSLog(@"[SN] onPress handler attached nid=%d", node.nid);
}

- (void)setPropCallback:(NSNumber *)nodeId name:(NSString *)name callback:(JSValue *)callback {
  SNNode *n = _nodes[nodeId];
  if (!n || !n.view) return;
  
  if ([name isEqualToString:@"onPress"]) {
    BOOL validCallback = callback && ![callback isUndefined] && ![callback isNull];
    if (validCallback) {
      n.onPressCallback = callback;
      n.hasOnPressHandler = YES;
      [self sn_attachTapRecognizerForNode:n];
    } else {
      // Treat as removing the handler
      n.onPressCallback = nil;
      n.hasOnPressHandler = NO;
      for (UIGestureRecognizer *gr in n.view.gestureRecognizers.copy) {
        if ([gr isKindOfClass:[UITapGestureRecognizer class]]) {
          [n.view removeGestureRecognizer:gr];
        }
      }
    }
  }
}

- (void)setHandler:(NSNumber *)nodeId name:(NSString *)name {
  SNNode *n = _nodes[nodeId];
  if (!n || !n.view) return;

  if ([name isEqualToString:@"onPress"]) {
    // JSI handler path: prefer native invocation; clear JS callback
    n.onPressCallback = nil;
    n.hasOnPressHandler = YES;
    [self sn_attachTapRecognizerForNode:n];
  }
}


- (void)_handleTap:(UIGestureRecognizer *)gr {
  if (![gr isKindOfClass:[UITapGestureRecognizer class]]) return;
  NSString *name = gr.name; if (![name hasPrefix:@"node:"]) return;

  NSString *nodeIdStr = [name substringFromIndex:5];
  NSNumber *nodeId = @([nodeIdStr intValue]);

  NSLog(@"[SN] Tapped node %@", nodeId);

  SNNode *node = self.nodes[nodeId];
  if (!node) {
    NSLog(@"[SN] No node found for tap %@", nodeId);
    return;
  }

  BOOL invoked = NO;
  if (node.hasOnPressHandler && self.jsInvoker) {
    [self.jsInvoker invokeHandlerForNode:node.nid name:@"onPress"];
    invoked = YES;
  }

  if (!invoked && node.onPressCallback && ![node.onPressCallback isUndefined]) {
    NSLog(@"[SN] Executing onPress JavaScript callback for node %@", nodeId);
    [node.onPressCallback callWithArguments:@[]];
    invoked = YES;
  }

  if (!invoked) {
    NSLog(@"[SN] No tap handler registered for node %@", nodeId);
  }
}

- (void)setText:(NSNumber *)nodeId text:(NSString *)text {
  SNNode *n = _nodes[nodeId];
  if (!n || !n.view) return;

  if ([n.view isKindOfClass:[UILabel class]]) {
    ((UILabel *)n.view).text = text;
    if (n.yoga) YGNodeMarkDirty(n.yoga);
    [self sn_propagateTextChangeFromNode:n];
  }
  [self sn_markNeedsFlush];
}

- (void)insertChild:(NSNumber *)parentId child:(NSNumber *)childId index:(NSNumber *)index {
  SNNode *c = _nodes[childId];
  if (!c || !c.view || !c.yoga) return;
  
  if (parentId.intValue == 0) {
    // Attach to root surface directly
    if (!self.rootYoga || !self.root) return;

    int i = (int)index.intValue;
    i = MAX(0, MIN(i, (int)self.root.subviews.count));
    [self.root insertSubview:c.view atIndex:i];
    // Link Yoga under persistent root
    YGNodeInsertChild(self.rootYoga, c.yoga, (uint32_t)MIN(i, (int)YGNodeGetChildCount(self.rootYoga)));
    NSLog(@"[SN] insert root->%d at %d (rootSubviews=%lu)", c.nid, i, (unsigned long)self.root.subviews.count);
    c.parentId = 0;
  } else {
    SNNode *p = _nodes[parentId];
    if (!p || !p.view || !p.yoga) return;
    c.parentId = p.nid;

    // If parent is a UILabel, merge text instead of nesting subviews
    if ([p.view isKindOfClass:[UILabel class]]) {
      // Maintain logical child order so text composition is deterministic
      NSUInteger existingIdx = [p.children indexOfObject:childId];
      if (existingIdx != NSNotFound) {
        [p.children removeObjectAtIndex:existingIdx];
      }
      NSUInteger insertIdx = MIN((NSUInteger)index.unsignedIntegerValue, p.children.count);
      [p.children insertObject:childId atIndex:insertIdx];

      if ([c.view isKindOfClass:[UILabel class]]) {
        NSLog(@"[SN] merge text %d->%d", p.nid, c.nid);
      }

      [self sn_refreshTextForLabelNode:p];
      [self sn_propagateTextChangeFromNode:p];
      [self sn_markNeedsFlush];
      return;
    }
    int i = (int)index.intValue;
    i = MAX(0, MIN(i, (int)p.view.subviews.count));
    [p.view insertSubview:c.view atIndex:i];
    [p.children insertObject:childId atIndex:i];
    // Link Yoga nodes
    YGNodeInsertChild(p.yoga, c.yoga, (uint32_t)i);
    NSLog(@"[SN] insert %d->%d at %d (children=%lu)", p.nid, c.nid, i, (unsigned long)p.view.subviews.count);
  }
  [self sn_markNeedsFlush];
}

- (void)removeChild:(NSNumber *)parentId child:(NSNumber *)childId {
  SNNode *c = _nodes[childId];
  if (!c || !c.view) return;
  // Clean up gesture recognizers and JS callback flags to avoid stacking
  for (UIGestureRecognizer *gr in c.view.gestureRecognizers.copy) {
    [c.view removeGestureRecognizer:gr];
  }
  c.onPressCallback = nil;
  c.hasOnPressHandler = NO;

  if (parentId.intValue == 0) {
    [c.view removeFromSuperview];
    if (self.rootYoga && c.yoga) {
      YGNodeRemoveChild(self.rootYoga, c.yoga);
    }
    c.parentId = -1;
  } else {
    SNNode *p = _nodes[parentId];
    if (!p || !p.yoga) return;

    if ([p.view isKindOfClass:[UILabel class]]) {
      NSUInteger idx = [p.children indexOfObject:childId];
      if (idx != NSNotFound) {
        [p.children removeObjectAtIndex:idx];
      }
      c.parentId = -1;
      [self sn_refreshTextForLabelNode:p];
      [self sn_propagateTextChangeFromNode:p];
      [self sn_markNeedsFlush];
      return;
    }

    [c.view removeFromSuperview];
    NSUInteger idx = [p.children indexOfObject:childId];
    if (idx != NSNotFound) [p.children removeObjectAtIndex:idx];

    if (c.yoga) {
      YGNodeRemoveChild(p.yoga, c.yoga);
    }
    c.parentId = -1;
  }
  [self sn_markNeedsFlush];
}

- (void)sn_performFlush {
  [[PerformanceProfiler shared] recordLayoutStart];
  dispatch_async(dispatch_get_main_queue(), ^{
    // Add safety checks
    if (!self.rootYoga || !self.root || !self.nodes) {
      NSLog(@"[SN] flush skipped: invalid state");
      return;
    }
    
    NSLog(@"[SN] flush start: rootSubviews=%lu", (unsigned long)self.root.subviews.count);
    
    // Size the persistent root and compute layout
    CGRect screenBounds = [UIScreen mainScreen].bounds;
    YGNodeStyleSetWidth(self.rootYoga, (float)screenBounds.size.width);
    YGNodeStyleSetHeight(self.rootYoga, (float)screenBounds.size.height);

      // Force first child to fill root if needed (fixes 'card' effect)
      if (YGNodeGetChildCount(self.rootYoga) > 0) {
        YGNodeRef firstChild = YGNodeGetChild(self.rootYoga, 0);
        YGNodeStyleSetWidth(firstChild, (float)screenBounds.size.width);
        YGNodeStyleSetHeight(firstChild, (float)screenBounds.size.height);
      }
    
    @try {
      YGNodeCalculateLayout(self.rootYoga, YGUndefined, YGUndefined, YGDirectionLTR);
    }
    @catch (NSException *exception) {
      NSLog(@"[SN] Exception in YGNodeCalculateLayout: %@", exception);
      [[PerformanceProfiler shared] recordLayoutEnd];
      return;
    }
    [[PerformanceProfiler shared] recordLayoutEnd];

    [[PerformanceProfiler shared] recordRenderStart];
    // Use a simpler approach: iterate through our nodes and apply frames directly
    // This avoids the complex recursive traversal that might be accessing freed nodes
    [self.nodes enumerateKeysAndObjectsUsingBlock:^(NSNumber *key, SNNode *obj, BOOL *stop) {
      if (!obj || !obj.view || !obj.yoga) {
        NSLog(@"[SN] skipping invalid node nid=%@", key);
        return;
      }
      
      // Double-check that the view is still in the hierarchy
      if (!obj.view.superview && obj.view != self.root.subviews.firstObject) {
        NSLog(@"[SN] skipping detached view nid=%d", obj.nid);
        return;
      }
      
      @try {
        // Get layout values with safety checks
        CGFloat x = YGNodeLayoutGetLeft(obj.yoga);
        CGFloat y = YGNodeLayoutGetTop(obj.yoga);
        CGFloat w = YGNodeLayoutGetWidth(obj.yoga);
        CGFloat h = YGNodeLayoutGetHeight(obj.yoga);
        
        // Validate the frame values
        if (isnan(x) || isnan(y) || isnan(w) || isnan(h) || 
            isinf(x) || isinf(y) || isinf(w) || isinf(h) ||
            w < 0 || h < 0) {
          NSLog(@"[SN] invalid frame values for nid=%d: {{%.1f,%.1f},{%.1f,%.1f}}", obj.nid, x, y, w, h);
          return;
        }
        
        // Apply the frame
        obj.view.frame = CGRectMake(x, y, w, h);
        NSLog(@"[SN] applied frame nid=%d frame={{%.1f,%.1f},{%.1f,%.1f}}", obj.nid, x, y, w, h);
      }
      @catch (NSException *exception) {
        NSLog(@"[SN] Exception applying frame for nid=%d: %@", obj.nid, exception);
      }
    }];
    [[PerformanceProfiler shared] recordRenderEnd];

    NSLog(@"[SN] flush end");
  });
}

- (void)flush {
  // Public API called from JS bridge; schedule at most once per frame
  [self sn_markNeedsFlush];
}

@end
