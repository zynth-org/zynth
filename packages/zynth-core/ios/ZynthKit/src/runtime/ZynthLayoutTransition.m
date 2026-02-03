#import "ZynthLayoutTransition.h"

@implementation ZynthLayoutTransitionConfig

+ (instancetype)defaultConfig {
  ZynthLayoutTransitionConfig *config = [[ZynthLayoutTransitionConfig alloc] init];
  config.type = @"linear";
  config.duration = 0.3;
  config.delay = 0.0;
  config.easing = ZynthLayoutEasingEaseOutCubic;
  return config;
}

+ (nullable instancetype)fromValue:(id)value {
  if (!value || value == (id)kCFNull) return nil;
  if ([value isKindOfClass:[NSNumber class]]) {
    return [(NSNumber *)value boolValue] ? [self defaultConfig] : nil;
  }
  if (![value isKindOfClass:[NSDictionary class]]) {
    return nil;
  }
  NSDictionary *dict = (NSDictionary *)value;
  ZynthLayoutTransitionConfig *config = [[ZynthLayoutTransitionConfig alloc] init];
  NSString *type = dict[@"type"];
  config.type = type.length > 0 ? type : @"linear";

  NSNumber *durationValue = dict[@"duration"];
  double durationMs = durationValue ? durationValue.doubleValue : 300.0;
  config.duration = MAX(0.0, durationMs / 1000.0);

  NSNumber *delayValue = dict[@"delay"];
  double delayMs = delayValue ? delayValue.doubleValue : 0.0;
  config.delay = MAX(0.0, delayMs / 1000.0);

  NSString *easingName = dict[@"easing"];
  if ([easingName isEqualToString:@"linear"]) {
    config.easing = ZynthLayoutEasingLinear;
  } else if ([easingName isEqualToString:@"ease"]) {
    config.easing = ZynthLayoutEasingEase;
  } else if ([easingName isEqualToString:@"easeIn"]) {
    config.easing = ZynthLayoutEasingEaseIn;
  } else if ([easingName isEqualToString:@"easeOut"]) {
    config.easing = ZynthLayoutEasingEaseOut;
  } else if ([easingName isEqualToString:@"easeInOut"]) {
    config.easing = ZynthLayoutEasingEaseInOut;
  } else if ([easingName isEqualToString:@"easeOutCubic"]) {
    config.easing = ZynthLayoutEasingEaseOutCubic;
  } else {
    config.easing = ZynthLayoutEasingEaseOutCubic;
  }
  return config;
}

- (CAMediaTimingFunction *)timingFunction {
  switch (self.easing) {
    case ZynthLayoutEasingLinear:
      return [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionLinear];
    case ZynthLayoutEasingEase:
      return [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
    case ZynthLayoutEasingEaseIn:
      return [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseIn];
    case ZynthLayoutEasingEaseOut:
      return [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseOut];
    case ZynthLayoutEasingEaseInOut:
      return [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
    case ZynthLayoutEasingEaseOutCubic:
    default:
      return [CAMediaTimingFunction functionWithControlPoints:0.215f :0.61f :0.355f :1.0f];
  }
}

@end
