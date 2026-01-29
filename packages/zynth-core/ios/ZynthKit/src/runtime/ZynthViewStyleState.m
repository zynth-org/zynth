#import "ZynthViewStyleState.h"
#import "ZynthGradientParser.h"
#import "ZynthShadowParser.h"
#import <math.h>

@interface ZynthViewStyleState ()
@property (nonatomic, strong) CAGradientLayer *gradientLayer;
@property (nonatomic, strong) CAShapeLayer *dashBorderLayer;
@property (nonatomic, strong) CALayer *borderTopLayer;
@property (nonatomic, strong) CALayer *borderRightLayer;
@property (nonatomic, strong) CALayer *borderBottomLayer;
@property (nonatomic, strong) CALayer *borderLeftLayer;
@property (nonatomic, strong) CAShapeLayer *maskLayer;
@end

@implementation ZynthViewStyleState

- (void)applyToView:(UIView *)view {
  if (!view) return;
  view.backgroundColor = self.backgroundColor;
  if (self.hasTransform) {
    view.layer.transform = self.transform;
  } else {
    view.layer.transform = CATransform3DIdentity;
  }
  [self applyShadowToView:view];
}

- (void)applyLayoutToView:(UIView *)view {
  if (!view) return;
  [self applyGradientToView:view];
  [self applyMaskToView:view];
  [self applyBordersToView:view];
  [self applyTransformOriginToView:view];
  [self applyShadowPathToView:view];
}

- (void)applyShadowToView:(UIView *)view {
  NSArray<ZynthShadowLayer *> *resolved = self.boxShadow;
  if (!resolved) {
    resolved = [ZynthShadowParser fromReactNativeColor:self.shadowColor
                                               opacity:self.shadowOpacity
                                                radius:self.shadowRadius
                                               offsetX:self.hasShadowOffset ? @(self.shadowOffset.width) : nil
                                               offsetY:self.hasShadowOffset ? @(self.shadowOffset.height) : nil];
  }
  ZynthShadowLayer *layer = resolved.firstObject;
  if (!layer) {
    view.layer.shadowOpacity = 0.0;
    return;
  }

  view.layer.shadowColor = layer.color.CGColor;
  view.layer.shadowOpacity = 1.0;
  view.layer.shadowRadius = layer.blurRadius;
  view.layer.shadowOffset = CGSizeMake(layer.offsetX, layer.offsetY);
  view.layer.masksToBounds = NO;
}

- (void)applyShadowPathToView:(UIView *)view {
  if (view.layer.shadowOpacity <= 0.0) {
    view.layer.shadowPath = nil;
    return;
  }
  UIBezierPath *path = [self roundedRectPathForRect:view.bounds
                                          topLeft:self.borderTopLeftRadius
                                         topRight:self.borderTopRightRadius
                                      bottomRight:self.borderBottomRightRadius
                                       bottomLeft:self.borderBottomLeftRadius];
  view.layer.shadowPath = path.CGPath;
}

- (void)applyGradientToView:(UIView *)view {
  if (!self.backgroundGradient) {
    if (self.gradientLayer) {
      [self.gradientLayer removeFromSuperlayer];
      self.gradientLayer = nil;
    }
    return;
  }

  if (!self.gradientLayer) {
    self.gradientLayer = [CAGradientLayer layer];
    [view.layer insertSublayer:self.gradientLayer atIndex:0];
  }

  self.gradientLayer.frame = view.bounds;
  CGFloat tl = self.borderTopLeftRadius;
  CGFloat tr = self.borderTopRightRadius;
  CGFloat br = self.borderBottomRightRadius;
  CGFloat bl = self.borderBottomLeftRadius;
  if (tl == tr && tl == br && tl == bl && tl > 0) {
    CGFloat maxRadius = MIN(view.bounds.size.width, view.bounds.size.height) / 2.0;
    self.gradientLayer.cornerRadius = MIN(tl, maxRadius);
  } else {
    self.gradientLayer.cornerRadius = 0;
  }
  ZynthLinearGradient *gradient = self.backgroundGradient;
  NSMutableArray *colors = [NSMutableArray array];
  NSMutableArray *locations = [NSMutableArray array];
  for (ZynthGradientStop *stop in gradient.stops) {
    [colors addObject:(id)stop.color.CGColor];
    if (stop.position) {
      [locations addObject:stop.position];
    }
  }
  self.gradientLayer.colors = colors;
  self.gradientLayer.locations = locations.count == colors.count ? locations : nil;

  CGFloat angle = gradient.angle;
  CGFloat radians = (CGFloat)(angle * M_PI / 180.0);
  CGFloat dx = sin(radians);
  CGFloat dy = -cos(radians);
  CGPoint start = CGPointMake(0.5 - dx * 0.5, 0.5 - dy * 0.5);
  CGPoint end = CGPointMake(0.5 + dx * 0.5, 0.5 + dy * 0.5);
  self.gradientLayer.startPoint = start;
  self.gradientLayer.endPoint = end;
}

- (void)applyMaskToView:(UIView *)view {
  CGFloat tl = self.borderTopLeftRadius;
  CGFloat tr = self.borderTopRightRadius;
  CGFloat br = self.borderBottomRightRadius;
  CGFloat bl = self.borderBottomLeftRadius;
  BOOL hasRadius = tl > 0 || tr > 0 || br > 0 || bl > 0;
  BOOL uniformRadius = tl == tr && tl == br && tl == bl;
  BOOL hasShadow = self.boxShadow.count > 0 ||
                   (self.shadowOpacity && self.shadowOpacity.doubleValue > 0.0) ||
                   (self.shadowRadius && self.shadowRadius.doubleValue > 0.0);
  if (!hasRadius) {
    if (self.maskLayer) {
      view.layer.mask = nil;
      self.maskLayer = nil;
    }
    view.layer.cornerRadius = 0;
    return;
  }

  if (uniformRadius && hasShadow) {
    if (self.maskLayer) {
      view.layer.mask = nil;
      self.maskLayer = nil;
    }
    CGFloat maxRadius = MIN(view.bounds.size.width, view.bounds.size.height) / 2.0;
    view.layer.cornerRadius = MIN(tl, maxRadius);
    return;
  }

  CGRect bounds = view.bounds;
  UIBezierPath *path = [self roundedRectPathForRect:bounds
                                          topLeft:tl
                                         topRight:tr
                                      bottomRight:br
                                       bottomLeft:bl];
  if (!self.maskLayer) {
    self.maskLayer = [CAShapeLayer layer];
    view.layer.mask = self.maskLayer;
  }
  self.maskLayer.frame = bounds;
  self.maskLayer.path = path.CGPath;
}

- (UIBezierPath *)roundedRectPathForRect:(CGRect)rect
                                topLeft:(CGFloat)topLeft
                               topRight:(CGFloat)topRight
                            bottomRight:(CGFloat)bottomRight
                             bottomLeft:(CGFloat)bottomLeft {
  CGFloat w = rect.size.width;
  CGFloat h = rect.size.height;
  if (w <= 0 || h <= 0) {
    return [UIBezierPath bezierPathWithRect:rect];
  }
  CGFloat maxRadius = MIN(w, h) / 2.0;
  CGFloat tl = MIN(MAX(0, topLeft), maxRadius);
  CGFloat tr = MIN(MAX(0, topRight), maxRadius);
  CGFloat br = MIN(MAX(0, bottomRight), maxRadius);
  CGFloat bl = MIN(MAX(0, bottomLeft), maxRadius);

  CGFloat minX = CGRectGetMinX(rect);
  CGFloat maxX = CGRectGetMaxX(rect);
  CGFloat minY = CGRectGetMinY(rect);
  CGFloat maxY = CGRectGetMaxY(rect);

  UIBezierPath *path = [UIBezierPath bezierPath];
  [path moveToPoint:CGPointMake(minX + tl, minY)];
  [path addLineToPoint:CGPointMake(maxX - tr, minY)];
  if (tr > 0) {
    [path addArcWithCenter:CGPointMake(maxX - tr, minY + tr)
                    radius:tr
                startAngle:(CGFloat)(-M_PI_2)
                  endAngle:0
                 clockwise:YES];
  }
  [path addLineToPoint:CGPointMake(maxX, maxY - br)];
  if (br > 0) {
    [path addArcWithCenter:CGPointMake(maxX - br, maxY - br)
                    radius:br
                startAngle:0
                  endAngle:(CGFloat)(M_PI_2)
                 clockwise:YES];
  }
  [path addLineToPoint:CGPointMake(minX + bl, maxY)];
  if (bl > 0) {
    [path addArcWithCenter:CGPointMake(minX + bl, maxY - bl)
                    radius:bl
                startAngle:(CGFloat)(M_PI_2)
                  endAngle:(CGFloat)(M_PI)
                 clockwise:YES];
  }
  [path addLineToPoint:CGPointMake(minX, minY + tl)];
  if (tl > 0) {
    [path addArcWithCenter:CGPointMake(minX + tl, minY + tl)
                    radius:tl
                startAngle:(CGFloat)(M_PI)
                  endAngle:(CGFloat)(M_PI * 1.5)
                 clockwise:YES];
  }
  [path closePath];
  return path;
}

- (BOOL)isUniformBorder {
  CGFloat width = self.borderTopWidth;
  UIColor *color = self.borderTopColor;
  if (width <= 0 || !color) return NO;
  if (self.borderRightWidth != width || self.borderBottomWidth != width || self.borderLeftWidth != width) return NO;
  if (self.borderRightColor != color || self.borderBottomColor != color || self.borderLeftColor != color) return NO;
  return YES;
}

- (BOOL)hasDashedStyle {
  return [self.borderStyle isEqualToString:@"dashed"] || [self.borderStyle isEqualToString:@"dotted"];
}

- (void)applyBordersToView:(UIView *)view {
  BOOL hasAnyBorder =
      self.borderTopWidth > 0 || self.borderRightWidth > 0 ||
      self.borderBottomWidth > 0 || self.borderLeftWidth > 0;
  if (!hasAnyBorder) {
    [self clearBorderLayers];
    return;
  }

  BOOL uniformBorder = [self isUniformBorder];
  BOOL dashedStyle = [self hasDashedStyle];
  CGRect bounds = view.bounds;

  if (uniformBorder) {
    [self applyUniformBorder:view dashed:dashedStyle];
    return;
  }

  [self clearDashBorder];
  BOOL hasRadius = self.borderTopLeftRadius > 0 || self.borderTopRightRadius > 0 ||
                   self.borderBottomLeftRadius > 0 || self.borderBottomRightRadius > 0;
  if (hasRadius || dashedStyle) {
    [self applyBorderStrokeLayer:&_borderTopLayer
                           side:@"top"
                          bounds:bounds
                          color:self.borderTopColor
                          width:self.borderTopWidth
                          style:self.borderStyle
                            view:view];
    [self applyBorderStrokeLayer:&_borderBottomLayer
                           side:@"bottom"
                          bounds:bounds
                          color:self.borderBottomColor
                          width:self.borderBottomWidth
                          style:self.borderStyle
                            view:view];
    [self applyBorderStrokeLayer:&_borderRightLayer
                           side:@"right"
                          bounds:bounds
                          color:self.borderRightColor
                          width:self.borderRightWidth
                          style:self.borderStyle
                            view:view];
    [self applyBorderStrokeLayer:&_borderLeftLayer
                           side:@"left"
                          bounds:bounds
                          color:self.borderLeftColor
                          width:self.borderLeftWidth
                          style:self.borderStyle
                            view:view];
  } else {
    [self applyBorderLayer:&_borderTopLayer
                    frame:CGRectMake(0, 0, bounds.size.width, self.borderTopWidth)
                    color:self.borderTopColor
                      view:view];
    [self applyBorderLayer:&_borderRightLayer
                    frame:CGRectMake(bounds.size.width - self.borderRightWidth, 0, self.borderRightWidth, bounds.size.height)
                    color:self.borderRightColor
                      view:view];
    [self applyBorderLayer:&_borderBottomLayer
                    frame:CGRectMake(0, bounds.size.height - self.borderBottomWidth, bounds.size.width, self.borderBottomWidth)
                    color:self.borderBottomColor
                      view:view];
    [self applyBorderLayer:&_borderLeftLayer
                    frame:CGRectMake(0, 0, self.borderLeftWidth, bounds.size.height)
                    color:self.borderLeftColor
                      view:view];
  }
}

- (void)applyUniformBorder:(UIView *)view dashed:(BOOL)dashed {
  if (!self.dashBorderLayer) {
    self.dashBorderLayer = [CAShapeLayer layer];
    [view.layer addSublayer:self.dashBorderLayer];
  }
  CGFloat width = self.borderTopWidth;
  CGRect inset = CGRectInset(view.bounds, width / 2.0, width / 2.0);
  CGFloat tl = MAX(0, self.borderTopLeftRadius - width / 2.0);
  CGFloat tr = MAX(0, self.borderTopRightRadius - width / 2.0);
  CGFloat br = MAX(0, self.borderBottomRightRadius - width / 2.0);
  CGFloat bl = MAX(0, self.borderBottomLeftRadius - width / 2.0);
  UIBezierPath *path = [self roundedRectPathForRect:inset
                                          topLeft:tl
                                         topRight:tr
                                      bottomRight:br
                                       bottomLeft:bl];
  self.dashBorderLayer.frame = view.bounds;
  self.dashBorderLayer.path = path.CGPath;
  self.dashBorderLayer.fillColor = UIColor.clearColor.CGColor;
  self.dashBorderLayer.strokeColor = self.borderTopColor.CGColor;
  self.dashBorderLayer.lineWidth = width;
  if (dashed) {
    if ([self.borderStyle isEqualToString:@"dotted"]) {
      self.dashBorderLayer.lineDashPattern = @[@(width), @(width * 1.5)];
    } else {
      self.dashBorderLayer.lineDashPattern = @[@(width * 3.0), @(width * 2.0)];
    }
  } else {
    self.dashBorderLayer.lineDashPattern = nil;
  }
  [self clearBorderLayers];
}

- (void)applyBorderLayer:(CALayer * __strong *)layer
                  frame:(CGRect)frame
                  color:(UIColor *)color
                    view:(UIView *)view {
  if (!color || frame.size.width <= 0 || frame.size.height <= 0) {
    if (*layer) {
      [*layer removeFromSuperlayer];
      *layer = nil;
    }
    return;
  }
  if (!*layer) {
    *layer = [CALayer layer];
  }
  (*layer).backgroundColor = color.CGColor;
  (*layer).frame = frame;
  if (!(*layer).superlayer) {
    [*layer setNeedsDisplay];
    [(*layer) removeFromSuperlayer];
  }
  if (!(*layer).superlayer) {
    [view.layer addSublayer:*layer];
  }
}

- (void)applyBorderStrokeLayer:(CALayer * __strong *)layer
                          side:(NSString *)side
                        bounds:(CGRect)bounds
                        color:(UIColor *)color
                        width:(CGFloat)width
                        style:(NSString *)style
                          view:(UIView *)view {
  if (!color || width <= 0) {
    if (*layer) {
      [*layer removeFromSuperlayer];
      *layer = nil;
    }
    return;
  }

  CAShapeLayer *shape = nil;
  if (*layer && [*layer isKindOfClass:[CAShapeLayer class]]) {
    shape = (CAShapeLayer *)*layer;
  } else {
    shape = [CAShapeLayer layer];
    *layer = shape;
  }

  shape.frame = bounds;
  shape.fillColor = UIColor.clearColor.CGColor;
  shape.strokeColor = color.CGColor;
  shape.lineWidth = width;
  if ([style isEqualToString:@"dotted"]) {
    shape.lineDashPattern = @[@(width), @(width * 1.5)];
  } else if ([style isEqualToString:@"dashed"]) {
    shape.lineDashPattern = @[@(width * 3.0), @(width * 2.0)];
  } else {
    shape.lineDashPattern = nil;
  }

  CGFloat maxRadius = MIN(bounds.size.width, bounds.size.height) / 2.0;
  CGFloat tl = MIN(self.borderTopLeftRadius, maxRadius);
  CGFloat tr = MIN(self.borderTopRightRadius, maxRadius);
  CGFloat br = MIN(self.borderBottomRightRadius, maxRadius);
  CGFloat bl = MIN(self.borderBottomLeftRadius, maxRadius);

  UIBezierPath *path = [UIBezierPath bezierPath];
  CGFloat minX = CGRectGetMinX(bounds);
  CGFloat maxX = CGRectGetMaxX(bounds);
  CGFloat minY = CGRectGetMinY(bounds);
  CGFloat maxY = CGRectGetMaxY(bounds);

  if ([side isEqualToString:@"top"]) {
    CGFloat y = minY + width / 2.0;
    [path moveToPoint:CGPointMake(minX + tl, y)];
    [path addLineToPoint:CGPointMake(maxX - tr, y)];
    if (tr > 0) {
      [path addArcWithCenter:CGPointMake(maxX - tr, minY + tr)
                      radius:tr
                  startAngle:(CGFloat)(-M_PI_2)
                    endAngle:0
                   clockwise:YES];
    }
    if (tl > 0) {
      [path moveToPoint:CGPointMake(minX + tl, y)];
      [path addArcWithCenter:CGPointMake(minX + tl, minY + tl)
                      radius:tl
                  startAngle:(CGFloat)(-M_PI_2)
                    endAngle:(CGFloat)(-M_PI)
                   clockwise:NO];
    }
  } else if ([side isEqualToString:@"bottom"]) {
    CGFloat y = maxY - width / 2.0;
    [path moveToPoint:CGPointMake(minX + bl, y)];
    [path addLineToPoint:CGPointMake(maxX - br, y)];
    if (br > 0) {
      [path addArcWithCenter:CGPointMake(maxX - br, maxY - br)
                      radius:br
                  startAngle:(CGFloat)(M_PI_2)
                    endAngle:0
                   clockwise:NO];
    }
    if (bl > 0) {
      [path moveToPoint:CGPointMake(minX + bl, y)];
      [path addArcWithCenter:CGPointMake(minX + bl, maxY - bl)
                      radius:bl
                  startAngle:(CGFloat)(M_PI_2)
                    endAngle:(CGFloat)(M_PI)
                   clockwise:YES];
    }
  } else if ([side isEqualToString:@"left"]) {
    CGFloat x = minX + width / 2.0;
    [path moveToPoint:CGPointMake(x, minY + tl)];
    [path addLineToPoint:CGPointMake(x, maxY - bl)];
    if (tl > 0) {
      [path addArcWithCenter:CGPointMake(minX + tl, minY + tl)
                      radius:tl
                  startAngle:(CGFloat)(-M_PI)
                    endAngle:(CGFloat)(-M_PI_2)
                   clockwise:YES];
    }
    if (bl > 0) {
      [path moveToPoint:CGPointMake(x, maxY - bl)];
      [path addArcWithCenter:CGPointMake(minX + bl, maxY - bl)
                      radius:bl
                  startAngle:(CGFloat)(M_PI)
                    endAngle:(CGFloat)(M_PI_2)
                   clockwise:NO];
    }
  } else if ([side isEqualToString:@"right"]) {
    CGFloat x = maxX - width / 2.0;
    [path moveToPoint:CGPointMake(x, minY + tr)];
    [path addLineToPoint:CGPointMake(x, maxY - br)];
    if (tr > 0) {
      [path addArcWithCenter:CGPointMake(maxX - tr, minY + tr)
                      radius:tr
                  startAngle:0
                    endAngle:(CGFloat)(-M_PI_2)
                   clockwise:NO];
    }
    if (br > 0) {
      [path moveToPoint:CGPointMake(x, maxY - br)];
      [path addArcWithCenter:CGPointMake(maxX - br, maxY - br)
                      radius:br
                  startAngle:0
                    endAngle:(CGFloat)(M_PI_2)
                   clockwise:YES];
    }
  }

  shape.path = path.CGPath;
  if (!shape.superlayer) {
    [view.layer addSublayer:shape];
  }
}

- (void)applyTransformOriginToView:(UIView *)view {
  if (self.transformOrigin.length == 0) return;
  CGSize size = view.bounds.size;
  if (size.width <= 0 || size.height <= 0) return;
  CGPoint anchor = [self parseOrigin:self.transformOrigin size:size];
  CGPoint oldAnchor = view.layer.anchorPoint;
  if (CGPointEqualToPoint(anchor, oldAnchor)) return;
  CGPoint position = view.layer.position;
  position.x += (anchor.x - oldAnchor.x) * size.width;
  position.y += (anchor.y - oldAnchor.y) * size.height;
  view.layer.anchorPoint = anchor;
  view.layer.position = position;
}

- (CGPoint)parseOrigin:(NSString *)value size:(CGSize)size {
  NSString *trimmed = [value stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  NSArray<NSString *> *parts = [trimmed componentsSeparatedByCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
  NSMutableArray<NSString *> *tokens = [NSMutableArray array];
  for (NSString *part in parts) {
    if (part.length > 0) [tokens addObject:part];
  }
  if (tokens.count == 0) return CGPointMake(0.5, 0.5);
  if (tokens.count == 1) {
    NSString *t = tokens[0];
    if ([t isEqualToString:@"center"]) return CGPointMake(0.5, 0.5);
    if ([t isEqualToString:@"left"]) return CGPointMake(0, 0.5);
    if ([t isEqualToString:@"right"]) return CGPointMake(1, 0.5);
    if ([t isEqualToString:@"top"]) return CGPointMake(0.5, 0);
    if ([t isEqualToString:@"bottom"]) return CGPointMake(0.5, 1);
  }
  NSString *xToken = tokens.count > 0 ? tokens[0] : @"50%";
  NSString *yToken = tokens.count > 1 ? tokens[1] : @"50%";
  CGFloat x = [self parseOriginValue:xToken axis:size.width];
  CGFloat y = [self parseOriginValue:yToken axis:size.height];
  return CGPointMake(x, y);
}

- (CGFloat)parseOriginValue:(NSString *)token axis:(CGFloat)axis {
  NSString *lower = [token lowercaseString];
  if ([lower isEqualToString:@"left"] || [lower isEqualToString:@"top"]) return 0;
  if ([lower isEqualToString:@"center"]) return 0.5;
  if ([lower isEqualToString:@"right"] || [lower isEqualToString:@"bottom"]) return 1.0;
  if ([lower hasSuffix:@"%"]) {
    CGFloat v = [[lower substringToIndex:lower.length - 1] doubleValue] / 100.0;
    return fmax(0.0, fmin(1.0, v));
  }
  CGFloat px = [lower doubleValue];
  if (axis <= 0) return 0.5;
  return fmax(0.0, fmin(1.0, px / axis));
}

- (void)clearBorderLayers {
  if (self.borderTopLayer) { [self.borderTopLayer removeFromSuperlayer]; self.borderTopLayer = nil; }
  if (self.borderRightLayer) { [self.borderRightLayer removeFromSuperlayer]; self.borderRightLayer = nil; }
  if (self.borderBottomLayer) { [self.borderBottomLayer removeFromSuperlayer]; self.borderBottomLayer = nil; }
  if (self.borderLeftLayer) { [self.borderLeftLayer removeFromSuperlayer]; self.borderLeftLayer = nil; }
}

- (void)clearDashBorder {
  if (self.dashBorderLayer) {
    [self.dashBorderLayer removeFromSuperlayer];
    self.dashBorderLayer = nil;
  }
}

@end
