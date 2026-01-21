#import "ZynthUIManager+Style.h"
#import "ZynthUIManager+Private.h"
#import "ZynthUIManager+Surface.h"
#import "ZynthColorParser.h"
#import "ZynthGradientParser.h"
#import "ZynthShadowParser.h"
#import "ZynthTextStyleState.h"
#import "ZynthTransformParser.h"
#import "ZynthViewStyleState.h"

static CGSize ZynthParseOffset(NSString *value) {
  NSString *trimmed = [value stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (trimmed.length == 0) return CGSizeZero;
  if ([trimmed hasPrefix:@"["] || [trimmed hasPrefix:@"{"]) {
    NSData *data = [trimmed dataUsingEncoding:NSUTF8StringEncoding];
    id json = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if ([json isKindOfClass:[NSArray class]]) {
      NSArray *arr = (NSArray *)json;
      CGFloat x = arr.count > 0 ? [arr[0] doubleValue] : 0.0;
      CGFloat y = arr.count > 1 ? [arr[1] doubleValue] : 0.0;
      return CGSizeMake(x, y);
    }
    if ([json isKindOfClass:[NSDictionary class]]) {
      NSDictionary *dict = (NSDictionary *)json;
      CGFloat x = [dict[@"width"] doubleValue];
      CGFloat y = [dict[@"height"] doubleValue];
      return CGSizeMake(x, y);
    }
  }
  NSArray<NSString *> *parts = [trimmed componentsSeparatedByCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@", "]];
  NSMutableArray<NSString *> *tokens = [NSMutableArray array];
  for (NSString *part in parts) {
    if (part.length > 0) [tokens addObject:part];
  }
  CGFloat x = tokens.count > 0 ? [tokens[0] doubleValue] : 0.0;
  CGFloat y = tokens.count > 1 ? [tokens[1] doubleValue] : 0.0;
  return CGSizeMake(x, y);
}

@implementation ZynthUIManager (Style)

- (ZynthViewStyleState *)styleStateForNode:(NSNumber *)nodeId {
  ZynthViewStyleState *state = _styleStates[nodeId];
  if (!state) {
    state = [[ZynthViewStyleState alloc] init];
    _styleStates[nodeId] = state;
  }
  return state;
}

- (ZynthTextStyleState *)textStateForNode:(NSNumber *)nodeId {
  ZynthTextStyleState *state = _textStyleStates[nodeId];
  if (!state) {
    state = [[ZynthTextStyleState alloc] init];
    _textStyleStates[nodeId] = state;
  }
  return state;
}

- (BOOL)applyStyleProp:(NSNumber *)nodeId
                  view:(UIView *)view
                  name:(NSString *)name
                 value:(NSString *)value {
  if (name.length == 0 || !view) return NO;

  if ([name isEqualToString:@"background"] || [name isEqualToString:@"backgroundImage"]) {
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    ZynthLinearGradient *gradient = [ZynthGradientParser parse:value];
    if (gradient) {
      state.backgroundGradient = gradient;
    } else {
      state.backgroundGradient = nil;
      state.backgroundColor = [ZynthColorParser parseColor:value];
    }
    [state applyToView:view];
    [_styleDirtyNodes addObject:nodeId];
    return YES;
  }
  if ([name isEqualToString:@"backgroundColor"]) {
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.backgroundColor = [ZynthColorParser parseColor:value];
    state.backgroundGradient = nil;
    [state applyToView:view];
    return YES;
  }

  if ([name isEqualToString:@"shadowColor"]) {
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.shadowColor = [ZynthColorParser parseColor:value];
    [state applyToView:view];
    return YES;
  }
  if ([name isEqualToString:@"shadowOpacity"]) {
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.shadowOpacity = @([value doubleValue]);
    [state applyToView:view];
    return YES;
  }
  if ([name isEqualToString:@"shadowRadius"]) {
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.shadowRadius = @([value doubleValue]);
    [state applyToView:view];
    return YES;
  }
  if ([name isEqualToString:@"shadowOffset"]) {
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.shadowOffset = ZynthParseOffset(value);
    state.hasShadowOffset = YES;
    [state applyToView:view];
    return YES;
  }
  if ([name isEqualToString:@"boxShadow"]) {
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.boxShadow = [ZynthShadowParser parse:value];
    [state applyToView:view];
    return YES;
  }
  if ([name isEqualToString:@"elevation"]) {
    CGFloat elevation = (CGFloat)[value doubleValue];
    if (elevation < 0) elevation = 0;
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    if (!state.boxShadow || state.boxShadow.count == 0) {
      state.shadowOpacity = @(0.24);
      state.shadowRadius = @(elevation);
      state.shadowOffset = CGSizeMake(0, elevation * 0.5);
      state.hasShadowOffset = YES;
      [state applyToView:view];
      [_styleDirtyNodes addObject:nodeId];
    }
    return YES;
  }

  if ([name isEqualToString:@"borderWidth"]) {
    CGFloat width = (CGFloat)[value doubleValue];
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.borderTopWidth = width;
    state.borderRightWidth = width;
    state.borderBottomWidth = width;
    state.borderLeftWidth = width;
    [_styleDirtyNodes addObject:nodeId];
    return YES;
  }
  if ([name isEqualToString:@"borderColor"]) {
    UIColor *color = [ZynthColorParser parseColor:value];
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.borderTopColor = color;
    state.borderRightColor = color;
    state.borderBottomColor = color;
    state.borderLeftColor = color;
    [_styleDirtyNodes addObject:nodeId];
    return YES;
  }
  if ([name isEqualToString:@"borderRadius"]) {
    CGFloat radius = (CGFloat)[value doubleValue];
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.borderTopLeftRadius = radius;
    state.borderTopRightRadius = radius;
    state.borderBottomRightRadius = radius;
    state.borderBottomLeftRadius = radius;
    [_styleDirtyNodes addObject:nodeId];
    return YES;
  }
  if ([name isEqualToString:@"borderTopWidth"]) {
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.borderTopWidth = (CGFloat)[value doubleValue];
    [_styleDirtyNodes addObject:nodeId];
    return YES;
  }
  if ([name isEqualToString:@"borderRightWidth"]) {
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.borderRightWidth = (CGFloat)[value doubleValue];
    [_styleDirtyNodes addObject:nodeId];
    return YES;
  }
  if ([name isEqualToString:@"borderBottomWidth"]) {
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.borderBottomWidth = (CGFloat)[value doubleValue];
    [_styleDirtyNodes addObject:nodeId];
    return YES;
  }
  if ([name isEqualToString:@"borderLeftWidth"]) {
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.borderLeftWidth = (CGFloat)[value doubleValue];
    [_styleDirtyNodes addObject:nodeId];
    return YES;
  }
  if ([name isEqualToString:@"borderTopColor"]) {
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.borderTopColor = [ZynthColorParser parseColor:value];
    [_styleDirtyNodes addObject:nodeId];
    return YES;
  }
  if ([name isEqualToString:@"borderRightColor"]) {
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.borderRightColor = [ZynthColorParser parseColor:value];
    [_styleDirtyNodes addObject:nodeId];
    return YES;
  }
  if ([name isEqualToString:@"borderBottomColor"]) {
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.borderBottomColor = [ZynthColorParser parseColor:value];
    [_styleDirtyNodes addObject:nodeId];
    return YES;
  }
  if ([name isEqualToString:@"borderLeftColor"]) {
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.borderLeftColor = [ZynthColorParser parseColor:value];
    [_styleDirtyNodes addObject:nodeId];
    return YES;
  }
  if ([name isEqualToString:@"borderTopLeftRadius"]) {
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.borderTopLeftRadius = (CGFloat)[value doubleValue];
    [_styleDirtyNodes addObject:nodeId];
    return YES;
  }
  if ([name isEqualToString:@"borderTopRightRadius"]) {
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.borderTopRightRadius = (CGFloat)[value doubleValue];
    [_styleDirtyNodes addObject:nodeId];
    return YES;
  }
  if ([name isEqualToString:@"borderBottomRightRadius"]) {
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.borderBottomRightRadius = (CGFloat)[value doubleValue];
    [_styleDirtyNodes addObject:nodeId];
    return YES;
  }
  if ([name isEqualToString:@"borderBottomLeftRadius"]) {
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.borderBottomLeftRadius = (CGFloat)[value doubleValue];
    [_styleDirtyNodes addObject:nodeId];
    return YES;
  }
  if ([name isEqualToString:@"borderStyle"]) {
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.borderStyle = value;
    [_styleDirtyNodes addObject:nodeId];
    return YES;
  }

  if ([name isEqualToString:@"transform"]) {
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.transform = [ZynthTransformParser parse:value];
    state.hasTransform = YES;
    [state applyToView:view];
    return YES;
  }
  if ([name isEqualToString:@"transformOrigin"]) {
    ZynthViewStyleState *state = [self styleStateForNode:nodeId];
    state.transformOrigin = value;
    [_styleDirtyNodes addObject:nodeId];
    return YES;
  }

  if ([name isEqualToString:@"overflow"]) {
    if ([value isEqualToString:@"hidden"] || [value isEqualToString:@"scroll"]) {
      view.clipsToBounds = YES;
    } else {
      view.clipsToBounds = NO;
    }
    return YES;
  }

  if ([view isKindOfClass:[UILabel class]]) {
    UILabel *label = (UILabel *)view;
    ZynthTextStyleState *state = [self textStateForNode:nodeId];
    if ([name isEqualToString:@"lineHeight"]) {
      state.hasLineHeight = YES;
      state.lineHeight = (CGFloat)[value doubleValue];
      [state applyToLabel:label];
      [[self yogaForNode:nodeId] markDirty:nodeId];
      [self markSurfaceDirtyForNode:nodeId];
      return YES;
    }
    if ([name isEqualToString:@"lineSpacing"]) {
      state.hasLineSpacing = YES;
      state.lineSpacing = (CGFloat)[value doubleValue];
      [state applyToLabel:label];
      [[self yogaForNode:nodeId] markDirty:nodeId];
      [self markSurfaceDirtyForNode:nodeId];
      return YES;
    }
    if ([name isEqualToString:@"paragraphSpacing"]) {
      state.hasParagraphSpacing = YES;
      state.paragraphSpacing = (CGFloat)[value doubleValue];
      [state applyToLabel:label];
      [[self yogaForNode:nodeId] markDirty:nodeId];
      [self markSurfaceDirtyForNode:nodeId];
      return YES;
    }
    if ([name isEqualToString:@"baselineShift"]) {
      state.hasBaselineShift = YES;
      state.baselineShift = (CGFloat)[value doubleValue];
      [state applyToLabel:label];
      [[self yogaForNode:nodeId] markDirty:nodeId];
      [self markSurfaceDirtyForNode:nodeId];
      return YES;
    }
    if ([name isEqualToString:@"letterSpacing"]) {
      state.hasLetterSpacing = YES;
      state.letterSpacing = (CGFloat)[value doubleValue];
      [state applyToLabel:label];
      [[self yogaForNode:nodeId] markDirty:nodeId];
      [self markSurfaceDirtyForNode:nodeId];
      return YES;
    }
    if ([name isEqualToString:@"minimumFontScale"]) {
      state.hasMinimumFontScale = YES;
      state.minimumFontScale = (CGFloat)[value doubleValue];
      [state applyToLabel:label];
      [[self yogaForNode:nodeId] markDirty:nodeId];
      [self markSurfaceDirtyForNode:nodeId];
      return YES;
    }
    if ([name isEqualToString:@"textDecorationLine"]) {
      state.textDecorationLine = value;
      [state applyToLabel:label];
      [[self yogaForNode:nodeId] markDirty:nodeId];
      [self markSurfaceDirtyForNode:nodeId];
      return YES;
    }
    if ([name isEqualToString:@"textTransform"]) {
      state.textTransform = value;
      [state applyToLabel:label];
      [[self yogaForNode:nodeId] markDirty:nodeId];
      [self markSurfaceDirtyForNode:nodeId];
      return YES;
    }
    if ([name isEqualToString:@"hyphenation"]) {
      state.hyphenation = value;
      [state applyToLabel:label];
      [[self yogaForNode:nodeId] markDirty:nodeId];
      [self markSurfaceDirtyForNode:nodeId];
      return YES;
    }
  }

  return NO;
}

- (void)applyStyleLayoutIfNeeded {
  if (_styleDirtyNodes.count == 0) return;
  NSSet<NSNumber *> *dirty = [_styleDirtyNodes copy];
  [_styleDirtyNodes removeAllObjects];
  for (NSNumber *nodeId in dirty) {
    UIView *view = _nodes[nodeId];
    ZynthViewStyleState *state = _styleStates[nodeId];
    if (!view || !state) continue;
    [state applyLayoutToView:view];
  }
}

- (void)applyTextValue:(NSNumber *)nodeId label:(UILabel *)label text:(NSString *)text {
  if (!label) return;
  ZynthTextStyleState *state = _textStyleStates[nodeId];
  if (!state) {
    label.text = text;
    return;
  }
  state.rawText = text;
  [state applyToLabel:label];
}

@end
