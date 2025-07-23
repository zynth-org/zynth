#import "RuneGradientParser.h"
#import "RuneColorParser.h"
#import <math.h>

static NSArray<NSString *> *SNRuneSplitGradientArgs(NSString *raw) {
  NSMutableArray<NSString *> *parts = [NSMutableArray array];
  NSMutableString *current = [NSMutableString string];
  NSInteger depth = 0;
  for (NSUInteger i = 0; i < raw.length; i++) {
    unichar c = [raw characterAtIndex:i];
    if (c == ',') {
      if (depth == 0) {
        NSString *trimmed = [current stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
        if (trimmed.length) [parts addObject:trimmed];
        [current setString:@""];
      } else {
        [current appendFormat:@"%C", c];
      }
    } else if (c == '(') {
      depth++;
      [current appendFormat:@"%C", c];
    } else if (c == ')') {
      if (depth > 0) depth--;
      [current appendFormat:@"%C", c];
    } else {
      [current appendFormat:@"%C", c];
    }
  }
  NSString *final = [current stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (final.length) [parts addObject:final];
  return parts;
}

static CGFloat SNRuneNormalizeAngle(CGFloat angle) {
  CGFloat a = fmod(angle, 360.0);
  if (a < 0) a += 360.0;
  return a;
}

static CGFloat SNRuneParseDirection(NSString *dir, BOOL *ok) {
  NSArray<NSString *> *parts = [[dir lowercaseString] componentsSeparatedByCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
  NSNumber *vertical = nil;
  NSNumber *horizontal = nil;
  for (NSString *p in parts) {
    if (!p.length) continue;
    if ([p isEqualToString:@"top"]) vertical = @(0.f);
    else if ([p isEqualToString:@"bottom"]) vertical = @(180.f);
    else if ([p isEqualToString:@"left"]) horizontal = @(270.f);
    else if ([p isEqualToString:@"right"]) horizontal = @(90.f);
  }
  if (vertical && horizontal) {
    *ok = YES;
    if (vertical.floatValue == 0.f && horizontal.floatValue == 90.f) return 45.f;
    if (vertical.floatValue == 0.f && horizontal.floatValue == 270.f) return 315.f;
    if (vertical.floatValue == 180.f && horizontal.floatValue == 90.f) return 135.f;
    if (vertical.floatValue == 180.f && horizontal.floatValue == 270.f) return 225.f;
    return vertical.floatValue;
  }
  if (vertical) { *ok = YES; return vertical.floatValue; }
  if (horizontal) { *ok = YES; return horizontal.floatValue; }
  *ok = NO;
  return 0.f;
}

static CGFloat SNRuneParseAngleToken(NSString *token, BOOL *ok) {
  NSString *trimmed = [token stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if ([trimmed hasPrefix:@"to "]) {
    BOOL dirOk = NO;
    CGFloat angle = SNRuneParseDirection([trimmed substringFromIndex:3], &dirOk);
    *ok = dirOk;
    return angle;
  }

  NSRegularExpression *regex = [NSRegularExpression regularExpressionWithPattern:@"^(-?[0-9.]+)(deg|rad|turn)?$" options:NSRegularExpressionCaseInsensitive error:nil];
  NSTextCheckingResult *match = [regex firstMatchInString:trimmed options:0 range:NSMakeRange(0, trimmed.length)];
  if (!match) { *ok = NO; return 0.f; }

  NSString *valueString = [trimmed substringWithRange:[match rangeAtIndex:1]];
  NSString *unit = match.numberOfRanges > 2 ? [[trimmed substringWithRange:[match rangeAtIndex:2]] lowercaseString] : @"";
  CGFloat value = valueString.doubleValue;
  *ok = YES;
  if (unit.length == 0 || [unit isEqualToString:@"deg"]) return value;
  if ([unit isEqualToString:@"rad"]) return (CGFloat)(value * 180.0 / M_PI);
  if ([unit isEqualToString:@"turn"]) return (CGFloat)(value * 360.0);
  *ok = NO;
  return 0.f;
}

static NSNumber *_Nullable SNRuneParsePosition(NSString *raw) {
  NSString *trimmed = [raw stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if ([trimmed hasSuffix:@"%"]) {
    CGFloat v = [[trimmed substringToIndex:trimmed.length - 1] doubleValue] / 100.0;
    v = fmax(0.f, fmin(1.f, v));
    return @(v);
  }
  double v = trimmed.doubleValue;
  if (isnan(v)) return nil;
  if (fabs(v) > 1.0) v = v / 100.0;
  v = fmax(0.f, fmin(1.f, v));
  return @(v);
}

static RuneGradientStop *_Nullable SNRuneParseStop(NSString *token) {
  NSString *trimmed = [token stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (!trimmed.length) return nil;

  NSInteger depth = 0;
  NSInteger splitIndex = -1;
  for (NSUInteger i = 0; i < trimmed.length; i++) {
    unichar c = [trimmed characterAtIndex:i];
    if (c == '(') depth++;
    else if (c == ')' && depth > 0) depth--;
    else if ((c == ' ' || c == '\t') && depth == 0) { splitIndex = (NSInteger)i; break; }
  }

  NSString *colorPart = splitIndex == -1 ? trimmed : [trimmed substringToIndex:(NSUInteger)splitIndex];
  NSString *positionPart = splitIndex == -1 ? nil : [trimmed substringFromIndex:(NSUInteger)splitIndex];

  UIColor *color = [RuneColorParser parseColor:[colorPart stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]]];
  if (!color) return nil;
  NSNumber *pos = positionPart ? SNRuneParsePosition(positionPart) : nil;
  return [[RuneGradientStop alloc] initWithColor:color position:pos];
}

@implementation RuneGradientStop

- (instancetype)initWithColor:(UIColor *)color position:(NSNumber *)position {
  if (self = [super init]) {
    _color = color;
    _position = position;
  }
  return self;
}

@end

@implementation RuneLinearGradient

- (instancetype)initWithAngle:(CGFloat)angle stops:(NSArray<RuneGradientStop *> *)stops {
  if (self = [super init]) {
    _angle = angle;
    _stops = stops;
  }
  return self;
}

@end

@implementation RuneGradientParser

+ (nullable RuneLinearGradient *)parse:(id)value {
  NSString *raw = nil;
  id candidate = value;
  if ([candidate isKindOfClass:[NSString class]]) {
    NSString *trimmed = [(NSString *)candidate stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if ([trimmed hasPrefix:@"["]) {
      NSData *data = [trimmed dataUsingEncoding:NSUTF8StringEncoding];
      id json = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
      if ([json isKindOfClass:[NSArray class]]) {
        candidate = json;
      }
    }
  }

  if ([candidate isKindOfClass:[NSArray class]]) {
    id first = [(NSArray *)candidate firstObject];
    if ([first isKindOfClass:[NSString class]]) raw = (NSString *)first;
  } else if ([candidate isKindOfClass:[NSString class]]) {
    raw = (NSString *)candidate;
  } else if ([candidate respondsToSelector:@selector(description)]) {
    raw = [[candidate description] copy];
  }
  if (raw.length == 0) return nil;
  NSString *trimmed = [raw stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (![trimmed length] || ![[trimmed lowercaseString] hasPrefix:@"linear-gradient"]) return nil;

  NSRange open = [trimmed rangeOfString:@"("];
  NSRange close = [trimmed rangeOfString:@")" options:NSBackwardsSearch];
  if (open.location == NSNotFound || close.location == NSNotFound || close.location <= open.location) return nil;
  NSString *inside = [trimmed substringWithRange:NSMakeRange(open.location + 1, close.location - open.location - 1)];
  NSArray<NSString *> *tokens = SNRuneSplitGradientArgs(inside);
  if (tokens.count < 2) return nil;

  CGFloat angle = 180.f;
  NSUInteger startIndex = 0;
  BOOL angleOk = NO;
  angle = SNRuneParseAngleToken(tokens.firstObject, &angleOk);
  if (angleOk) {
    startIndex = 1;
  } else {
    angle = 180.f;
  }

  NSMutableArray<RuneGradientStop *> *stops = [NSMutableArray array];
  for (NSUInteger i = startIndex; i < tokens.count; i++) {
    RuneGradientStop *stop = SNRuneParseStop(tokens[i]);
    if (stop) [stops addObject:stop];
  }
  if (stops.count < 2) return nil;

  return [[RuneLinearGradient alloc] initWithAngle:SNRuneNormalizeAngle(angle) stops:stops];
}

@end
