#import "ZynthUIManager.h"
#import "ZynthYogaLayout.h"
#import <UIKit/UIKit.h>

@implementation ZynthUIManager {
  __weak UIView *_rootView;
  NSMutableDictionary<NSNumber *, UIView *> *_nodes;
  NSMutableDictionary<NSNumber *, NSNumber *> *_parents;
  ZynthYogaLayout *_yogaLayout;
  int _nextId;
}

- (instancetype)initWithRootView:(UIView *)rootView {
  self = [super init];
  if (self) {
    _rootView = rootView;
    _nodes = [NSMutableDictionary dictionary];
    _parents = [NSMutableDictionary dictionary];
    _yogaLayout = [[ZynthYogaLayout alloc] initWithRootView:rootView];
    _nextId = 1;
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
  [_yogaLayout createNodeWithId:@(nid) type:type view:view];
  return @(nid);
}

- (NSNumber *)createNodeWithId:(NSNumber *)nodeId type:(NSString *)type {
  int nid = nodeId.intValue > 0 ? nodeId.intValue : _nextId++;
  if (nid >= _nextId) {
    _nextId = nid + 1;
  }
  UIView *view = nil;
  if ([type isEqualToString:@"text"]) {
    UILabel *label = [[UILabel alloc] initWithFrame:CGRectZero];
    label.numberOfLines = 0;
    view = label;
  } else {
    view = [[UIView alloc] initWithFrame:CGRectZero];
  }
  _nodes[@(nid)] = view;
  [_yogaLayout createNodeWithId:@(nid) type:type view:view];
  return @(nid);
}

- (void)setProp:(NSNumber *)nodeId name:(NSString *)name value:(NSString *)value {
  UIView *view = _nodes[nodeId];
  if (!view || name.length == 0) return;
  if ([name isEqualToString:@"backgroundColor"]) {
    UIColor *color = [self colorFromString:value];
    if (color) view.backgroundColor = color;
    return;
  }
  if ([name isEqualToString:@"color"] && [view isKindOfClass:[UILabel class]]) {
    UIColor *color = [self colorFromString:value];
    if (color) ((UILabel *)view).textColor = color;
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
    UIColor *color = [self colorFromString:value];
    if (color) view.layer.borderColor = color.CGColor;
    return;
  }
  if ([name isEqualToString:@"fontSize"] && [view isKindOfClass:[UILabel class]]) {
    UILabel *label = (UILabel *)view;
    CGFloat size = (CGFloat)[value doubleValue];
    UIFont *font = label.font ?: [UIFont systemFontOfSize:size];
    label.font = [font fontWithSize:size];
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
    return;
  }
  if ([name isEqualToString:@"fontFamily"] && [view isKindOfClass:[UILabel class]]) {
    UILabel *label = (UILabel *)view;
    UIFont *font = [UIFont fontWithName:value size:label.font.pointSize];
    if (font) label.font = font;
    return;
  }
  if ([name isEqualToString:@"fontStyle"] && [view isKindOfClass:[UILabel class]]) {
    UILabel *label = (UILabel *)view;
    if ([value isEqualToString:@"italic"]) {
      UIFontDescriptor *descriptor = [label.font.fontDescriptor fontDescriptorWithSymbolicTraits:UIFontDescriptorTraitItalic];
      if (descriptor) label.font = [UIFont fontWithDescriptor:descriptor size:label.font.pointSize];
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
  if ([name isEqualToString:@"letterSpacing"] && [view isKindOfClass:[UILabel class]]) {
    UILabel *label = (UILabel *)view;
    NSString *text = label.text ?: @"";
    NSMutableAttributedString *attr = [[NSMutableAttributedString alloc] initWithString:text];
    [attr addAttribute:NSKernAttributeName value:@([value doubleValue]) range:NSMakeRange(0, attr.length)];
    label.attributedText = attr;
    return;
  }
  if ([name isEqualToString:@"width"]) {
    [_yogaLayout setStyle:nodeId name:@"width" value:value];
    return;
  }
  if ([name isEqualToString:@"height"]) {
    [_yogaLayout setStyle:nodeId name:@"height" value:value];
    return;
  }
  if ([name isEqualToString:@"flexDirection"]) {
    [_yogaLayout setStyle:nodeId name:@"flexDirection" value:value];
    return;
  }
  [_yogaLayout setStyle:nodeId name:name value:value];
}

- (void)setText:(NSNumber *)nodeId text:(NSString *)text {
  UIView *view = _nodes[nodeId];
  if ([view isKindOfClass:[UILabel class]]) {
    ((UILabel *)view).text = text ?: @"";
    [_yogaLayout markDirty:nodeId];
    NSNumber *parentId = _parents[nodeId];
    if (parentId) {
      UIView *parent = _nodes[parentId];
      if ([parent isKindOfClass:[UILabel class]]) {
        ((UILabel *)parent).text = text ?: @"";
        [_yogaLayout markDirty:parentId];
      }
    }
  }
}

- (void)insertChild:(NSNumber *)parentId child:(NSNumber *)childId index:(NSNumber *)index {
  UIView *child = _nodes[childId];
  if (!child) return;
  UIView *parent = parentId.intValue == 0 ? _rootView : _nodes[parentId];
  if (!parent) return;
  _parents[childId] = parentId;
  if ([parent isKindOfClass:[UILabel class]]) {
    if ([child isKindOfClass:[UILabel class]]) {
      ((UILabel *)parent).text = ((UILabel *)child).text ?: @"";
      [_yogaLayout markDirty:parentId];
    }
    return;
  }
  NSInteger idx = MAX(0, MIN(index.integerValue, (NSInteger)parent.subviews.count));
  [parent insertSubview:child atIndex:(NSUInteger)idx];
  [_yogaLayout insertChild:parentId child:childId index:index];
}

- (void)removeChild:(NSNumber *)parentId child:(NSNumber *)childId {
  UIView *child = _nodes[childId];
  if (!child) return;
  [_parents removeObjectForKey:childId];
  [child removeFromSuperview];
  [_yogaLayout removeChild:parentId child:childId];
}

- (void)setHandler:(NSNumber *)nodeId name:(NSString *)name {
  (void)nodeId;
  (void)name;
}

- (void)applyBatch:(NSString *)batchJSON {
  (void)batchJSON;
}

- (void)setSurface:(NSNumber *)surfaceId {
  (void)surfaceId;
}

- (void)flush {
  [_yogaLayout applyLayout];
}

- (UIColor *)colorFromString:(NSString *)value {
  if (value.length == 0) return nil;
  value = [value stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (![value hasPrefix:@"#"]) return nil;
  NSString *hex = [value substringFromIndex:1];
  unsigned long long parsed = 0;
  NSScanner *scanner = [NSScanner scannerWithString:hex];
  if (![scanner scanHexLongLong:&parsed]) return nil;
  CGFloat a = 1.0;
  CGFloat r = 0.0;
  CGFloat g = 0.0;
  CGFloat b = 0.0;
  if (hex.length == 6) {
    r = ((parsed >> 16) & 0xFF) / 255.0;
    g = ((parsed >> 8) & 0xFF) / 255.0;
    b = (parsed & 0xFF) / 255.0;
  } else if (hex.length == 8) {
    a = ((parsed >> 24) & 0xFF) / 255.0;
    r = ((parsed >> 16) & 0xFF) / 255.0;
    g = ((parsed >> 8) & 0xFF) / 255.0;
    b = (parsed & 0xFF) / 255.0;
  } else {
    return nil;
  }
  return [UIColor colorWithRed:r green:g blue:b alpha:a];
}

@end
