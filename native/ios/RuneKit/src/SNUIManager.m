#import "SNUIManager.h"
#import "SNHexColor.h"
#import <Yoga/Yoga.h>
#import <JavaScriptCore/JavaScriptCore.h>

@interface SNNode : NSObject
@property(nonatomic, assign) int nid;
@property(nonatomic, strong) UIView *view;
@property(nonatomic, assign) YGNodeRef yoga;
@property(nonatomic, strong) NSMutableArray<NSNumber *> *children;
@property(nonatomic, strong) JSValue *onPressCallback;
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
@end

@implementation SNUIManager

- (void)dealloc {
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

static YGSize SNMeasureLabelFunc(YGNodeRef node,
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

- (void)setProp:(NSNumber *)nodeId name:(NSString *)name valueJSON:(NSString *)json {
  SNNode *n = _nodes[nodeId]; 
  if (!n || !n.view) return;

  if ([name isEqualToString:@"style"]) {
    NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *s = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (![s isKindOfClass:[NSDictionary class]] || !n.yoga) return;

    // Sizes
    NSNumber *w = s[@"width"]; if (w) YGNodeStyleSetWidth(n.yoga, (float)SNNum(w));
    NSNumber *h = s[@"height"]; if (h) YGNodeStyleSetHeight(n.yoga, (float)SNNum(h));

    // Flex
    NSNumber *flex = s[@"flex"]; if (flex) YGNodeStyleSetFlex(n.yoga, (float)SNNum(flex));
    NSString *fd = s[@"flexDirection"];
    if (fd) YGNodeStyleSetFlexDirection(n.yoga, [fd isEqualToString:@"row"] ? YGFlexDirectionRow : YGFlexDirectionColumn);

    NSString *jc = s[@"justifyContent"];
    if (jc) {
      YGJustify j = YGJustifyFlexStart;
      if ([jc isEqualToString:@"center"]) j = YGJustifyCenter;
      else if ([jc isEqualToString:@"flex-end"]) j = YGJustifyFlexEnd;
      else if ([jc isEqualToString:@"space-between"]) j = YGJustifySpaceBetween;
      else if ([jc isEqualToString:@"space-around"]) j = YGJustifySpaceAround;
      YGNodeStyleSetJustifyContent(n.yoga, j);
    }

    NSString *ai = s[@"alignItems"];
    if (ai) {
      YGAlign a = YGAlignFlexStart;
      if ([ai isEqualToString:@"center"]) a = YGAlignCenter;
      else if ([ai isEqualToString:@"flex-end"]) a = YGAlignFlexEnd;
      else if ([ai isEqualToString:@"stretch"]) a = YGAlignStretch;
      YGNodeStyleSetAlignItems(n.yoga, a);
    }

    // Padding / Margin helpers
    void (^edges)(NSNumber*, NSNumber*, NSNumber*, NSNumber*, NSNumber*, NSNumber*, void(^)(YGEdge,float)) =
    ^(NSNumber *base, NSNumber *horiz, NSNumber *vert, NSNumber *t, NSNumber *r, NSNumber *b, void(^setter)(YGEdge,float)) {
      NSNumber *T = t ?: vert ?: base;
      NSNumber *R = r ?: horiz ?: base;
      NSNumber *B = b ?: vert ?: base;
      NSNumber *L = horiz ?: base;
      if (T) setter(YGEdgeTop, (float)SNNum(T));
      if (R) setter(YGEdgeRight, (float)SNNum(R));
      if (B) setter(YGEdgeBottom, (float)SNNum(B));
      if (L) setter(YGEdgeLeft, (float)SNNum(L));
    };

    edges(s[@"padding"], s[@"paddingHorizontal"], s[@"paddingVertical"], s[@"paddingTop"], s[@"paddingRight"], s[@"paddingBottom"],
          ^(YGEdge e, float v){ YGNodeStyleSetPadding(n.yoga, e, v); });

    edges(s[@"margin"], s[@"marginHorizontal"], s[@"marginVertical"], s[@"marginTop"], s[@"marginRight"], s[@"marginBottom"],
          ^(YGEdge e, float v){ YGNodeStyleSetMargin(n.yoga, e, v); });

    // View styling
    NSString *bg = s[@"backgroundColor"]; if (bg) { n.view.backgroundColor = SNColorFromHex(bg); NSLog(@"[SN] set bg nid=%d color=%@", n.nid, bg); }
    NSNumber *br = s[@"borderRadius"];
    if (br) { n.view.layer.cornerRadius = (CGFloat)SNNum(br); n.view.clipsToBounds = YES; }

    // Text styling
    if ([n.view isKindOfClass:[UILabel class]]) {
      UILabel *l = (UILabel *)n.view;
      NSNumber *fs = s[@"fontSize"]; if (fs) l.font = [UIFont systemFontOfSize:(CGFloat)SNNum(fs) weight:UIFontWeightRegular];
      NSString *fw = s[@"fontWeight"];
      if (fw) {
        NSDictionary *m = @{@"normal":@(UIFontWeightRegular),@"bold":@(UIFontWeightBold),
                             @"100":@(UIFontWeightUltraLight),@"200":@(UIFontWeightThin),@"300":@(UIFontWeightLight),@"400":@(UIFontWeightRegular),
                             @"500":@(UIFontWeightMedium),@"600":@(UIFontWeightSemibold),@"700":@(UIFontWeightBold),@"800":@(UIFontWeightHeavy),@"900":@(UIFontWeightBlack)};
        l.font = [UIFont systemFontOfSize:l.font.pointSize weight:[m[fw] doubleValue]];
      }
      NSString *color = s[@"color"]; if (color) l.textColor = SNColorFromHex(color);
      if (n.yoga) YGNodeMarkDirty(n.yoga);
    }

  }
}

- (void)setPropCallback:(NSNumber *)nodeId name:(NSString *)name callback:(JSValue *)callback {
  SNNode *n = _nodes[nodeId];
  if (!n || !n.view) return;
  
  if ([name isEqualToString:@"onPress"]) {
    // Store the JavaScript callback
    n.onPressCallback = callback;
    
    // Remove existing tap gesture recognizers
    for (UIGestureRecognizer *gr in n.view.gestureRecognizers.copy) {
      if ([gr isKindOfClass:[UITapGestureRecognizer class]]) [n.view removeGestureRecognizer:gr];
    }
    
    // Add new tap gesture recognizer
    UITapGestureRecognizer *tap = [[UITapGestureRecognizer alloc] initWithTarget:self action:@selector(_handleTap:)];
    tap.name = [NSString stringWithFormat:@"node:%d", n.nid];
    [n.view addGestureRecognizer:tap];
    NSLog(@"[SN] onPress callback stored and gesture attached nid=%d", n.nid);
  }
}

- (void)_handleTap:(UIGestureRecognizer *)gr {
  if (![gr isKindOfClass:[UITapGestureRecognizer class]]) return;
  NSString *name = gr.name; if (![name hasPrefix:@"node:"]) return;
  
  // Extract node ID from gesture recognizer name
  NSString *nodeIdStr = [name substringFromIndex:5]; // Remove "node:" prefix
  NSNumber *nodeId = @([nodeIdStr intValue]);
  
  NSLog(@"[SN] Tapped node %@", nodeId);
  
  // Find the node and trigger its JavaScript callback
  SNNode *node = self.nodes[nodeId];
  if (node && node.onPressCallback && ![node.onPressCallback isUndefined]) {
    NSLog(@"[SN] Executing onPress JavaScript callback for node %@", nodeId);
    [node.onPressCallback callWithArguments:@[]];
  } else {
    NSLog(@"[SN] No JavaScript callback found for node %@", nodeId);
  }
}

- (void)setText:(NSNumber *)nodeId text:(NSString *)text {
  SNNode *n = _nodes[nodeId];
  if (!n || !n.view) return;
  
  if ([n.view isKindOfClass:[UILabel class]]) {
    ((UILabel *)n.view).text = text;
    if (n.yoga) YGNodeMarkDirty(n.yoga);
  }
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
  } else {
    SNNode *p = _nodes[parentId];
    if (!p || !p.view || !p.yoga) return;
    
    // If parent is a UILabel, merge text instead of nesting subviews
    if ([p.view isKindOfClass:[UILabel class]]) {
      if ([c.view isKindOfClass:[UILabel class]]) {
        ((UILabel *)p.view).text = ((UILabel *)c.view).text ?: @"";
        if (p.yoga) YGNodeMarkDirty(p.yoga);
        NSLog(@"[SN] merge text %d->%d", p.nid, c.nid);
      }
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
}

- (void)removeChild:(NSNumber *)parentId child:(NSNumber *)childId {
  SNNode *c = _nodes[childId];
  if (!c || !c.view) return;
  
  if (parentId.intValue == 0) {
    [c.view removeFromSuperview];
    if (self.rootYoga && c.yoga) {
      YGNodeRemoveChild(self.rootYoga, c.yoga);
    }
  } else {
    SNNode *p = _nodes[parentId];
    if (!p || !p.yoga) return;
    
    [c.view removeFromSuperview];
    NSUInteger idx = [p.children indexOfObject:childId];
    if (idx != NSNotFound) [p.children removeObjectAtIndex:idx];
    
    if (c.yoga) {
      YGNodeRemoveChild(p.yoga, c.yoga);
    }
  }
}

- (void)flush {
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
      return;
    }

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

    NSLog(@"[SN] flush end");
  });
}

@end
