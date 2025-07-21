#import "RuneShadowParser.h"
#import "RuneColorParser.h"

static inline UIColor *RuneDefaultShadowColor(void) {
  return [[UIColor blackColor] colorWithAlphaComponent:0.25];
}

@implementation RuneShadowLayer

- (instancetype)initWithOffsetX:(CGFloat)offsetX
                        offsetY:(CGFloat)offsetY
                     blurRadius:(CGFloat)blurRadius
                         spread:(CGFloat)spread
                          color:(UIColor *)color
                          inset:(BOOL)inset {
  if (self = [super init]) {
    _offsetX = offsetX;
    _offsetY = offsetY;
    _blurRadius = blurRadius;
    _spread = spread;
    _color = color ?: RuneDefaultShadowColor();
    _inset = inset;
  }
  return self;
}

@end

@implementation RuneShadowParser

+ (nullable NSArray<RuneShadowLayer *> *)parse:(id)value {
  if (!value || value == (id)kCFNull) return nil;
  if ([value isKindOfClass:[NSString class]]) {
    return [self parseStringList:(NSString *)value];
  }
  if ([value isKindOfClass:[NSArray class]]) {
    NSMutableArray<RuneShadowLayer *> *layers = [NSMutableArray array];
    for (id item in (NSArray *)value) {
      RuneShadowLayer *layer = nil;
      if ([item isKindOfClass:[NSString class]]) {
        layer = [self parseShadowString:(NSString *)item];
      } else if ([item isKindOfClass:[NSDictionary class]]) {
        layer = [self parseObject:(NSDictionary *)item];
      }
      if (layer) [layers addObject:layer];
    }
    return layers.count > 0 ? layers : nil;
  }
  if ([value isKindOfClass:[NSDictionary class]]) {
    RuneShadowLayer *layer = [self parseObject:(NSDictionary *)value];
    return layer ? @[layer] : nil;
  }
  return nil;
}

+ (nullable NSArray<RuneShadowLayer *> *)fromReactNativeColor:(nullable UIColor *)color
                                                      opacity:(nullable NSNumber *)opacity
                                                       radius:(nullable NSNumber *)radius
                                                      offsetX:(nullable NSNumber *)offsetX
                                                      offsetY:(nullable NSNumber *)offsetY {
  if (!color && !opacity && !radius && !offsetX && !offsetY) {
    return nil;
  }
  CGFloat alpha = opacity ? MAX(0.f, MIN(1.f, opacity.doubleValue)) : 0.f;
  UIColor *base = color ?: RuneDefaultShadowColor();
  CGFloat r = 0, g = 0, b = 0, a = 1;
  if (![base getRed:&r green:&g blue:&b alpha:&a]) {
    base = RuneDefaultShadowColor();
    [base getRed:&r green:&g blue:&b alpha:&a];
  }
  UIColor *resolved = [UIColor colorWithRed:r green:g blue:b alpha:a * alpha];

  RuneShadowLayer *layer = [[RuneShadowLayer alloc] initWithOffsetX:(offsetX ? offsetX.doubleValue : 0.f)
                                                            offsetY:(offsetY ? offsetY.doubleValue : 0.f)
                                                         blurRadius:(radius ? radius.doubleValue : 0.f)
                                                             spread:0.f
                                                              color:resolved
                                                              inset:NO];
  return @[layer];
}

+ (nullable NSArray<RuneShadowLayer *> *)merged:(nullable NSArray<RuneShadowLayer *> *)css
                                        fallback:(nullable NSArray<RuneShadowLayer *> *)rn {
  return css.count > 0 ? css : rn;
}

#pragma mark - Helpers

+ (nullable RuneShadowLayer *)parseObject:(NSDictionary *)dict {
  if (![dict isKindOfClass:[NSDictionary class]]) return nil;
  NSNumber *offsetX = [dict[@"offsetX"] isKindOfClass:[NSNumber class]] ? dict[@"offsetX"] : nil;
  NSNumber *offsetY = [dict[@"offsetY"] isKindOfClass:[NSNumber class]] ? dict[@"offsetY"] : nil;
  NSNumber *blur = [dict[@"blurRadius"] isKindOfClass:[NSNumber class]] ? dict[@"blurRadius"] : nil;
  NSNumber *spread = [dict[@"spread"] isKindOfClass:[NSNumber class]] ? dict[@"spread"] : nil;
  NSNumber *insetVal = [dict[@"inset"] isKindOfClass:[NSNumber class]] ? dict[@"inset"] : nil;
  NSString *colorString = [dict[@"color"] isKindOfClass:[NSString class]] ? dict[@"color"] : nil;
  UIColor *color = colorString ? [RuneColorParser parseColor:colorString] : nil;

  return [[RuneShadowLayer alloc] initWithOffsetX:(offsetX ? offsetX.doubleValue : 0.f)
                                         offsetY:(offsetY ? offsetY.doubleValue : 0.f)
                                      blurRadius:(blur ? blur.doubleValue : 0.f)
                                          spread:(spread ? spread.doubleValue : 0.f)
                                           color:color ?: RuneDefaultShadowColor()
                                           inset:(insetVal ? insetVal.boolValue : NO)];
}

+ (NSArray<RuneShadowLayer *> *)parseStringList:(NSString *)value {
  NSMutableArray<RuneShadowLayer *> *layers = [NSMutableArray array];
  for (NSString *part in [self splitByTopLevelCommas:value]) {
    RuneShadowLayer *layer = [self parseShadowString:part];
    if (layer) [layers addObject:layer];
  }
  return layers.count > 0 ? layers : nil;
}

+ (nullable RuneShadowLayer *)parseShadowString:(NSString *)raw {
  if (![raw isKindOfClass:[NSString class]]) return nil;
  NSString *working = [raw stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (working.length == 0) return nil;

  NSRegularExpression *insetRegex = [NSRegularExpression regularExpressionWithPattern:@"\\binset\\b" options:NSRegularExpressionCaseInsensitive error:nil];
  NSTextCheckingResult *insetMatch = [insetRegex firstMatchInString:working options:0 range:NSMakeRange(0, working.length)];
  BOOL inset = insetMatch != nil;
  if (inset) {
    working = [insetRegex stringByReplacingMatchesInString:working options:0 range:NSMakeRange(0, working.length) withTemplate:@""];
    working = [working stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  }

  NSTextCheckingResult *colorMatch = [self firstColorMatch:working];
  UIColor *color = nil;
  if (colorMatch) {
    NSRange range = colorMatch.range;
    NSString *token = [working substringWithRange:range];
    color = [RuneColorParser parseColor:token];
    if (range.location != NSNotFound && range.location + range.length <= working.length) {
      NSMutableString *mutable = working.mutableCopy;
      [mutable replaceCharactersInRange:range withString:@""];
      working = mutable;
    }
    working = [working stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  }

  NSArray<NSString *> *tokens = [[working componentsSeparatedByCharactersInSet:[NSCharacterSet whitespaceCharacterSet]] filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSString *t, NSDictionary *bindings) {
    return t.length > 0;
  }]];

  NSMutableArray<NSNumber *> *lengths = [NSMutableArray array];
  for (NSString *token in tokens) {
    NSNumber *len = [self parseLength:token];
    if (len) {
      [lengths addObject:len];
      continue;
    }
    if (!color) {
      UIColor *parsed = [RuneColorParser parseColor:token];
      if (parsed) color = parsed;
    }
  }

  if (lengths.count < 2) return nil;
  CGFloat offsetX = lengths.count > 0 ? lengths[0].doubleValue : 0.f;
  CGFloat offsetY = lengths.count > 1 ? lengths[1].doubleValue : 0.f;
  CGFloat blur = lengths.count > 2 ? lengths[2].doubleValue : 0.f;
  CGFloat spread = lengths.count > 3 ? lengths[3].doubleValue : 0.f;

  UIColor *resolved = color ?: RuneDefaultShadowColor();
  return [[RuneShadowLayer alloc] initWithOffsetX:offsetX
                                         offsetY:offsetY
                                      blurRadius:blur
                                          spread:spread
                                           color:resolved
                                           inset:inset];
}

+ (NSArray<NSString *> *)splitByTopLevelCommas:(NSString *)value {
  NSMutableArray<NSString *> *parts = [NSMutableArray array];
  NSMutableString *current = [NSMutableString string];
  NSInteger depth = 0;
  for (NSUInteger i = 0; i < value.length; i++) {
    unichar c = [value characterAtIndex:i];
    if (c == '(') depth++;
    else if (c == ')' && depth > 0) depth--;
    if (c == ',' && depth == 0) {
      NSString *trimmed = [current stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
      if (trimmed.length > 0) [parts addObject:trimmed];
      [current setString:@""];
      continue;
    }
    [current appendFormat:@"%C", c];
  }
  NSString *tail = [current stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (tail.length > 0) [parts addObject:tail];
  return parts;
}

+ (nullable NSNumber *)parseLength:(NSString *)token {
  if (![token isKindOfClass:[NSString class]]) return nil;
  NSString *normalized = [token stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (normalized.length == 0) return nil;
  if ([normalized hasSuffix:@"px"]) {
    normalized = [normalized substringToIndex:normalized.length - 2];
  }
  double value = normalized.doubleValue;
  if (isnan(value)) return nil;
  return @(value);
}

+ (nullable NSTextCheckingResult *)firstColorMatch:(NSString *)value {
  static NSRegularExpression *regex;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    regex = [NSRegularExpression regularExpressionWithPattern:@"(#(?:[0-9a-fA-F]{3,8})|rgba?\\([^)]*\\)|hsla?\\([^)]*\\)|hwb\\([^)]*\\))" options:0 error:nil];
  });
  return [regex firstMatchInString:value options:0 range:NSMakeRange(0, value.length)];
}

@end
