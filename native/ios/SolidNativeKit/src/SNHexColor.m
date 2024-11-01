#import "SNHexColor.h"

UIColor *SNColorFromHex(NSString *hex) {
  NSString *s = [hex stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if ([s hasPrefix:@"#"]) s = [s substringFromIndex:1];
  if (s.length != 6 && s.length != 8) return nil;
  unsigned long long v = 0; [[NSScanner scannerWithString:s] scanHexLongLong:&v];
  CGFloat a = s.length == 8 ? ((v & 0xFF000000) >> 24) / 255.0 : 1.0;
  CGFloat r = ((v & 0x00FF0000) >> 16) / 255.0;
  CGFloat g = ((v & 0x0000FF00) >> 8) / 255.0;
  CGFloat b = (v & 0x000000FF) / 255.0;
  return [UIColor colorWithRed:r green:g blue:b alpha:a];
}

