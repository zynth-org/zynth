#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthKit.h"
#import "ZynthComponentRegistry.h"
#import "ZynthComponentAPI.h"
#import "ZynthUIManager.h"
#import "ZynthNode.h"
#import "ZynthHexColor.h"
#endif

#import "ZynthTextView.h"
#import <Yoga/Yoga.h>
#import <CoreText/CoreText.h>

static CGFloat ZynthTextNum(id x) {
  return x && ![x isKindOfClass:[NSNull class]] ? [x doubleValue] : NAN;
}

// Helper function for Yoga measure
static YGSize ZynthTextMeasureFunc(YGNodeConstRef node,
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

// Helper function to refresh text for a label node by composing from children
static NSString *ZynthTextApplyTransform(NSString *text, NSString *transform) {
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
ZynthMergeAttributes(NSDictionary<NSAttributedStringKey, id> *parent,
                    NSDictionary<NSAttributedStringKey, id> *child) {
  if (!parent) return child ?: @{};
  if (!child) return parent;
  NSMutableDictionary *merged = [parent mutableCopy];
  [child enumerateKeysAndObjectsUsingBlock:^(id key, id obj, BOOL *stop) {
    merged[key] = obj;
  }];
  return merged;
}

static BOOL ZynthTextContainsPrivateUseGlyph(NSString *text);

static UIFont *ZynthResolveFontFamily(NSString *fontFamily,
                                      CGFloat size,
                                      UIFontDescriptorSymbolicTraits traits) {
  if (![fontFamily isKindOfClass:[NSString class]] || fontFamily.length == 0) {
    return nil;
  }

  UIFont *font = [UIFont fontWithName:fontFamily size:size];
  if (!font) {
    NSString *regularName = [fontFamily stringByAppendingString:@"Regular"];
    font = [UIFont fontWithName:regularName size:size];
  }
  if (!font) {
    NSArray<NSString *> *familyMembers = [UIFont fontNamesForFamilyName:fontFamily];
    if (familyMembers.count > 0) {
      font = [UIFont fontWithName:familyMembers.firstObject size:size];
    }
  }
  if (font && traits != 0) {
    UIFontDescriptor *descriptor = [font.fontDescriptor fontDescriptorWithSymbolicTraits:traits];
    if (descriptor) {
      UIFont *traitFont = [UIFont fontWithDescriptor:descriptor size:size];
      if (traitFont) {
        font = traitFont;
      }
    }
  }
  return font;
}

static NSAttributedString *ZynthBuildAttributedText(ZynthUIManager *manager,
                                                   ZynthNode *node,
                                                   NSDictionary<NSAttributedStringKey, id> *inherited) {
  if (!node || ![node.view isKindOfClass:[ZynthTextView class]]) {
    return [[NSAttributedString alloc] initWithString:@""];
  }

  ZynthTextView *textView = (ZynthTextView *)node.view;
  NSDictionary *ownAttributes = textView.zynth_baseTextAttributes ?: @{};

  // Build effective attributes:
  // - If child has explicit fontFamily, NEVER inherit parent's font (crucial for icon fonts)
  // - If child has font but no explicit size, adopt parent's point size while preserving font family
  NSDictionary *effective = inherited;
  UIFont *parentFont = inherited[NSFontAttributeName];
  UIFont *ownFont = ownAttributes[NSFontAttributeName];
  NSMutableDictionary *adjustedOwn = [ownAttributes mutableCopy];

  if (!ownFont && textView.zynth_hasExplicitFontFamily && textView.zynth_explicitFontFamily.length > 0) {
    CGFloat fallbackSize = textView.font ? textView.font.pointSize : 17.0;
    UIFont *resolvedFont = ZynthResolveFontFamily(textView.zynth_explicitFontFamily, fallbackSize, 0);
    if (resolvedFont) {
      ownFont = resolvedFont;
      adjustedOwn[NSFontAttributeName] = resolvedFont;
    }
  }
  
  if (textView.zynth_hasExplicitFontFamily) {
    // Child has explicit fontFamily (e.g., icon font) - preserve it completely
    // Strip parent's font from inheritance so child's font takes full precedence
    NSMutableDictionary *filteredInherited = [inherited mutableCopy];
    [filteredInherited removeObjectForKey:NSFontAttributeName];
    
    if (ownFont) {
      // Only inherit parent's size if child doesn't have explicit size
      if (!textView.zynth_hasExplicitFontSize && parentFont) {
        UIFont *resizedFont = [UIFont fontWithName:ownFont.fontName size:parentFont.pointSize];
        adjustedOwn[NSFontAttributeName] = resizedFont ?: ownFont;
      }
    }
    effective = ZynthMergeAttributes(filteredInherited, adjustedOwn);
  } else if (ownFont && parentFont && !textView.zynth_hasExplicitFontSize) {
    // Child has font but no explicit size - adopt parent's size
    // Use fontWithSize: to preserve weight/traits of the child's font (especially system fonts)
    adjustedOwn[NSFontAttributeName] = [ownFont fontWithSize:parentFont.pointSize];
    effective = ZynthMergeAttributes(inherited, adjustedOwn);
  } else if (adjustedOwn) {
    effective = ZynthMergeAttributes(inherited, adjustedOwn);
  }

  if (node.children.count == 0) {
    NSString *raw = textView.text ?: @"";
    NSString *transformed = ZynthTextApplyTransform(raw, textView.zynth_textTransform);
    
    // Ensure every text segment has a font - UILabel needs complete font coverage
    NSMutableDictionary *finalAttrs = [effective mutableCopy] ?: [NSMutableDictionary dictionary];
    if (!finalAttrs[NSFontAttributeName]) {
      // Use label's current font or system default
      UIFont *defaultFont = textView.font ?: [UIFont systemFontOfSize:17.0];
      finalAttrs[NSFontAttributeName] = defaultFont;
    }

    return [[NSAttributedString alloc] initWithString:transformed attributes:finalAttrs];
  }

  NSMutableAttributedString *builder = [[NSMutableAttributedString alloc] init];
  for (NSNumber *childId in node.children) {
    ZynthNode *child = [manager zynth_nodeForId:childId];
    if (!child || ![child.view isKindOfClass:[ZynthTextView class]]) continue;
    NSAttributedString *childText = ZynthBuildAttributedText(manager, child, effective);
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
static void ZynthTextRefreshLabelNode(ZynthUIManager *manager, ZynthNode *node) {
  if (!node || ![node.view isKindOfClass:[ZynthTextView class]]) return;

  ZynthTextView *textView = (ZynthTextView *)node.view;

  NSAttributedString *composed = ZynthBuildAttributedText(manager, node, nil);
  textView.attributedText = composed;
  [manager markNodeDirty:@(node.nid)];
  
  if (ZynthTextContainsPrivateUseGlyph(composed.string)) {
    dispatch_async(dispatch_get_main_queue(), ^{
      textView.attributedText = composed;
      [textView setNeedsDisplay];
    });
  }

  // "Second tick" pass to fix race conditions where styles might be lost
  // during rapid layout updates or initial render.
  dispatch_async(dispatch_get_main_queue(), ^{
    NSAttributedString *recomposed = ZynthBuildAttributedText(manager, node, nil);
    textView.attributedText = recomposed;
    [textView setNeedsDisplay];
    [manager markNodeDirty:@(node.nid)];
  });
  
  // Force layout update to ensure the new attributed text is rendered
  [textView setNeedsDisplay];
  if (node.yoga && YGNodeGetChildCount(node.yoga) == 0 && YGNodeGetOwner(node.yoga)) {
    YGNodeSetMeasureFunc(node.yoga, ZynthTextMeasureFunc);
    YGNodeMarkDirty(node.yoga);
  }
}

// Helper function to propagate text changes up the tree
static void ZynthTextPropagateChange(ZynthUIManager *manager, ZynthNode *node) {
  if (!node) return;

  int parentId = node.parentId;
  while (parentId > 0) {
    ZynthNode *parent = [manager zynth_nodeForId:@(parentId)];
    if (!parent || ![parent.view isKindOfClass:[ZynthTextView class]]) break;

    ZynthTextRefreshLabelNode(manager, parent);
    parentId = parent.parentId;
  }
}

// Helper function to handle text insertion
static BOOL ZynthTextHandleInsertion(ZynthUIManager *manager,
                                    ZynthNode *parent,
                                    ZynthNode *child,
                                    NSNumber *childId,
                                    NSUInteger index) {
  if (!parent || ![parent.view isKindOfClass:[ZynthTextView class]]) return NO;

  NSUInteger existing = [parent.children indexOfObject:childId];
  if (existing != NSNotFound) {
    [parent.children removeObjectAtIndex:existing];
  }
  NSUInteger targetIndex = MIN(index, parent.children.count);
  [parent.children insertObject:childId atIndex:targetIndex];

  ZynthTextRefreshLabelNode(manager, parent);
  ZynthTextPropagateChange(manager, parent);
  [manager markNodeDirty:@(parent.nid)];
  return YES;
}

// Helper function to handle text removal
static BOOL ZynthTextHandleRemoval(ZynthUIManager *manager,
                                  ZynthNode *parent,
                                  ZynthNode *child,
                                  NSNumber *childId) {
  if (!parent || ![parent.view isKindOfClass:[ZynthTextView class]]) return NO;

  NSUInteger idx = [parent.children indexOfObject:childId];
  if (idx != NSNotFound) {
    [parent.children removeObjectAtIndex:idx];
  }

  ZynthTextRefreshLabelNode(manager, parent);
  ZynthTextPropagateChange(manager, parent);
  [manager markNodeDirty:@(parent.nid)];
  return YES;
}


static BOOL ZynthTextContainsPrivateUseGlyph(NSString *text) {
  if (!text.length) return NO;
  __block BOOL found = NO;
  [text enumerateSubstringsInRange:NSMakeRange(0, text.length)
                           options:NSStringEnumerationByComposedCharacterSequences
                        usingBlock:^(NSString *substring, NSRange substringRange, NSRange enclosingRange, BOOL *stop) {
    if (substring.length == 0) return;
    unichar ch = [substring characterAtIndex:0];
    if (ch >= 0xE000 && ch <= 0xF8FF) {
      found = YES;
      *stop = YES;
    }
  }];
  return found;
}

static BOOL ZynthTextHandleSetProp(ZynthUIManager *manager,
                                  ZynthNode *node,
                                  NSString *name,
                                  id value,
                                  NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[ZynthTextView class]]) {
    return NO;
  }

  ZynthTextView *textView = (ZynthTextView *)node.view;

  if ([name isEqualToString:@"text"]) {
    NSString *text = [value isKindOfClass:[NSString class]] ? (NSString *)value : @"";
    textView.text = text;
    ZynthTextRefreshLabelNode(manager, node);
    
    // Only mark dirty if node has no children (Yoga constraint)
    if (node.yoga && YGNodeGetChildCount(node.yoga) == 0) {
      if (YGNodeGetOwner(node.yoga)) {
        YGNodeMarkDirty(node.yoga);
      }
    }
    ZynthTextPropagateChange(manager, node);
    [manager markNodeDirty:@(node.nid)];
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

static void ZynthTextHandleStyle(ZynthUIManager *manager, ZynthNode *node, NSDictionary *style) {
  if (!node || ![node.view isKindOfClass:[ZynthTextView class]] || !style) return;
  
  ZynthTextView *textView = (ZynthTextView *)node.view;
  CGFloat defaultSize = textView.font ? textView.font.pointSize : 16.0;
  NSNumber *fontSize = style[@"fontSize"];
  CGFloat resolvedSize = fontSize ? (CGFloat)ZynthTextNum(fontSize) : defaultSize;
  textView.zynth_hasExplicitFontSize = fontSize != nil;

  NSString *fontFamily = style[@"fontFamily"];
  NSString *fontStyle = style[@"fontStyle"];
  id fontWeightValue = style[@"fontWeight"];
  NSString *fontWeight = nil;
  if ([fontWeightValue isKindOfClass:[NSNumber class]]) {
    fontWeight = [(NSNumber *)fontWeightValue stringValue];
  } else if ([fontWeightValue isKindOfClass:[NSString class]]) {
    fontWeight = (NSString *)fontWeightValue;
  }
  
  // Track if this node has an explicit fontFamily (crucial for icon fonts)
  textView.zynth_hasExplicitFontFamily = ([fontFamily isKindOfClass:[NSString class]] && fontFamily.length > 0);
  textView.zynth_explicitFontFamily = textView.zynth_hasExplicitFontFamily ? fontFamily : nil;

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
  
  // Map fontWeight to bold trait if applicable
  BOOL isBold = NO;
  if (fontWeight) {
    if ([fontWeight isEqualToString:@"bold"] || 
        [fontWeight isEqualToString:@"700"] || 
        [fontWeight isEqualToString:@"800"] || 
        [fontWeight isEqualToString:@"900"]) {
      isBold = YES;
    } else if ([fontWeight integerValue] >= 600) {
      isBold = YES;
    }
  }
  if (isBold) {
    traits |= UIFontDescriptorTraitBold;
  }

  BOOL hasCustomFontProp = fontSize || (fontFamily && fontFamily.length > 0) || fontWeight || traits != 0;
  UIFont *font = nil;
  if (hasCustomFontProp) {
    if ([fontFamily isKindOfClass:[NSString class]] && fontFamily.length > 0) {
      font = ZynthResolveFontFamily(fontFamily, resolvedSize, traits);
    } else {
      UIFont *baseFont = [UIFont systemFontOfSize:resolvedSize weight:(CGFloat)[weightNum doubleValue]];
      if (traits != 0) {
        UIFontDescriptor *descriptor = [baseFont.fontDescriptor fontDescriptorWithSymbolicTraits:traits];
        if (descriptor) {
          UIFont *traitFont = [UIFont fontWithDescriptor:descriptor size:resolvedSize];
          if (traitFont) {
            baseFont = traitFont;
          }
        }
      }
      font = baseFont;
    }
  }

  NSMutableParagraphStyle *paragraph = [[NSMutableParagraphStyle alloc] init];
  NSString *textAlign = style[@"textAlign"];
  if ([textAlign isEqualToString:@"center"]) paragraph.alignment = NSTextAlignmentCenter;
  else if ([textAlign isEqualToString:@"right"]) paragraph.alignment = NSTextAlignmentRight;
  else if ([textAlign isEqualToString:@"justify"]) paragraph.alignment = NSTextAlignmentJustified;
  else paragraph.alignment = NSTextAlignmentLeft;

  NSNumber *lineHeight = style[@"lineHeight"];
  if (lineHeight) {
    CGFloat lh = (CGFloat)ZynthTextNum(lineHeight);
    paragraph.minimumLineHeight = lh;
    paragraph.maximumLineHeight = lh;
  }
  NSNumber *lineSpacing = style[@"lineSpacing"];
  if (lineSpacing) {
    paragraph.lineSpacing = (CGFloat)ZynthTextNum(lineSpacing);
  }
  NSNumber *paragraphSpacing = style[@"paragraphSpacing"];
  if (paragraphSpacing) {
    paragraph.paragraphSpacing = (CGFloat)ZynthTextNum(paragraphSpacing);
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
    UIColor *uicolor = ZynthColorFromHex(color);
    textView.textColor = uicolor;
    attrs[NSForegroundColorAttributeName] = uicolor;
  }

  NSNumber *letterSpacing = style[@"letterSpacing"];
  if (letterSpacing) {
    attrs[NSKernAttributeName] = @((CGFloat)ZynthTextNum(letterSpacing));
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
    textView.zynth_textTransform = transform;
  } else {
    textView.zynth_textTransform = nil;
  }

  textView.zynth_baseTextAttributes = attrs;

  // Mark dirty and refresh composed attributed text
  ZynthTextRefreshLabelNode(manager, node);
  ZynthTextPropagateChange(manager, node);
  if (node.yoga && YGNodeGetChildCount(node.yoga) == 0 && YGNodeGetOwner(node.yoga)) {
    YGNodeMarkDirty(node.yoga);
  }
}

@implementation ZynthUIManager (TextComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    ZynthComponentDescriptor *descriptor = [[ZynthComponentDescriptor alloc] initWithType:@"text"];
    
    descriptor.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      ZynthTextView *textView = [[ZynthTextView alloc] init];
      return textView;
    };
    
    descriptor.attach = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[ZynthTextView class]]) return;
      
      ZynthTextView *textView = (ZynthTextView *)node.view;
      textView.zynth_node = node;
      
      // Set up Yoga measure function for text
      if (node.yoga) {
        YGNodeSetContext(node.yoga, (__bridge void *)textView);
        YGNodeSetMeasureFunc(node.yoga, ZynthTextMeasureFunc);
      }
    };
    
    descriptor.handleSetProp = ^BOOL(ZynthUIManager *manager, ZynthNode *node, NSString *name, id value, NSString *rawJSON) {
      return ZynthTextHandleSetProp(manager, node, name, value, rawJSON);
    };
    
    descriptor.applyStyle = ^(ZynthUIManager *manager, ZynthNode *node, NSDictionary *style) {
      ZynthTextHandleStyle(manager, node, style);
    };
    
    // Custom insertion handler for text composition
    descriptor.handleInsertChild = ^BOOL(ZynthUIManager *manager, ZynthNode *parent, ZynthNode *child, NSNumber *childId, NSUInteger index) {
      return ZynthTextHandleInsertion(manager, parent, child, childId, index);
    };
    
    // Custom removal handler for text composition
    descriptor.handleRemoveChild = ^BOOL(ZynthUIManager *manager, ZynthNode *parent, ZynthNode *child, NSNumber *childId) {
      return ZynthTextHandleRemoval(manager, parent, child, childId);
    };
    
    ZynthRegisterComponentDescriptor(descriptor);
  });
}

@end
