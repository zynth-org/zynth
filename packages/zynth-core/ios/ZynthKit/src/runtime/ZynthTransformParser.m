#import "ZynthTransformParser.h"
#import <math.h>

@interface ZynthTransformParser ()
+ (CATransform3D)parseString:(NSString *)string;
+ (double)parseLength:(NSString *)val;
+ (CATransform3D)applyOperation:(NSString *)key value:(id)value toTransform:(CATransform3D)transform;
+ (CGFloat)parseAngle:(id)value;
@end

@implementation ZynthTransformParser

+ (CATransform3D)parse:(id)json {
  CATransform3D transform = CATransform3DIdentity;

  if (!json || [json isKindOfClass:[NSNull class]]) {
    return transform;
  }

  NSArray *array = nil;

  if ([json isKindOfClass:[NSArray class]]) {
    array = (NSArray *)json;
  } else if ([json isKindOfClass:[NSString class]]) {
    NSString *str = [(NSString *)json stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if ([str hasPrefix:@"["]) {
      NSData *data = [str dataUsingEncoding:NSUTF8StringEncoding];
      id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
      if ([parsed isKindOfClass:[NSArray class]]) {
        array = parsed;
      }
    } else {
      return [self parseString:str];
    }
  }

  if (array) {
    for (NSDictionary *op in array) {
      if (![op isKindOfClass:[NSDictionary class]]) continue;
      for (NSString *key in op) {
        transform = [self applyOperation:key value:op[key] toTransform:transform];
      }
    }
  }

  return transform;
}

+ (CATransform3D)parseString:(NSString *)string {
  CATransform3D transform = CATransform3DIdentity;
  NSError *error = nil;
  NSRegularExpression *regex = [NSRegularExpression regularExpressionWithPattern:@"(\\w+)\\(([^)]+)\\)" options:0 error:&error];
  if (error) return transform;

  NSArray *matches = [regex matchesInString:string options:0 range:NSMakeRange(0, string.length)];

  for (NSTextCheckingResult *match in matches) {
    NSString *func = [string substringWithRange:[match rangeAtIndex:1]];
    NSString *argsStr = [string substringWithRange:[match rangeAtIndex:2]];
    NSArray *args = [argsStr componentsSeparatedByString:@","];

    if ([func isEqualToString:@"translate"]) {
      double x = [self parseLength:args.count > 0 ? args[0] : @"0"];
      double y = [self parseLength:args.count > 1 ? args[1] : @"0"];
      transform = CATransform3DTranslate(transform, x, y, 0);
    } else if ([func isEqualToString:@"translateX"]) {
      double val = [self parseLength:args[0]];
      transform = CATransform3DTranslate(transform, val, 0, 0);
    } else if ([func isEqualToString:@"translateY"]) {
      double val = [self parseLength:args[0]];
      transform = CATransform3DTranslate(transform, 0, val, 0);
    } else if ([func isEqualToString:@"scale"]) {
      double x = [args[0] doubleValue];
      double y = args.count > 1 ? [args[1] doubleValue] : x;
      transform = CATransform3DScale(transform, x, y, 1);
    } else if ([func isEqualToString:@"scaleX"]) {
      double val = [args[0] doubleValue];
      transform = CATransform3DScale(transform, val, 1, 1);
    } else if ([func isEqualToString:@"scaleY"]) {
      double val = [args[0] doubleValue];
      transform = CATransform3DScale(transform, 1, val, 1);
    } else if ([func isEqualToString:@"rotate"] || [func isEqualToString:@"rotateZ"]) {
      CGFloat angle = [self parseAngle:args[0]];
      transform = CATransform3DRotate(transform, angle, 0, 0, 1);
    } else if ([func isEqualToString:@"rotateX"]) {
      CGFloat angle = [self parseAngle:args[0]];
      transform = CATransform3DRotate(transform, angle, 1, 0, 0);
    } else if ([func isEqualToString:@"rotateY"]) {
      CGFloat angle = [self parseAngle:args[0]];
      transform = CATransform3DRotate(transform, angle, 0, 1, 0);
    } else if ([func isEqualToString:@"skewX"]) {
      CGFloat angle = [self parseAngle:args[0]];
      CATransform3D skew = CATransform3DIdentity;
      skew.m21 = tan(angle);
      transform = CATransform3DConcat(transform, skew);
    } else if ([func isEqualToString:@"skewY"]) {
      CGFloat angle = [self parseAngle:args[0]];
      CATransform3D skew = CATransform3DIdentity;
      skew.m12 = tan(angle);
      transform = CATransform3DConcat(transform, skew);
    } else if ([func isEqualToString:@"perspective"]) {
      double val = [args[0] doubleValue];
      if (val != 0) {
        transform.m34 = -1.0 / val;
      }
    }
  }

  return transform;
}

+ (double)parseLength:(NSString *)val {
  NSString *s = [val stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if ([s hasSuffix:@"px"]) {
    return [[s substringToIndex:s.length - 2] doubleValue];
  }
  return [s doubleValue];
}

+ (CATransform3D)applyOperation:(NSString *)key value:(id)value toTransform:(CATransform3D)transform {
  if ([key isEqualToString:@"perspective"]) {
    double val = [value doubleValue];
    if (val != 0) {
      transform.m34 = -1.0 / val;
    }
  } else if ([key isEqualToString:@"rotate"] || [key isEqualToString:@"rotateZ"]) {
    CGFloat angle = [self parseAngle:value];
    transform = CATransform3DRotate(transform, angle, 0, 0, 1);
  } else if ([key isEqualToString:@"rotateX"]) {
    CGFloat angle = [self parseAngle:value];
    transform = CATransform3DRotate(transform, angle, 1, 0, 0);
  } else if ([key isEqualToString:@"rotateY"]) {
    CGFloat angle = [self parseAngle:value];
    transform = CATransform3DRotate(transform, angle, 0, 1, 0);
  } else if ([key isEqualToString:@"scale"]) {
    double val = [value doubleValue];
    transform = CATransform3DScale(transform, val, val, 1);
  } else if ([key isEqualToString:@"scaleX"]) {
    double val = [value doubleValue];
    transform = CATransform3DScale(transform, val, 1, 1);
  } else if ([key isEqualToString:@"scaleY"]) {
    double val = [value doubleValue];
    transform = CATransform3DScale(transform, 1, val, 1);
  } else if ([key isEqualToString:@"translateX"]) {
    double val = [value doubleValue];
    transform = CATransform3DTranslate(transform, val, 0, 0);
  } else if ([key isEqualToString:@"translateY"]) {
    double val = [value doubleValue];
    transform = CATransform3DTranslate(transform, 0, val, 0);
  } else if ([key isEqualToString:@"skewX"]) {
    CGFloat angle = [self parseAngle:value];
    CATransform3D skew = CATransform3DIdentity;
    skew.m21 = tan(angle);
    transform = CATransform3DConcat(transform, skew);
  } else if ([key isEqualToString:@"skewY"]) {
    CGFloat angle = [self parseAngle:value];
    CATransform3D skew = CATransform3DIdentity;
    skew.m12 = tan(angle);
    transform = CATransform3DConcat(transform, skew);
  }
  return transform;
}

+ (CGFloat)parseAngle:(id)value {
  if ([value isKindOfClass:[NSNumber class]]) {
    return (CGFloat)([(NSNumber *)value doubleValue] * M_PI / 180.0);
  }
  NSString *str = [[value description] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if ([str hasSuffix:@"rad"]) {
    return (CGFloat)[[str substringToIndex:str.length - 3] doubleValue];
  }
  if ([str hasSuffix:@"deg"]) {
    str = [str substringToIndex:str.length - 3];
  }
  return (CGFloat)([str doubleValue] * M_PI / 180.0);
}

@end
