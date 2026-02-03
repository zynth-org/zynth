#import <Foundation/Foundation.h>
#import <QuartzCore/QuartzCore.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, ZynthLayoutEasing) {
  ZynthLayoutEasingLinear,
  ZynthLayoutEasingEase,
  ZynthLayoutEasingEaseIn,
  ZynthLayoutEasingEaseOut,
  ZynthLayoutEasingEaseInOut,
  ZynthLayoutEasingEaseOutCubic,
};

@interface ZynthLayoutTransitionConfig : NSObject

@property (nonatomic, copy) NSString *type;
@property (nonatomic, assign) NSTimeInterval duration;
@property (nonatomic, assign) NSTimeInterval delay;
@property (nonatomic, assign) ZynthLayoutEasing easing;

+ (nullable instancetype)fromValue:(id _Nullable)value;
- (CAMediaTimingFunction *)timingFunction;

@end

NS_ASSUME_NONNULL_END
