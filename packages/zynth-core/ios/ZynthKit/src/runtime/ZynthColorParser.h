#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface ZynthColorParser : NSObject

+ (nullable UIColor *)parseColor:(nullable NSString *)colorString;

@end

NS_ASSUME_NONNULL_END
