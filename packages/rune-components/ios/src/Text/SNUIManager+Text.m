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
static NSString *RuneTextApplyTransform(NSString *text, NSString *transform) {
  if (!transform || text.length == 0) return text;
  if ([transform isEqualToString:@"uppercase"]) {
    return [text uppercaseString];
  }
  if ([transform isEqualToString:@"lowercase"]) {
    return [text lowercaseString];
  }
  if ([transform isEqualToString:@"capitalize"]) {
    return [text capitalizedString];
  }
  return text;
}

static NSDictionary<NSAttributedStringKey, id> *
RuneMergeAttributes(NSDictionary<NSAttributedStringKey, id> *parent,
                    NSDictionary<NSAttributedStringKey, id> *child) {
  if (!parent) return child ?: @{};
  if (!child) return parent;
  NSMutableDictionary *merged = [parent mutableCopy];
  [child enumerateKeysAndObjectsUsingBlock:^(id key, id obj, BOOL *stop) {
    merged[key] = obj;
  }];
  return merged;
}

static NSAttributedString *RuneBuildAttributedText(SNUIManager *manager,
                                                   SNNode *node,
                                                   NSDictionary<NSAttributedStringKey, id> *inherited) {
  if (!node || ![node.view isKindOfClass:[RuneTextView class]]) {
    return [[NSAttributedString alloc] initWithString:@""];
  }

  RuneTextView *textView = (RuneTextView *)node.view;
  NSDictionary *ownAttributes = textView.rune_baseTextAttributes ?: @{};

  // If child has a font but no explicit size, adopt parent's point size.
  NSDictionary *effective = inherited;
  UIFont *parentFont = inherited[NSFontAttributeName];
  UIFont *ownFont = ownAttributes[NSFontAttributeName];
  NSMutableDictionary *adjustedOwn = [ownAttributes mutableCopy];
  
  if (ownFont && parentFont && !textView.rune_hasExplicitFontSize) {
    // LOGGING START
    if ([ownFont.fontName containsString:@"RuneIcons"]) {
        NSLog(@"[RuneText] Nesting Icon Font: '%@' (size: %.1f). Parent Font: '%@' (size: %.1f)", 
              ownFont.fontName, ownFont.pointSize, parentFont.fontName, parentFont.pointSize);
    }
    // LOGGING END

    UIFontDescriptor *descriptor = [ownFont.fontDescriptor fontDescriptorWithSize:parentFont.pointSize];
    UIFont *newFont = [UIFont fontWithDescriptor:descriptor size:parentFont.pointSize];
    
    // LOGGING START
    if ([ownFont.fontName containsString:@"RuneIcons"]) {
        NSLog(@"[RuneText] Resized Icon Font: '%@'", newFont.fontName);
    }
    // LOGGING END
    
    adjustedOwn[NSFontAttributeName] = newFont;
  }

  if (adjustedOwn) {
    effective = RuneMergeAttributes(inherited, adjustedOwn);
  }

  if (node.children.count == 0) {
    NSString *raw = textView.text ?: @"";
    NSString *transformed = RuneTextApplyTransform(raw, textView.rune_textTransform);
    return [[NSAttributedString alloc] initWithString:transformed attributes:effective];
  }

  NSMutableAttributedString *builder = [[NSMutableAttributedString alloc] init];
  for (NSNumber *childId in node.children) {
    SNNode *child = [manager rune_nodeForId:childId];
    if (!child || ![child.view isKindOfClass:[RuneTextView class]]) continue;
    NSAttributedString *childText = RuneBuildAttributedText(manager, child, effective);
    [builder appendAttributedString:childText];
  }

  // Apply paragraph-level attributes (alignment/lineHeight/spacing) from this node across its range.
  if (ownAttributes[NSParagraphStyleAttributeName]) {
    NSRange fullRange = NSMakeRange(0, builder.length);
    [builder addAttribute:NSParagraphStyleAttributeName value:ownAttributes[NSParagraphStyleAttributeName] range:fullRange];
  }
  if (ownAttributes[NSKernAttributeName]) {
    NSRange fullRange = NSMakeRange(0, builder.length);
    [builder addAttribute:NSKernAttributeName value:ownAttributes[NSKernAttributeName] range:fullRange];
  }

  return builder;
}

// Helper function to refresh text for a label node by composing from children
static void RuneTextRefreshLabelNode(SNUIManager *manager, SNNode *node) {
  if (!node || ![node.view isKindOfClass:[RuneTextView class]]) return;

  RuneTextView *textView = (RuneTextView *)node.view;

  NSAttributedString *composed = RuneBuildAttributedText(manager, node, nil);
  textView.attributedText = composed;

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
    RuneTextRefreshLabelNode(manager, node);
    
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
  CGFloat defaultSize = textView.font ? textView.font.pointSize : 16.0;
  NSNumber *fontSize = style[@"fontSize"];
  CGFloat resolvedSize = fontSize ? (CGFloat)RuneTextNum(fontSize) : defaultSize;
  textView.rune_hasExplicitFontSize = fontSize != nil;

  NSString *fontFamily = style[@"fontFamily"];
  NSString *fontStyle = style[@"fontStyle"];
  NSString *fontWeight = style[@"fontWeight"];

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
  NSNumber *weightNum = weights[fontWeight ?: @""] ?: @(UIFontWeightRegular);
  UIFontDescriptorSymbolicTraits traits = 0;
  if ([fontStyle isKindOfClass:[NSString class]] && [fontStyle isEqualToString:@"italic"]) {
    traits |= UIFontDescriptorTraitItalic;
  }

  UIFontDescriptor *descriptor;
  if ([fontFamily isKindOfClass:[NSString class]] && fontFamily.length > 0) {
    descriptor = [UIFontDescriptor fontDescriptorWithName:fontFamily size:resolvedSize];
    // Debug logging for font lookup
    if ([fontFamily hasPrefix:@"RuneIcons"]) {
       UIFont *testFont = [UIFont fontWithDescriptor:descriptor size:resolvedSize];
       NSLog(@"[RuneText] Requesting font: '%@'. Resolved: '%@'", fontFamily, testFont.fontName);
    }
  } else {
    descriptor = [UIFont systemFontOfSize:resolvedSize weight:(CGFloat)[weightNum doubleValue]].fontDescriptor;
  }
  if (traits != 0) {
    descriptor = [descriptor fontDescriptorWithSymbolicTraits:traits];
  }
  BOOL hasCustomFontProp = fontSize || (fontFamily && fontFamily.length > 0) || fontWeight || traits != 0;
  UIFont *font = hasCustomFontProp ? [UIFont fontWithDescriptor:descriptor size:resolvedSize] : nil;

  NSMutableParagraphStyle *paragraph = [[NSMutableParagraphStyle alloc] init];
  NSString *textAlign = style[@"textAlign"];
  if ([textAlign isEqualToString:@"center"]) paragraph.alignment = NSTextAlignmentCenter;
  else if ([textAlign isEqualToString:@"right"]) paragraph.alignment = NSTextAlignmentRight;
  else if ([textAlign isEqualToString:@"justify"]) paragraph.alignment = NSTextAlignmentJustified;
  else paragraph.alignment = NSTextAlignmentLeft;

  NSNumber *lineHeight = style[@"lineHeight"];
  if (lineHeight) {
    CGFloat lh = (CGFloat)RuneTextNum(lineHeight);
    paragraph.minimumLineHeight = lh;
    paragraph.maximumLineHeight = lh;
  }
  NSNumber *lineSpacing = style[@"lineSpacing"];
  if (lineSpacing) {
    paragraph.lineSpacing = (CGFloat)RuneTextNum(lineSpacing);
  }
  NSNumber *paragraphSpacing = style[@"paragraphSpacing"];
  if (paragraphSpacing) {
    paragraph.paragraphSpacing = (CGFloat)RuneTextNum(paragraphSpacing);
  }

  NSMutableDictionary<NSAttributedStringKey, id> *attrs = [NSMutableDictionary dictionary];
  if (font) {
    attrs[NSFontAttributeName] = font;
  }
  BOOL hasParagraphProp = textAlign || lineHeight || lineSpacing || paragraphSpacing;
  if (hasParagraphProp) {
    attrs[NSParagraphStyleAttributeName] = paragraph;
  }

  NSString *color = style[@"color"];
  if (color) {
    UIColor *uicolor = SNColorFromHex(color);
    textView.textColor = uicolor;
    attrs[NSForegroundColorAttributeName] = uicolor;
  }

  NSNumber *letterSpacing = style[@"letterSpacing"];
  if (letterSpacing) {
    attrs[NSKernAttributeName] = @((CGFloat)RuneTextNum(letterSpacing));
  }

  NSString *decoration = style[@"textDecorationLine"];
  if ([decoration isKindOfClass:[NSString class]]) {
    if ([decoration containsString:@"underline"]) {
      attrs[NSUnderlineStyleAttributeName] = @(NSUnderlineStyleSingle);
    }
    if ([decoration containsString:@"line-through"] || [decoration containsString:@"strikethrough"]) {
      attrs[NSStrikethroughStyleAttributeName] = @(NSUnderlineStyleSingle);
    }
  }

  NSString *transform = style[@"textTransform"];
  if ([transform isKindOfClass:[NSString class]]) {
    textView.rune_textTransform = transform;
  } else {
    textView.rune_textTransform = nil;
  }

  textView.rune_baseTextAttributes = attrs;

  // Mark dirty and refresh composed attributed text
  RuneTextRefreshLabelNode(manager, node);
  RuneTextPropagateChange(manager, node);
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