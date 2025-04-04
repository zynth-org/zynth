#if __has_include(<RuneKit/RuneKit.h>)
#import <RuneKit/RuneKit.h>
#else
#import "RuneKit.h"
#import "RuneComponentRegistry.h"
#import "RuneComponentAPI.h"
#import "SNUIManager.h"
#import "SNNode.h"
#import "SNHexColor.h"
#endif

#import "RuneTextView.h"
#import <Yoga/Yoga.h>

// Helper function to refresh text for a label node by composing from children
static void RuneTextRefreshLabelNode(SNUIManager *manager, SNNode *node) {
  if (!node || ![node.view isKindOfClass:[RuneTextView class]]) return;

  RuneTextView *textView = (RuneTextView *)node.view;
  
  if (node.children.count == 0) {
    textView.text = @"";
    if (node.yoga && YGNodeGetChildCount(node.yoga) == 0 && YGNodeGetOwner(node.yoga)) {
      YGNodeMarkDirty(node.yoga);
    }
    return;
  }

  NSMutableString *composed = [NSMutableString string];
  for (NSNumber *childId in node.children) {
    SNNode *child = [manager rune_nodeForId:childId];
    if (!child || ![child.view isKindOfClass:[UILabel class]]) continue;
    NSString *childText = ((UILabel *)child.view).text ?: @"";
    [composed appendString:childText];
  }

  textView.text = composed;
  if (node.yoga && YGNodeGetChildCount(node.yoga) == 0 && YGNodeGetOwner(node.yoga)) {
    YGNodeMarkDirty(node.yoga);
  }
}

// Helper function to propagate text changes up the tree
static void RuneTextPropagateChange(SNUIManager *manager, SNNode *node) {
  if (!node) return;

  int parentId = node.parentId;
  while (parentId > 0) {
    SNNode *parent = [manager rune_nodeForId:@(parentId)];
    if (!parent || ![parent.view isKindOfClass:[RuneTextView class]]) break;

    RuneTextRefreshLabelNode(manager, parent);
    parentId = parent.parentId;
  }
}

// Helper function to handle text insertion
static BOOL RuneTextHandleInsertion(SNUIManager *manager,
                                    SNNode *parent,
                                    SNNode *child,
                                    NSNumber *childId,
                                    NSUInteger index) {
  if (!parent || ![parent.view isKindOfClass:[RuneTextView class]]) return NO;

  NSUInteger existing = [parent.children indexOfObject:childId];
  if (existing != NSNotFound) {
    [parent.children removeObjectAtIndex:existing];
  }
  NSUInteger targetIndex = MIN(index, parent.children.count);
  [parent.children insertObject:childId atIndex:targetIndex];

  RuneTextRefreshLabelNode(manager, parent);
  RuneTextPropagateChange(manager, parent);
  [manager rune_markNeedsFlush];
  return YES;
}

// Helper function to handle text removal
static BOOL RuneTextHandleRemoval(SNUIManager *manager,
                                  SNNode *parent,
                                  SNNode *child,
                                  NSNumber *childId) {
  if (!parent || ![parent.view isKindOfClass:[RuneTextView class]]) return NO;

  NSUInteger idx = [parent.children indexOfObject:childId];
  if (idx != NSNotFound) {
    [parent.children removeObjectAtIndex:idx];
  }

  RuneTextRefreshLabelNode(manager, parent);
  RuneTextPropagateChange(manager, parent);
  [manager rune_markNeedsFlush];
  return YES;
}

// Helper function for Yoga measure
static YGSize RuneTextMeasureFunc(YGNodeConstRef node,
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
    default: maxW = CGFLOAT_MAX; break;
  }
  
  CGSize fit = [label sizeThatFits:CGSizeMake(maxW, CGFLOAT_MAX)];
  
  float outW;
  switch (widthMode) {
    case YGMeasureModeExactly: outW = width; break;
    case YGMeasureModeAtMost: outW = MIN((float)fit.width, width); break;
    default: outW = (float)fit.width; break;
  }
  
  float outH;
  switch (heightMode) {
    case YGMeasureModeExactly: outH = height; break;
    case YGMeasureModeAtMost: outH = MIN((float)fit.height, height); break;
    default: outH = (float)fit.height; break;
  }
  
  return (YGSize){.width = outW, .height = outH};
}

static CGFloat RuneTextNum(id x) {
  return x && ![x isKindOfClass:[NSNull class]] ? [x doubleValue] : NAN;
}

static BOOL RuneTextHandleSetProp(SNUIManager *manager,
                                  SNNode *node,
                                  NSString *name,
                                  id value,
                                  NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[RuneTextView class]]) {
    return NO;
  }

  RuneTextView *textView = (RuneTextView *)node.view;

  if ([name isEqualToString:@"text"]) {
    NSString *text = [value isKindOfClass:[NSString class]] ? (NSString *)value : @"";
    textView.text = text;
    
    // Only mark dirty if node has no children (Yoga constraint)
    if (node.yoga && YGNodeGetChildCount(node.yoga) == 0) {
      if (YGNodeGetOwner(node.yoga)) {
        YGNodeMarkDirty(node.yoga);
      }
    }
    RuneTextPropagateChange(manager, node);
    [manager rune_markNeedsFlush];
    return YES;
  }

  if ([name isEqualToString:@"numberOfLines"]) {
    if ([value isKindOfClass:[NSNumber class]]) {
      textView.numberOfLines = [value integerValue];
    }
    return YES;
  }

  return NO;
}

static void RuneTextHandleStyle(SNUIManager *manager, SNNode *node, NSDictionary *style) {
  if (!node || ![node.view isKindOfClass:[RuneTextView class]] || !style) return;
  
  RuneTextView *textView = (RuneTextView *)node.view;
  
  // Handle fontSize
  NSNumber *fontSize = style[@"fontSize"];
  if (fontSize) {
    textView.font = [UIFont systemFontOfSize:(CGFloat)RuneTextNum(fontSize) weight:UIFontWeightRegular];
  }
  
  // Handle fontWeight
  NSString *fontWeight = style[@"fontWeight"];
  if (fontWeight) {
    NSDictionary *weights = @{
      @"normal": @(UIFontWeightRegular),
      @"bold": @(UIFontWeightBold),
      @"100": @(UIFontWeightUltraLight),
      @"200": @(UIFontWeightThin),
      @"300": @(UIFontWeightLight),
      @"400": @(UIFontWeightRegular),
      @"500": @(UIFontWeightMedium),
      @"600": @(UIFontWeightSemibold),
      @"700": @(UIFontWeightBold),
      @"800": @(UIFontWeightHeavy),
      @"900": @(UIFontWeightBlack)
    };
    CGFloat currentSize = textView.font ? textView.font.pointSize : 16.0;
    NSNumber *weight = weights[fontWeight];
    if (weight) {
      textView.font = [UIFont systemFontOfSize:currentSize weight:[weight doubleValue]];
    }
  }
  
  // Handle color
  NSString *color = style[@"color"];
  if (color) {
    // We need to import SNHexColor for this
    textView.textColor = SNColorFromHex(color);
  }
  
  // Mark dirty if needed
  if (node.yoga && YGNodeGetChildCount(node.yoga) == 0 && YGNodeGetOwner(node.yoga)) {
    YGNodeMarkDirty(node.yoga);
  }
}

@implementation SNUIManager (TextComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    RuneComponentDescriptor *descriptor = [[RuneComponentDescriptor alloc] initWithType:@"text"];
    
    descriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      RuneTextView *textView = [[RuneTextView alloc] init];
      return textView;
    };
    
    descriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[RuneTextView class]]) return;
      
      RuneTextView *textView = (RuneTextView *)node.view;
      textView.rune_node = node;
      
      // Set up Yoga measure function for text
      if (node.yoga) {
        YGNodeSetContext(node.yoga, (__bridge void *)textView);
        YGNodeSetMeasureFunc(node.yoga, RuneTextMeasureFunc);
      }
    };
    
    descriptor.handleSetProp = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name, id value, NSString *rawJSON) {
      return RuneTextHandleSetProp(manager, node, name, value, rawJSON);
    };
    
    descriptor.applyStyle = ^(SNUIManager *manager, SNNode *node, NSDictionary *style) {
      RuneTextHandleStyle(manager, node, style);
    };
    
    // Custom insertion handler for text composition
    descriptor.handleInsertChild = ^BOOL(SNUIManager *manager, SNNode *parent, SNNode *child, NSNumber *childId, NSUInteger index) {
      return RuneTextHandleInsertion(manager, parent, child, childId, index);
    };
    
    // Custom removal handler for text composition
    descriptor.handleRemoveChild = ^BOOL(SNUIManager *manager, SNNode *parent, SNNode *child, NSNumber *childId) {
      return RuneTextHandleRemoval(manager, parent, child, childId);
    };
    
    RuneRegisterComponentDescriptor(descriptor);
  });
}

@end
