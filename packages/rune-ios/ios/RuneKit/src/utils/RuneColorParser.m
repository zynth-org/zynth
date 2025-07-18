#import "RuneColorParser.h"

@implementation RuneColorParser

static NSDictionary<NSString *, NSNumber *> *namedColors;

+ (void)initialize {
  if (self == [RuneColorParser class]) {
    namedColors = @{
      @"aliceblue": @0xf0f8ff,
      @"antiquewhite": @0xfaebd7,
      @"aqua": @0x00ffff,
      @"aquamarine": @0x7fffd4,
      @"azure": @0xf0ffff,
      @"beige": @0xf5f5dc,
      @"bisque": @0xffe4c4,
      @"black": @0x000000,
      @"blanchedalmond": @0xffebcd,
      @"blue": @0x0000ff,
      @"blueviolet": @0x8a2be2,
      @"brown": @0xa52a2a,
      @"burlywood": @0xdeb887,
      @"cadetblue": @0x5f9ea0,
      @"chartreuse": @0x7fff00,
      @"chocolate": @0xd2691e,
      @"coral": @0xff7f50,
      @"cornflowerblue": @0x6495ed,
      @"cornsilk": @0xfff8dc,
      @"crimson": @0xdc143c,
      @"cyan": @0x00ffff,
      @"darkblue": @0x00008b,
      @"darkcyan": @0x008b8b,
      @"darkgoldenrod": @0xb8860b,
      @"darkgray": @0xa9a9a9,
      @"darkgreen": @0x006400,
      @"darkgrey": @0xa9a9a9,
      @"darkkhaki": @0xbdb76b,
      @"darkmagenta": @0x8b008b,
      @"darkolivegreen": @0x556b2f,
      @"darkorange": @0xff8c00,
      @"darkorchid": @0x9932cc,
      @"darkred": @0x8b0000,
      @"darksalmon": @0xe9967a,
      @"darkseagreen": @0x8fbc8f,
      @"darkslateblue": @0x483d8b,
      @"darkslategrey": @0x2f4f4f,
      @"darkturquoise": @0x00ced1,
      @"darkviolet": @0x9400d3,
      @"deeppink": @0xff1493,
      @"deepskyblue": @0x00bfff,
      @"dimgray": @0x696969,
      @"dimgrey": @0x696969,
      @"dodgerblue": @0x1e90ff,
      @"firebrick": @0xb22222,
      @"floralwhite": @0xfffaf0,
      @"forestgreen": @0x228b22,
      @"fuchsia": @0xff00ff,
      @"gainsboro": @0xdcdcdc,
      @"ghostwhite": @0xf8f8ff,
      @"gold": @0xffd700,
      @"goldenrod": @0xdaa520,
      @"gray": @0x808080,
      @"green": @0x008000,
      @"greenyellow": @0xadff2f,
      @"grey": @0x808080,
      @"honeydew": @0xf0fff0,
      @"hotpink": @0xff69b4,
      @"indianred": @0xcd5c5c,
      @"indigo": @0x4b0082,
      @"ivory": @0xfffff0,
      @"khaki": @0xf0e68c,
      @"lavender": @0xe6e6fa,
      @"lavenderblush": @0xfff0f5,
      @"lawngreen": @0x7cfc00,
      @"lemonchiffon": @0xfffacd,
      @"lightblue": @0xadd8e6,
      @"lightcoral": @0xf08080,
      @"lightcyan": @0xe0ffff,
      @"lightgoldenrodyellow": @0xfafad2,
      @"lightgray": @0xd3d3d3,
      @"lightgreen": @0x90ee90,
      @"lightgrey": @0xd3d3d3,
      @"lightpink": @0xffb6c1,
      @"lightsalmon": @0xffa07a,
      @"lightseagreen": @0x20b2aa,
      @"lightskyblue": @0x87cefa,
      @"lightslategrey": @0x778899,
      @"lightsteelblue": @0xb0c4de,
      @"lightyellow": @0xffffe0,
      @"lime": @0x00ff00,
      @"limegreen": @0x32cd32,
      @"linen": @0xfaf0e6,
      @"magenta": @0xff00ff,
      @"maroon": @0x800000,
      @"mediumaquamarine": @0x66cdaa,
      @"mediumblue": @0x0000cd,
      @"mediumorchid": @0xba55d3,
      @"mediumpurple": @0x9370db,
      @"mediumseagreen": @0x3cb371,
      @"mediumslateblue": @0x7b68ee,
      @"mediumspringgreen": @0x00fa9a,
      @"mediumturquoise": @0x48d1cc,
      @"mediumvioletred": @0xc71585,
      @"midnightblue": @0x191970,
      @"mintcream": @0xf5fffa,
      @"mistyrose": @0xffe4e1,
      @"moccasin": @0xffe4b5,
      @"navajowhite": @0xffdead,
      @"navy": @0x000080,
      @"oldlace": @0xfdf5e6,
      @"olive": @0x808000,
      @"olivedrab": @0x6b8e23,
      @"orange": @0xffa500,
      @"orangered": @0xff4500,
      @"orchid": @0xda70d6,
      @"palegoldenrod": @0xeee8aa,
      @"palegreen": @0x98fb98,
      @"paleturquoise": @0xafeeee,
      @"palevioletred": @0xdb7093,
      @"papayawhip": @0xffefd5,
      @"peachpuff": @0xffdab9,
      @"peru": @0xcd853f,
      @"pink": @0xffc0cb,
      @"plum": @0xdda0dd,
      @"powderblue": @0xb0e0e6,
      @"purple": @0x800080,
      @"rebeccapurple": @0x663399,
      @"red": @0xff0000,
      @"rosybrown": @0xbc8f8f,
      @"royalblue": @0x4169e1,
      @"saddlebrown": @0x8b4513,
      @"salmon": @0xfa8072,
      @"sandybrown": @0xf4a460,
      @"seagreen": @0x2e8b57,
      @"seashell": @0xfff5ee,
      @"sienna": @0xa0522d,
      @"silver": @0xc0c0c0,
      @"skyblue": @0x87ceeb,
      @"slateblue": @0x6a5acd,
      @"slategray": @0x708090,
      @"snow": @0xfffafa,
      @"springgreen": @0x00ff7f,
      @"steelblue": @0x4682b4,
      @"tan": @0xd2b48c,
      @"teal": @0x008080,
      @"thistle": @0xd8bfd8,
      @"tomato": @0xff6347,
      @"turquoise": @0x40e0d0,
      @"violet": @0xee82ee,
      @"wheat": @0xf5deb3,
      @"white": @0xffffffff,
      @"whitesmoke": @0xf5f5f5,
      @"yellow": @0xffff00,
      @"yellowgreen": @0x9acd32,
      @"transparent": @-1 // Special marker
    };
  }
}

+ (nullable UIColor *)parseColor:(NSString *)colorString {
  if (!colorString || colorString.length == 0) return nil;
  NSString *trimmed = [colorString stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (trimmed.length == 0) return nil;

  // 1. Hex
  if ([trimmed hasPrefix:@"#"]) {
    return [self parseHex:trimmed];
  }

  // 2. Named Colors
  NSString *lower = [trimmed lowercaseString];
  NSNumber *namedValue = namedColors[lower];
  if (namedValue) {
    NSInteger v = [namedValue integerValue];
    if (v == -1) return [UIColor clearColor]; // Transparent
    return [self colorFromInt:v alpha:1.0];
  }

  // 3. Functional Syntax
  if ([lower hasPrefix:@"rgb"]) {
    return [self parseRGB:trimmed];
  }
  if ([lower hasPrefix:@"hsl"]) {
    return [self parseHSL:trimmed];
  }
  if ([lower hasPrefix:@"hwb"]) {
    return [self parseHWB:trimmed];
  }

  return nil;
}

+ (UIColor *)parseHex:(NSString *)hex {
  NSString *clean = [hex substringFromIndex:1];
  if (clean.length == 3) {
    // #RGB
    NSString *r = [clean substringWithRange:NSMakeRange(0, 1)];
    NSString *g = [clean substringWithRange:NSMakeRange(1, 1)];
    NSString *b = [clean substringWithRange:NSMakeRange(2, 1)];
    clean = [NSString stringWithFormat:@"%@%@%@%@%@%@FF", r, r, g, g, b, b];
  } else if (clean.length == 4) {
    // #RGBA
    NSString *r = [clean substringWithRange:NSMakeRange(0, 1)];
    NSString *g = [clean substringWithRange:NSMakeRange(1, 1)];
    NSString *b = [clean substringWithRange:NSMakeRange(2, 1)];
    NSString *a = [clean substringWithRange:NSMakeRange(3, 1)];
    clean = [NSString stringWithFormat:@"%@%@%@%@%@%@%@%@", r, r, g, g, b, b, a, a];
  } else if (clean.length == 6) {
    // #RRGGBB
    clean = [clean stringByAppendingString:@"FF"];
  }
  
  if (clean.length != 8) return nil;
  
  unsigned long long val = 0;
  [[NSScanner scannerWithString:clean] scanHexLongLong:&val];
  
  CGFloat r = ((val & 0xFF000000) >> 24) / 255.0;
  CGFloat g = ((val & 0x00FF0000) >> 16) / 255.0;
  CGFloat b = ((val & 0x0000FF00) >> 8) / 255.0;
  CGFloat a = (val & 0x000000FF) / 255.0;
  
  return [UIColor colorWithRed:r green:g blue:b alpha:a];
}

+ (UIColor *)colorFromInt:(NSInteger)val alpha:(CGFloat)alpha {
  CGFloat r = ((val & 0xFF0000) >> 16) / 255.0;
  CGFloat g = ((val & 0x00FF00) >> 8) / 255.0;
  CGFloat b = (val & 0x0000FF) / 255.0;
  return [UIColor colorWithRed:r green:g blue:b alpha:alpha];
}

+ (NSArray<NSString *> *)extractComponents:(NSString *)str {
  NSRange start = [str rangeOfString:@"("];
  NSRange end = [str rangeOfString:@")" options:NSBackwardsSearch];
  if (start.location == NSNotFound || end.location == NSNotFound) return nil;
  
  NSString *content = [str substringWithRange:NSMakeRange(start.location + 1, end.location - start.location - 1)];
  // Handle comma or slash or space delimiters
  // Normalize: replace / with comma, space with comma
  content = [content stringByReplacingOccurrencesOfString:@"/" withString:@","];
  
  // Split by comma
  NSArray *parts = [content componentsSeparatedByString:@","];
  NSMutableArray *cleaned = [NSMutableArray new];
  for (NSString *part in parts) {
    NSString *t = [part stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
    if (t.length > 0) {
      [cleaned addObject:t];
    }
  }
  
  // If split by comma failed (maybe space separated), try splitting by space
  if (cleaned.count < 3) {
      cleaned = [NSMutableArray new];
      NSArray *spaceParts = [content componentsSeparatedByCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
      for (NSString *part in spaceParts) {
          if (part.length > 0 && ![part isEqualToString:@","]) {
              [cleaned addObject:part];
          }
      }
  }
  return cleaned;
}

+ (CGFloat)parseAlpha:(NSString *)str {
  if ([str hasSuffix:@"%"]) {
    return [str floatValue] / 100.0;
  }
  return [str floatValue];
}

+ (CGFloat)parseAngle:(NSString *)str {
  CGFloat val = [str floatValue];
  // If unit is radians/grad/turn handling could be added, assuming deg or unitless for now
  return val;
}

+ (UIColor *)parseRGB:(NSString *)str {
  NSArray *comps = [self extractComponents:str];
  if (comps.count < 3) return nil;
  
  CGFloat r = [comps[0] floatValue] / 255.0;
  CGFloat g = [comps[1] floatValue] / 255.0;
  CGFloat b = [comps[2] floatValue] / 255.0;
  CGFloat a = 1.0;
  if (comps.count > 3) a = [self parseAlpha:comps[3]];
  
  return [UIColor colorWithRed:r green:g blue:b alpha:a];
}

+ (UIColor *)parseHSL:(NSString *)str {
  NSArray *comps = [self extractComponents:str];
  if (comps.count < 3) return nil;
  
  CGFloat h = [self parseAngle:comps[0]] / 360.0;
  CGFloat s = [self parseAlpha:comps[1]]; // Handles %
  CGFloat l = [self parseAlpha:comps[2]]; // Handles %
  CGFloat a = 1.0;
  if (comps.count > 3) a = [self parseAlpha:comps[3]];
  
  return [UIColor colorWithHue:h saturation:s brightness:l alpha:a]; 
  // Wait, UIColor HSB is not HSL. Need HSL -> HSB/RGB conversion.
  // Standard algorithm:
  CGFloat t2 = l <= 0.5 ? l * (s + 1) : l + s - (l * s);
  CGFloat t1 = l * 2 - t2;
  
  CGFloat (^hueToRgb)(CGFloat, CGFloat, CGFloat) = ^(CGFloat p, CGFloat q, CGFloat t) {
      if(t < 0) t += 1;
      if(t > 1) t -= 1;
      if(t < 1/6.0) return p + (q - p) * 6 * t;
      if(t < 1/2.0) return q;
      if(t < 2/3.0) return p + (q - p) * (2/3.0 - t) * 6;
      return p;
  };
  
  CGFloat r = hueToRgb(t1, t2, h + 1/3.0);
  CGFloat gr = hueToRgb(t1, t2, h);
  CGFloat bl = hueToRgb(t1, t2, h - 1/3.0);
  
  return [UIColor colorWithRed:r green:gr blue:bl alpha:a];
}

+ (UIColor *)parseHWB:(NSString *)str {
  // HWB conversion
  NSArray *comps = [self extractComponents:str];
  if (comps.count < 3) return nil;
  
  CGFloat h = [self parseAngle:comps[0]] / 360.0;
  CGFloat w = [self parseAlpha:comps[1]];
  CGFloat b = [self parseAlpha:comps[2]];
  CGFloat a = 1.0;
  if (comps.count > 3) a = [self parseAlpha:comps[3]];
  
  if (w + b >= 1) {
    CGFloat gray = w / (w + b);
    return [UIColor colorWithRed:gray green:gray blue:gray alpha:a];
  }
  
  // HWB -> RGB
  // rgb = hsl(h, 100%, 50%) * (1 - w - b) + w
  // HSV to RGB where S=1 V=1 is fully saturated
  // Let's just use the hueToRgb helper logic again for pure hue
  CGFloat t2 = 1.0; // L=0.5 S=1.0 -> q=1
  CGFloat t1 = 0.0;
  
  CGFloat (^hueToRgb)(CGFloat, CGFloat, CGFloat) = ^(CGFloat p, CGFloat q, CGFloat t) {
      if(t < 0) t += 1;
      if(t > 1) t -= 1;
      if(t < 1/6.0) return p + (q - p) * 6 * t;
      if(t < 1/2.0) return q;
      if(t < 2/3.0) return p + (q - p) * (2/3.0 - t) * 6;
      return p;
  };
  
  CGFloat r = hueToRgb(t1, t2, h + 1/3.0);
  CGFloat gr = hueToRgb(t1, t2, h);
  CGFloat bl = hueToRgb(t1, t2, h - 1/3.0);
  
  r = r * (1 - w - b) + w;
  gr = gr * (1 - w - b) + w;
  bl = bl * (1 - w - b) + w;
  
  return [UIColor colorWithRed:r green:gr blue:bl alpha:a];
}

@end
